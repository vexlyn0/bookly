/**
 * «Визит завершён?» — мастеру в Telegram, как только закончилось время записи.
 *
 *   ✅ Пришёл · 5 000 ₸   → status completed, оплата по цене записи
 *   ✏️ Другая сумма       → бот ждёт число от мастера (staff.pending_amount_booking_id)
 *   🚫 Не пришёл          → status no_show
 *
 * В выручку (аналитика) попадают только завершённые визиты.
 *
 * Запись с полученной предоплатой Kaspi: за 30 минут до начала мастеру
 * «Скоро клиент — предоплата N ₸, остаток после услуги M ₸» (sendDueStaffReminders),
 * а в «Визит завершён?» — сколько взять на месте. В выручку идёт полная цена.
 */

const { getSupabaseAdmin } = require("./supabase-admin");
const { formatTimeForInput, formatDateInTimezone, minutesUntil } = require("./slots");
const { mapSubscriptionError } = require("./subscription-service");
const telegram = require("./telegram-service");

const ACTIVE = ["pending", "confirmed"];
/** Не спрашиваем о визитах, закончившихся больше суток назад (сервер спал). */
const MAX_LATE_MINUTES = 24 * 60;
const MAX_AMOUNT = 100000000;
/** За сколько минут до начала напомнить мастеру о предоплате. */
const STAFF_REMINDER_MINUTES = 30;

const BOOKING_SELECT = `
  id,
  organization_id,
  staff_id,
  status,
  booking_date,
  start_time,
  end_time,
  price,
  client_name,
  client_phone,
  visit_check_sent_at,
  staff_reminder_sent_at,
  prepay_amount,
  prepay_status,
  services(name, price),
  staff(name, telegram_chat_id),
  organizations(name, public_name, timezone)
`;

function money(value) {
  return `${Math.round(Number(value) || 0).toLocaleString("ru-RU").replace(/ /g, " ")} ₸`;
}

function priceOf(booking) {
  if (booking.price !== null && booking.price !== undefined) return Number(booking.price) || 0;
  return Number(booking.services?.price) || 0;
}

/** Сколько клиент уже заплатил через Kaspi (0 — без предоплаты или не подтверждена). */
function prepaidOf(booking) {
  return booking.prepay_status === "paid" ? Number(booking.prepay_amount) || 0 : 0;
}

/** Сколько взять с клиента на месте. */
function remainderOf(booking) {
  return Math.max(0, priceOf(booking) - prepaidOf(booking));
}

/** Строки про предоплату и остаток; пусто, если предоплаты не было. */
function prepayLines(booking) {
  const prepaid = prepaidOf(booking);
  if (!prepaid) return [];
  const remainder = remainderOf(booking);
  return [
    `💳 Клиент внёс предоплату <b>${money(prepaid)}</b>`,
    remainder > 0
      ? `💰 Остаток после услуги: <b>${money(remainder)}</b>`
      : "✅ Оплачено полностью — на месте ничего не брать",
  ];
}

function formatVisit(booking, title, footer = "") {
  const e = telegram.escapeHtml;
  const org = booking.organizations || {};
  const lines = [
    `${title} · ${e(org.public_name || org.name || "")}`,
    "",
    `📅 ${e(telegram.formatDate(booking.booking_date))}, ${e(formatTimeForInput(booking.start_time))}–${e(
      formatTimeForInput(booking.end_time)
    )}`,
    `💼 ${e(booking.services?.name || "")}`,
    `🙋 ${e(booking.client_name)}${booking.client_phone ? ` · ${e(booking.client_phone)}` : ""}`,
  ];
  if (footer) lines.push("", footer);
  return lines.join("\n");
}

function doneButtonText(booking) {
  if (!prepaidOf(booking)) return `✅ Пришёл · ${money(priceOf(booking))}`;
  const remainder = remainderOf(booking);
  return remainder > 0 ? `✅ Пришёл · доплатил ${money(remainder)}` : "✅ Пришёл · оплачено заранее";
}

/** Подвал «Визит завершён?»: цена, а при предоплате — сколько взять на месте. */
function visitCheckFooter(booking) {
  const prepaid = prepaidOf(booking);
  if (!prepaid) return `💰 По записи: <b>${money(priceOf(booking))}</b>`;
  const remainder = remainderOf(booking);
  return [
    `💰 Цена: ${money(priceOf(booking))} · предоплата ${money(prepaid)} уже получена`,
    remainder > 0 ? `Возьмите с клиента: <b>${money(remainder)}</b>` : "✅ Оплачено полностью — на месте ничего не брать",
  ].join("\n");
}

function visitKeyboard(booking) {
  return {
    inline_keyboard: [
      [{ text: doneButtonText(booking), callback_data: `bk:done:${booking.id}` }],
      [
        { text: "✏️ Другая сумма", callback_data: `bk:sum:${booking.id}` },
        { text: "🚫 Не пришёл", callback_data: `bk:noshow:${booking.id}` },
      ],
    ],
  };
}

// -----------------------------------------------------------------------------
// Рассылка
// -----------------------------------------------------------------------------

let running = false;

/** Разослать «Визит завершён?» по записям, время которых закончилось. */
async function sendDueVisitChecks(now = new Date()) {
  if (running || !telegram.isEnabled()) return 0;
  running = true;

  try {
    const supabase = getSupabaseAdmin();
    const fromDate = formatDateInTimezone(new Date(now.getTime() - 2 * 86400000), "UTC");
    const toDate = formatDateInTimezone(new Date(now.getTime() + 86400000), "UTC");

    const { data, error } = await supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .in("status", ACTIVE)
      .is("visit_check_sent_at", null)
      .gte("booking_date", fromDate)
      .lte("booking_date", toDate)
      .limit(500);

    if (error) {
      telegram.logTelegramError("visit-check:select", error);
      return 0;
    }

    let sent = 0;
    for (const booking of data || []) {
      const left = minutesUntil(booking.booking_date, booking.end_time, booking.organizations?.timezone, now);
      if (left > 0 || left < -MAX_LATE_MINUTES) continue;

      const chatId = booking.staff?.telegram_chat_id;
      // Мастер без Telegram — отметит владелец в кабинете; повторно не проверяем.
      const { data: claimed, error: claimError } = await supabase
        .from("bookings")
        .update({ visit_check_sent_at: now.toISOString() })
        .eq("id", booking.id)
        .is("visit_check_sent_at", null)
        .select("id");
      if (claimError || !claimed?.length || !chatId) continue;

      const ok = await telegram.sendToStaff(
        { id: booking.staff_id, telegram_chat_id: chatId },
        formatVisit(booking, "🧾 <b>Визит завершён?</b>", visitCheckFooter(booking)),
        { reply_markup: visitKeyboard(booking) }
      );
      if (ok) sent += 1;
    }
    return sent;
  } catch (error) {
    telegram.logTelegramError("visit-check", error);
    return 0;
  } finally {
    running = false;
  }
}

let reminderRunning = false;

/** За 30 минут до записи с полученной предоплатой — мастеру: сколько внесено и сколько взять после. */
async function sendDueStaffReminders(now = new Date()) {
  if (reminderRunning || !telegram.isEnabled()) return 0;
  reminderRunning = true;

  try {
    const supabase = getSupabaseAdmin();
    const fromDate = formatDateInTimezone(new Date(now.getTime() - 86400000), "UTC");
    const toDate = formatDateInTimezone(new Date(now.getTime() + 86400000), "UTC");

    const { data, error } = await supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("status", "confirmed")
      .eq("prepay_status", "paid")
      .is("staff_reminder_sent_at", null)
      .gte("booking_date", fromDate)
      .lte("booking_date", toDate)
      .limit(500);

    if (error) {
      telegram.logTelegramError("staff-reminder:select", error);
      return 0;
    }

    let sent = 0;
    for (const booking of data || []) {
      const left = minutesUntil(booking.booking_date, booking.start_time, booking.organizations?.timezone, now);
      // Уже началось (сервер спал) — напоминание опоздало, остаток покажем в «Визит завершён?».
      if (left > STAFF_REMINDER_MINUTES || left <= 0) continue;

      const chatId = booking.staff?.telegram_chat_id;
      const { data: claimed, error: claimError } = await supabase
        .from("bookings")
        .update({ staff_reminder_sent_at: now.toISOString() })
        .eq("id", booking.id)
        .is("staff_reminder_sent_at", null)
        .select("id");
      if (claimError || !claimed?.length || !chatId) continue;

      const ok = await telegram.sendToStaff(
        { id: booking.staff_id, telegram_chat_id: chatId },
        formatVisit(booking, `⏰ <b>Через ${left} мин клиент</b>`, prepayLines(booking).join("\n"))
      );
      if (ok) sent += 1;
    }
    return sent;
  } catch (error) {
    telegram.logTelegramError("staff-reminder", error);
    return 0;
  } finally {
    reminderRunning = false;
  }
}

// -----------------------------------------------------------------------------
// Кнопки и сумма от мастера
// -----------------------------------------------------------------------------

async function loadBooking(bookingId) {
  const { data, error } = await getSupabaseAdmin()
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function linkedStaffIds(chatId) {
  const { data, error } = await getSupabaseAdmin()
    .from("staff")
    .select("id")
    .eq("telegram_chat_id", String(chatId));
  if (error) throw error;
  return (data || []).map((row) => row.id);
}

/**
 * Отметить визит. Возвращает обновлённую запись или null, если её уже отметили.
 * @param {"completed"|"no_show"} status
 */
async function markVisit(bookingId, status, paidAmount = null) {
  const patch = { status };
  if (status === "completed" && paidAmount !== null) patch.paid_amount = paidAmount;

  const { data, error } = await getSupabaseAdmin()
    .from("bookings")
    .update(patch)
    .eq("id", bookingId)
    .in("status", ACTIVE)
    .select("id, status, paid_amount, price")
    .maybeSingle();

  if (error) throw error;
  return data;
}

function doneFooter(status, amount, booking = null) {
  if (status !== "completed") return "🚫 Отмечено: клиент не пришёл";
  const prepaid = booking ? prepaidOf(booking) : 0;
  const parts = prepaid ? ` (предоплата ${money(prepaid)} + на месте ${money(Math.max(0, amount - prepaid))})` : "";
  return `✅ Визит отмечен · оплачено <b>${money(amount)}</b>${parts}`;
}

/** Нажатия bk:done / bk:sum / bk:noshow. */
async function handleVisitCallback({ callbackId, chatId, messageId, action, bookingId }) {
  let booking;
  let staffIds;
  try {
    [booking, staffIds] = await Promise.all([loadBooking(bookingId), linkedStaffIds(chatId)]);
  } catch (error) {
    telegram.logTelegramError("visit-check:callback", error);
    await telegram.answerCallback(callbackId, "Не удалось выполнить действие. Попробуйте позже", true);
    return;
  }

  if (!booking || !staffIds.includes(booking.staff_id)) {
    await telegram.answerCallback(callbackId, "Запись не найдена или недоступна", true);
    return;
  }

  if (!ACTIVE.includes(booking.status)) {
    const label = booking.status === "completed" ? "уже отмечен как завершённый" : "уже отмечен";
    await telegram.answerCallback(callbackId, `Визит ${label}`);
    await telegram.editMessage(chatId, messageId, formatVisit(booking, "🧾 <b>Визит</b>", `Статус: ${telegram.STATUS_LABELS[booking.status] || booking.status}`));
    return;
  }

  if (action === "sum") {
    try {
      await getSupabaseAdmin()
        .from("staff")
        .update({ pending_amount_booking_id: booking.id })
        .eq("id", booking.staff_id);
    } catch (error) {
      telegram.logTelegramError("visit-check:sum", error);
    }
    await telegram.answerCallback(callbackId, "Напишите сумму числом");
    const prepaid = prepaidOf(booking);
    await telegram.sendMessage(
      chatId,
      prepaid
        ? `✏️ Сколько ${telegram.escapeHtml(booking.client_name)} заплатил(а) на месте — без предоплаты ${money(prepaid)}? Напишите сумму числом, например <b>4500</b> (или <b>0</b>).`
        : `✏️ Сколько заплатил(а) ${telegram.escapeHtml(booking.client_name)}? Напишите сумму числом, например <b>4500</b>.`,
      { reply_markup: { force_reply: true, input_field_placeholder: "Сумма в тенге" } }
    );
    return;
  }

  const status = action === "done" ? "completed" : "no_show";
  try {
    const updated = await markVisit(booking.id, status);
    if (!updated) {
      await telegram.answerCallback(callbackId, "Визит уже отмечен");
      return;
    }
    await telegram.answerCallback(callbackId, status === "completed" ? "Визит засчитан" : "Отмечено: не пришёл");
    await telegram.editMessage(chatId, messageId, formatVisit(booking, "🧾 <b>Визит</b>", doneFooter(status, priceOf(booking), booking)));
  } catch (error) {
    const blocked = mapSubscriptionError(error);
    if (!blocked) telegram.logTelegramError("visit-check:mark", error);
    await telegram.answerCallback(
      callbackId,
      blocked ? "Организация приостановлена — изменить запись нельзя" : "Не удалось отметить визит. Попробуйте позже",
      true
    );
  }
}

/** Разбор суммы: «4500», «4 500», «4500 тг», «4.500». */
function parseAmount(text) {
  const cleaned = String(text || "").replace(/[\s.,]/g, "").replace(/(тг|тенге|₸|kzt)$/i, "");
  if (!/^\d{1,9}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value <= MAX_AMOUNT ? value : null;
}

/**
 * Текст от мастера, который нажал «Другая сумма».
 * @returns {Promise<boolean>} true — сообщение обработано как сумма
 */
async function handleAmountMessage(chatId, text) {
  const supabase = getSupabaseAdmin();
  let staffRow = null;
  try {
    const { data: rows, error } = await supabase
      .from("staff")
      .select("id, pending_amount_booking_id")
      .eq("telegram_chat_id", String(chatId));
    if (error) throw error;
    staffRow = (rows || []).find((row) => row.pending_amount_booking_id) || null;
  } catch (error) {
    telegram.logTelegramError("visit-check:pending", error);
    return false;
  }

  if (!staffRow) return false;
  const amount = parseAmount(text);
  if (amount === null) {
    await telegram.sendMessage(chatId, "Не понял сумму. Напишите только число, например <b>4500</b>.", {
      reply_markup: { force_reply: true, input_field_placeholder: "Сумма в тенге" },
    });
    return true;
  }

  await supabase.from("staff").update({ pending_amount_booking_id: null }).eq("id", staffRow.id);

  try {
    const booking = await loadBooking(staffRow.pending_amount_booking_id);
    // При предоплате мастер пишет, сколько взял на месте; в выручку — вместе с предоплатой.
    const total = booking ? amount + prepaidOf(booking) : amount;
    const updated = booking ? await markVisit(booking.id, "completed", total) : null;
    if (!updated) {
      await telegram.sendMessage(chatId, "Этот визит уже отмечен — сумму не меняю.");
      return true;
    }
    await telegram.sendMessage(chatId, formatVisit(booking, "🧾 <b>Визит</b>", doneFooter("completed", total, booking)));
  } catch (error) {
    telegram.logTelegramError("visit-check:amount", error);
    await telegram.sendMessage(chatId, "⚠️ Не удалось сохранить сумму. Попробуйте ещё раз.");
  }
  return true;
}

module.exports = {
  sendDueVisitChecks,
  sendDueStaffReminders,
  handleVisitCallback,
  handleAmountMessage,
  // для тестов
  parseAmount,
  visitKeyboard,
  visitCheckFooter,
  formatVisit,
  prepayLines,
};
