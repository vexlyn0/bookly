/**
 * Telegram-бот для клиентов
 *
 *   - привязка: клиент делится номером → telegram_clients (чат ↔ номер);
 *   - «📋 Мои записи»: предстоящие записи во всех салонах по номеру,
 *     кнопки «Перенести» (страница /b/<token>) и «Отменить» (с подтверждением);
 *   - сообщения клиенту, когда салон создал / перенёс / отменил / подтвердил запись;
 *   - напоминания о визите за сутки и за 2 часа — только на тарифе Pro.
 *
 * Ошибки Telegram не пробрасываются в бизнес-логику.
 */

const config = require("../config");
const { getSupabaseAdmin } = require("./supabase-admin");
const { formatTimeForInput, formatDateInTimezone, minutesUntil } = require("./slots");
const { getOrganizationEntitlements } = require("./subscription-service");
const telegram = require("./telegram-service");

const ACTIVE_STATUSES = ["pending", "confirmed"];
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
const CALLBACK_PATTERN = /^cl:(c|cy|n|ok):([0-9a-f]{32})$/;
const MY_BOOKINGS_TEXT = "📋 Мои записи";
const MAX_LISTED = 5;

const CLIENT_KEYBOARD = {
  keyboard: [[{ text: MY_BOOKINGS_TEXT }]],
  resize_keyboard: true,
  is_persistent: true,
};

const BOOKING_SELECT = `
  id,
  organization_id,
  status,
  booking_date,
  start_time,
  end_time,
  created_at,
  manage_token,
  client_name,
  client_phone_key,
  client_telegram_chat_id,
  client_confirmed_at,
  reminder_day_sent_at,
  reminder_2h_sent_at,
  services(name),
  staff(name),
  organizations(name, public_name, address, phone, timezone)
`;

// -----------------------------------------------------------------------------
// Вспомогательное
// -----------------------------------------------------------------------------

/** Номер в едином виде — та же логика, что public.phone_key() в базе. */
function phoneKey(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

function manageUrl(token) {
  return config.publicUrl && token ? `${config.publicUrl}/b/${token}` : "";
}

function orgName(org) {
  return org?.public_name || org?.name || "";
}

function isActive(booking) {
  return ACTIVE_STATUSES.includes(booking?.status);
}

/** Сообщение о записи для клиента. */
function formatClientBooking(booking, { title, before = "", footer = "" } = {}) {
  const org = booking.organizations || {};
  const e = telegram.escapeHtml;
  const lines = [`${title} · ${e(orgName(org))}`, ""];

  if (before) lines.push(`Было: <s>${e(before)}</s>`);
  lines.push(
    `📅 <b>${e(telegram.formatDate(booking.booking_date))}, ${e(formatTimeForInput(booking.start_time))}–${e(
      formatTimeForInput(booking.end_time)
    )}</b>`
  );
  if (booking.services?.name) lines.push(`💼 ${e(booking.services.name)}`);
  if (booking.staff?.name) lines.push(`👤 Мастер: ${e(booking.staff.name)}`);
  if (org.address) lines.push(`📍 ${e(org.address)}`);
  if (booking.status === "pending") lines.push("", "⏳ Ожидает подтверждения салона");
  if (footer) lines.push("", footer);

  return lines.join("\n");
}

/** Кнопки под записью: перенести (страница) и отменить (в боте). */
function bookingKeyboard(booking, { withConfirm = false } = {}) {
  if (!isActive(booking) || !TOKEN_PATTERN.test(String(booking.manage_token || ""))) {
    return { inline_keyboard: [] };
  }

  const rows = [];
  if (withConfirm && !booking.client_confirmed_at) {
    rows.push([{ text: "✅ Приду", callback_data: `cl:ok:${booking.manage_token}` }]);
  }

  const row = [];
  const url = manageUrl(booking.manage_token);
  if (url && /^https:\/\//.test(url)) row.push({ text: "🔁 Перенести", url });
  row.push({ text: "❌ Отменить", callback_data: `cl:c:${booking.manage_token}` });
  rows.push(row);

  return { inline_keyboard: rows };
}

async function send(chatId, text, extra = {}) {
  try {
    await telegram.sendMessage(chatId, text, extra);
    return true;
  } catch (error) {
    telegram.logTelegramError("client-bot:send", error);
    // Клиент заблокировал бота — отвязываем.
    if (error?.code === 403) {
      try {
        await getSupabaseAdmin().from("telegram_clients").delete().eq("chat_id", String(chatId));
      } catch {
        // ignore
      }
    }
    return false;
  }
}

// -----------------------------------------------------------------------------
// Привязка и поиск чатов клиента
// -----------------------------------------------------------------------------

async function linkClient(chatId, telegramUserId, phone) {
  const key = phoneKey(phone);
  if (key.length < 10 || key.length > 15) return false;

  try {
    const { error } = await getSupabaseAdmin()
      .from("telegram_clients")
      .upsert(
        {
          chat_id: String(chatId),
          phone_key: key,
          telegram_user_id: telegramUserId || null,
          linked_at: new Date().toISOString(),
        },
        { onConflict: "chat_id" }
      );
    if (error) throw error;
    return true;
  } catch (error) {
    telegram.logTelegramError("client-bot:link", error);
    return false;
  }
}

async function getChatPhoneKey(chatId) {
  const { data, error } = await getSupabaseAdmin()
    .from("telegram_clients")
    .select("phone_key")
    .eq("chat_id", String(chatId))
    .maybeSingle();
  if (error) throw error;
  return data?.phone_key || "";
}

/** Чаты клиента: подтверждённый при записи + все, кто привязал этот номер. */
async function getClientChats({ phoneKeyValue, chatId }) {
  const chats = new Set(chatId ? [String(chatId)] : []);
  if (phoneKeyValue) {
    const { data, error } = await getSupabaseAdmin()
      .from("telegram_clients")
      .select("chat_id")
      .eq("phone_key", phoneKeyValue);
    if (!error) (data || []).forEach((row) => chats.add(String(row.chat_id)));
  }
  return [...chats];
}

// -----------------------------------------------------------------------------
// Входящие сообщения клиента
// -----------------------------------------------------------------------------

/** Клиент поделился номером вне подтверждения записи — просто привязываем. */
async function handleSharedContact(chatId, telegramUserId, phone) {
  const linked = await linkClient(chatId, telegramUserId, phone);
  await send(
    chatId,
    linked
      ? `✅ Готово! Здесь будут ваши записи, изменения и напоминания.\n\nНажмите «${MY_BOOKINGS_TEXT}», чтобы посмотреть записи.`
      : "⚠️ Не удалось сохранить номер. Попробуйте ещё раз.",
    { reply_markup: CLIENT_KEYBOARD }
  );
}

async function showMyBookings(chatId) {
  let key = "";
  try {
    key = await getChatPhoneKey(chatId);
  } catch (error) {
    telegram.logTelegramError("client-bot:my", error);
    await send(chatId, "⚠️ Не удалось загрузить записи. Попробуйте позже.");
    return;
  }

  if (!key) {
    await send(chatId, "Чтобы видеть свои записи, поделитесь номером телефона 👇", {
      reply_markup: telegram.SHARE_PHONE_KEYBOARD,
    });
    return;
  }

  const fromDate = formatDateInTimezone(new Date(Date.now() - 86400000), "UTC");
  const { data, error } = await getSupabaseAdmin()
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("client_phone_key", key)
    .in("status", ACTIVE_STATUSES)
    .gte("booking_date", fromDate)
    .order("booking_date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(20);

  if (error) {
    telegram.logTelegramError("client-bot:my:bookings", error);
    await send(chatId, "⚠️ Не удалось загрузить записи. Попробуйте позже.");
    return;
  }

  const upcoming = (data || [])
    .filter((b) => minutesUntil(b.booking_date, b.start_time, b.organizations?.timezone) > 0)
    .slice(0, MAX_LISTED);

  if (!upcoming.length) {
    await send(chatId, "У вас нет предстоящих записей.", { reply_markup: CLIENT_KEYBOARD });
    return;
  }

  for (const booking of upcoming) {
    await send(chatId, formatClientBooking(booking, { title: "🗓 <b>Ваша запись</b>" }), {
      reply_markup: bookingKeyboard(booking, { withConfirm: false }),
    });
  }
}

async function loadBookingByToken(token) {
  const { data, error } = await getSupabaseAdmin()
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("manage_token", token)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Нажатия кнопок клиента: cl:c / cl:cy / cl:n / cl:ok */
async function handleClientCallback(callbackQuery) {
  const { id: callbackId, data, message } = callbackQuery;
  const chatId = message?.chat?.id;
  const match = String(data || "").match(CALLBACK_PATTERN);
  if (!match || !chatId) {
    await telegram.answerCallback(callbackId, "Неизвестное действие");
    return;
  }

  const [, action, token] = match;
  let booking;
  let chatKey = "";
  try {
    [booking, chatKey] = await Promise.all([loadBookingByToken(token), getChatPhoneKey(chatId)]);
  } catch (error) {
    telegram.logTelegramError("client-bot:callback", error);
    await telegram.answerCallback(callbackId, "Не удалось выполнить действие. Попробуйте позже", true);
    return;
  }

  // Управлять можно только своей записью (по номеру или чату, подтверждённому при записи).
  const owns =
    booking &&
    ((chatKey && booking.client_phone_key === chatKey) ||
      String(booking.client_telegram_chat_id || "") === String(chatId));

  if (!owns) {
    await telegram.answerCallback(callbackId, "Запись не найдена", true);
    return;
  }

  const view = (title, extra = {}) => formatClientBooking(booking, { title, ...extra });

  if (!isActive(booking)) {
    await telegram.answerCallback(callbackId, "Запись уже неактивна");
    await telegram.editMessage(chatId, message.message_id, view("🗓 <b>Запись</b>", { footer: "Запись неактивна." }));
    return;
  }

  if (action === "c") {
    await telegram.answerCallback(callbackId, "");
    await telegram.editMessage(chatId, message.message_id, view("❓ <b>Отменить запись?</b>"), {
      inline_keyboard: [
        [
          { text: "Да, отменить", callback_data: `cl:cy:${token}` },
          { text: "Нет", callback_data: `cl:n:${token}` },
        ],
      ],
    });
    return;
  }

  if (action === "n") {
    await telegram.answerCallback(callbackId, "Запись сохранена");
    await telegram.editMessage(chatId, message.message_id, view("🗓 <b>Ваша запись</b>"), bookingKeyboard(booking));
    return;
  }

  if (action === "ok") {
    const { error } = await getSupabaseAdmin()
      .from("bookings")
      .update({ client_confirmed_at: new Date().toISOString() })
      .eq("manage_token", token);
    if (error) {
      telegram.logTelegramError("client-bot:confirm", error);
      await telegram.answerCallback(callbackId, "Не удалось сохранить. Попробуйте позже", true);
      return;
    }
    booking.client_confirmed_at = new Date().toISOString();
    await telegram.answerCallback(callbackId, "Спасибо! Ждём вас");
    await telegram.editMessage(
      chatId,
      message.message_id,
      view("⏰ <b>Напоминание</b>", { footer: "✅ Вы подтвердили визит. Ждём вас!" }),
      bookingKeyboard(booking)
    );
    return;
  }

  // cy — отмена с проверкой правил салона (срок отмены и т.п.)
  const clientManage = require("./client-manage-service");
  try {
    await clientManage.cancelByToken(token);
  } catch (error) {
    const phone = booking.organizations?.phone;
    const text =
      error.status && error.status < 500
        ? `${error.message}${phone && !String(error.message).includes(phone) ? ` (${phone})` : ""}`
        : "Не удалось отменить запись. Попробуйте позже";
    await telegram.answerCallback(callbackId, text.slice(0, 190), true);
    await telegram.editMessage(chatId, message.message_id, view("🗓 <b>Ваша запись</b>"), bookingKeyboard(booking));
    return;
  }

  booking.status = "canceled";
  await telegram.answerCallback(callbackId, "Запись отменена");
  await telegram.editMessage(
    chatId,
    message.message_id,
    view("❌ <b>Запись отменена</b>", { footer: "Спасибо, что предупредили! Мастер получил уведомление." })
  );
}

// -----------------------------------------------------------------------------
// Сообщения клиенту об изменениях со стороны салона
// -----------------------------------------------------------------------------

/**
 * Что сообщить клиенту после изменения записи салоном.
 * @returns {"new"|"rescheduled"|"canceled"|"confirmed"|null}
 */
function planClientNotification({ event, booking, previous }) {
  if (event === "created") return isActive(booking) ? "new" : null;
  if (event === "deleted") return isActive(previous) ? "canceled" : null;
  if (event !== "updated" || !booking || !previous) return null;

  if (isActive(previous) && booking.status === "canceled") return "canceled";
  if (!isActive(previous) && isActive(booking)) return "new";
  if (!isActive(previous) || !isActive(booking)) return null;

  const moved =
    previous.staff_id !== booking.staff_id ||
    String(previous.booking_date) !== String(booking.booking_date) ||
    formatTimeForInput(previous.start_time) !== formatTimeForInput(booking.start_time);
  if (moved) return "rescheduled";

  if (previous.status === "pending" && booking.status === "confirmed") return "confirmed";
  return null;
}

const CLIENT_TITLES = {
  new: "✅ <b>Вы записаны</b>",
  rescheduled: "🔁 <b>Салон перенёс вашу запись</b>",
  canceled: "❌ <b>Запись отменена салоном</b>",
  confirmed: "✅ <b>Запись подтверждена</b>",
};

/**
 * Сообщить клиенту в Telegram (если он привязан к боту). Никогда не бросает.
 * @param {object} input
 * @param {object} input.organization  { name, public_name, address?, timezone? }
 * @param {object|null} input.booking  запись после изменения (с manage_token, client_phone_key, services, staff)
 * @param {object|null} input.previous снимок до изменения (client_phone для удалённой записи)
 */
async function notifyClientOfChange({ organization, event, booking, previous, byClient = false }) {
  try {
    if (byClient || !telegram.isEnabled()) return 0;

    const kind = planClientNotification({ event, booking, previous });
    if (!kind) return 0;

    const subject = kind === "canceled" && previous ? { ...booking, ...previous, status: "canceled" } : booking;
    const relevant = { ...(booking || {}), ...(kind === "canceled" ? previous : {}) };
    if (minutesUntil(relevant.booking_date, relevant.start_time, organization?.timezone || "Asia/Almaty") <= 0) {
      return 0;
    }

    const key = booking?.client_phone_key || phoneKey(previous?.client_phone);
    const chats = await getClientChats({ phoneKeyValue: key, chatId: booking?.client_telegram_chat_id });
    if (!chats.length) return 0;

    const view = {
      ...subject,
      services: booking?.services || { name: previous?.service_name || "" },
      staff: booking?.staff || null,
      organizations: { ...organization },
      manage_token: booking?.manage_token,
    };
    const before =
      kind === "rescheduled"
        ? `${telegram.formatDate(previous.booking_date)}, ${formatTimeForInput(previous.start_time)}`
        : "";

    const text = formatClientBooking(view, { title: CLIENT_TITLES[kind], before });
    const keyboard = kind === "canceled" ? { inline_keyboard: [] } : bookingKeyboard(view);

    let sent = 0;
    for (const chatId of chats) {
      if (await send(chatId, text, { reply_markup: keyboard })) sent += 1;
    }
    return sent;
  } catch (error) {
    telegram.logTelegramError("client-bot:notify", error);
    return 0;
  }
}

// -----------------------------------------------------------------------------
// Напоминания (Pro)
// -----------------------------------------------------------------------------

/**
 * Какое напоминание пора отправить.
 * Сутки: за 24 ч (но не позже чем за 3 ч), если запись сделана больше чем за сутки.
 * 2 часа: за 2 ч, если запись сделана больше чем за 3 ч до визита.
 * @returns {"day"|"2h"|null}
 */
function dueReminder(booking, now = new Date()) {
  const left = minutesUntil(booking.booking_date, booking.start_time, booking.organizations?.timezone, now);
  if (left <= 0) return null;

  const createdAt = booking.created_at ? new Date(booking.created_at).getTime() : 0;
  const leadMinutes = (now.getTime() - createdAt) / 60000 + left;

  if (!booking.reminder_2h_sent_at && left <= 120 && leadMinutes > 180) return "2h";
  if (!booking.reminder_day_sent_at && !booking.reminder_2h_sent_at && left > 180 && left <= 1440 && leadMinutes > 1440) {
    return "day";
  }
  return null;
}

let reminderRunning = false;

/** Разослать напоминания, которым пора. Возвращает число отправленных. */
async function sendDueReminders(now = new Date()) {
  if (reminderRunning || !telegram.isEnabled()) return 0;
  reminderRunning = true;

  try {
    const supabase = getSupabaseAdmin();
    const fromDate = formatDateInTimezone(new Date(now.getTime() - 86400000), "UTC");
    const toDate = formatDateInTimezone(new Date(now.getTime() + 2 * 86400000), "UTC");

    const { data, error } = await supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .in("status", ACTIVE_STATUSES)
      .gte("booking_date", fromDate)
      .lte("booking_date", toDate)
      .limit(1000);

    if (error) {
      telegram.logTelegramError("reminders:select", error);
      return 0;
    }

    const due = (data || [])
      .map((booking) => ({ booking, kind: dueReminder(booking, now) }))
      .filter((item) => item.kind);
    if (!due.length) return 0;

    // Чаты клиентов одним запросом
    const keys = [...new Set(due.map((item) => item.booking.client_phone_key).filter(Boolean))];
    const chatsByKey = new Map();
    if (keys.length) {
      const { data: rows } = await supabase.from("telegram_clients").select("chat_id, phone_key").in("phone_key", keys);
      for (const row of rows || []) {
        if (!chatsByKey.has(row.phone_key)) chatsByKey.set(row.phone_key, new Set());
        chatsByKey.get(row.phone_key).add(String(row.chat_id));
      }
    }

    const proCache = new Map();
    const isPro = async (organizationId) => {
      if (!proCache.has(organizationId)) {
        try {
          proCache.set(organizationId, (await getOrganizationEntitlements(organizationId)).is_pro === true);
        } catch {
          proCache.set(organizationId, false);
        }
      }
      return proCache.get(organizationId);
    };

    let sent = 0;
    for (const { booking, kind } of due) {
      const chats = new Set(chatsByKey.get(booking.client_phone_key) || []);
      if (booking.client_telegram_chat_id) chats.add(String(booking.client_telegram_chat_id));
      if (!chats.size || !(await isPro(booking.organization_id))) continue;

      // Атомарно «забираем» напоминание — повторно не уйдёт даже при двух процессах.
      const column = kind === "day" ? "reminder_day_sent_at" : "reminder_2h_sent_at";
      const { data: claimed, error: claimError } = await supabase
        .from("bookings")
        .update({ [column]: now.toISOString() })
        .eq("id", booking.id)
        .is(column, null)
        .select("id");
      if (claimError || !claimed?.length) continue;

      const today = formatDateInTimezone(now, booking.organizations?.timezone || "UTC");
      const dayWord = booking.booking_date === today ? "сегодня" : "завтра";
      const text = formatClientBooking(booking, {
        title: `⏰ <b>Напоминание: ${dayWord} в ${formatTimeForInput(booking.start_time)} у вас запись</b>`,
        footer: "Если планы изменились — перенесите или отмените запись, чтобы время досталось другим.",
      });

      for (const chatId of chats) {
        if (await send(chatId, text, { reply_markup: bookingKeyboard(booking, { withConfirm: true }) })) sent += 1;
      }
    }
    return sent;
  } catch (error) {
    telegram.logTelegramError("reminders", error);
    return 0;
  } finally {
    reminderRunning = false;
  }
}

let reminderTimer = null;

/** Проверка напоминаний каждые 5 минут, пока сервер работает. */
function startReminderScheduler() {
  if (reminderTimer || !telegram.isEnabled()) return;
  const tick = () => void sendDueReminders();
  reminderTimer = setInterval(tick, 5 * 60 * 1000);
  reminderTimer.unref?.();
  setTimeout(tick, 30 * 1000).unref?.();
}

module.exports = {
  MY_BOOKINGS_TEXT,
  CLIENT_KEYBOARD,
  linkClient,
  handleSharedContact,
  showMyBookings,
  handleClientCallback,
  notifyClientOfChange,
  sendDueReminders,
  startReminderScheduler,
  // для тестов
  planClientNotification,
  dueReminder,
  bookingKeyboard,
  formatClientBooking,
  phoneKey,
};
