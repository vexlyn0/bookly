/**
 * Jazyl — предоплата через Kaspi.
 *
 * Kaspi не даёт маленьким бизнесам открытого API, поэтому оплата подтверждается вручную:
 *   1. Онлайн-запись на услугу с предоплатой создаётся «ждёт оплату» (status pending,
 *      prepay_status awaiting) и держит время prepay_hold_minutes.
 *   2. Клиент переводит на Kaspi салона и жмёт «Я оплатил» → claimed,
 *      мастеру в Telegram уходит «Проверьте Kaspi» с кнопками «Деньги пришли» / «Не пришли».
 *   3. «Деньги пришли» (в Telegram или в кабинете) → paid, запись подтверждена.
 *      «Не пришли» → rejected, запись отменена.
 *   4. Не нажал «Я оплатил» вовремя → expired, запись отменена (expireUnpaid, раз в минуту и по cron).
 */

const { getSupabaseAdmin } = require("./supabase-admin");
const config = require("../config");

const CALLBACK_PATTERN = /^pp:(ok|no):([0-9a-f-]{36})$/i;
const HOLD_OPTIONS = [15, 30, 60];

const BOOKING_SELECT = `
  id,
  organization_id,
  staff_id,
  status,
  booking_date,
  start_time,
  end_time,
  client_name,
  client_phone,
  client_phone_key,
  client_telegram_chat_id,
  client_comment,
  public_reference,
  manage_token,
  prepay_amount,
  prepay_status,
  prepay_deadline,
  services(name, price),
  staff(id, name, telegram_chat_id),
  organizations(id, name, public_name, address, timezone)
`;

/** Сколько брать предоплаты за услугу (₸, округление до 100) или 0 — без предоплаты. */
function computePrepayAmount(service) {
  const type = service?.prepay_type;
  const value = Number(service?.prepay_value) || 0;
  const price = Number(service?.price) || 0;
  if (type === "fixed" && value > 0) return price > 0 ? Math.min(value, price) : value;
  if (type === "percent" && value > 0 && price > 0) {
    return Math.max(100, Math.round((price * Math.min(value, 100)) / 100 / 100) * 100);
  }
  return 0;
}

/** Предоплата работает, только если у салона указан Kaspi. */
function isPrepayConfigured(organization) {
  return String(organization?.kaspi_phone || "").replace(/\D/g, "").length >= 10;
}

function holdMinutes(organization) {
  const value = Number(organization?.prepay_hold_minutes);
  return HOLD_OPTIONS.includes(value) ? value : 30;
}

/** Поля новой записи, если нужна предоплата, иначе null. */
function prepayFieldsForNewBooking(organization, service, now = new Date()) {
  if (!isPrepayConfigured(organization)) return null;
  const amount = computePrepayAmount(service);
  if (!amount) return null;
  return {
    prepay_amount: amount,
    prepay_status: "awaiting",
    prepay_deadline: new Date(now.getTime() + holdMinutes(organization) * 60 * 1000).toISOString(),
  };
}

/** Что показать клиенту на экране оплаты. */
function publicPrepayView(organization, booking) {
  if (!booking?.prepay_status) return null;
  return {
    amount: booking.prepay_amount,
    status: booking.prepay_status,
    deadline: booking.prepay_deadline,
    hold_minutes: holdMinutes(organization),
    kaspi_phone: organization.kaspi_phone || "",
    kaspi_name: organization.kaspi_name || "",
    kaspi_link: organization.kaspi_link || "",
    note: organization.prepay_note || "",
    // Закрыл страницу — статус оплаты придёт в бот (после «Поделиться номером»)
    bot_url: config.telegram?.isConfigured && config.telegram.botUsername ? `https://t.me/${config.telegram.botUsername}` : "",
  };
}

// -----------------------------------------------------------------------------
// Telegram
// -----------------------------------------------------------------------------

function telegram() {
  return require("./telegram-service");
}

function formatAmount(value) {
  // Обычные пробелы между разрядами: 3 000 ₸
  return `${Math.round(Number(value) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₸`;
}

function claimMessage(booking) {
  const tg = telegram();
  const org = booking.organizations || {};
  return [
    `💳 <b>Проверьте Kaspi</b> · ${tg.escapeHtml(org.public_name || org.name || "")}`,
    "",
    `${tg.escapeHtml(booking.client_name)} отметил(а), что перевёл(а) <b>${formatAmount(booking.prepay_amount)}</b> предоплаты.`,
    "",
    `📅 <b>${tg.escapeHtml(tg.formatDate(booking.booking_date))}, ${String(booking.start_time).slice(0, 5)}</b>`,
    `💼 ${tg.escapeHtml(booking.services?.name || "")}`,
    `👤 Мастер: ${tg.escapeHtml(booking.staff?.name || "")}`,
    `📞 ${tg.escapeHtml(booking.client_phone || "")}`,
    "",
    "Откройте Kaspi и проверьте перевод, затем нажмите кнопку:",
  ].join("\n");
}

function claimKeyboard(bookingId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Деньги пришли", callback_data: `pp:ok:${bookingId}` },
        { text: "❌ Не пришли", callback_data: `pp:no:${bookingId}` },
      ],
    ],
  };
}

function resultMessage(booking, paid) {
  const tg = telegram();
  return [
    paid ? "✅ <b>Предоплата получена</b>" : "❌ <b>Оплата не найдена — запись отменена</b>",
    "",
    `${tg.escapeHtml(booking.client_name)} · ${formatAmount(booking.prepay_amount)}`,
    `📅 ${tg.escapeHtml(tg.formatDate(booking.booking_date))}, ${String(booking.start_time).slice(0, 5)} · ${tg.escapeHtml(booking.services?.name || "")}`,
  ].join("\n");
}

// -----------------------------------------------------------------------------
// Действия
// -----------------------------------------------------------------------------

async function loadBooking(bookingId) {
  const { data, error } = await getSupabaseAdmin().from("bookings").select(BOOKING_SELECT).eq("id", bookingId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Клиент нажал «Я оплатил» (по manage_token). Возвращает обновлённую запись или null. */
async function claim(booking) {
  if (booking.prepay_status !== "awaiting") return booking;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("bookings")
    .update({ prepay_status: "claimed", prepay_claimed_at: new Date().toISOString() })
    .eq("id", booking.id)
    .eq("prepay_status", "awaiting")
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return loadBooking(booking.id);

  const fresh = await loadBooking(booking.id);
  if (fresh?.staff?.telegram_chat_id) {
    await telegram().sendToStaff(fresh.staff, claimMessage(fresh), { reply_markup: claimKeyboard(fresh.id) });
  }
  return fresh;
}

/**
 * Салон подтвердил или отклонил оплату. Работает и из Telegram, и из кабинета (через API).
 * @returns {{ booking: object|null, changed: boolean }}
 */
async function settle(bookingId, paid) {
  const supabase = getSupabaseAdmin();
  const update = paid
    ? { prepay_status: "paid", prepay_confirmed_at: new Date().toISOString(), status: "confirmed" }
    : { prepay_status: "rejected", status: "canceled" };

  const { data, error } = await supabase
    .from("bookings")
    .update(update)
    .eq("id", bookingId)
    .in("prepay_status", ["awaiting", "claimed"])
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw error;

  const booking = await loadBooking(bookingId);
  if (!data) return { booking, changed: false };

  await notifyClient(booking, "pending");
  return { booking, changed: true };
}

async function notifyClient(booking, previousStatus) {
  try {
    await require("./client-bot-service").notifyClientOfChange({
      organization: booking.organizations || {},
      event: "updated",
      booking,
      previous: { ...booking, status: previousStatus },
    });
  } catch (error) {
    console.error("[prepay] notify client failed", error?.code || "unknown");
  }
}

/** Кнопки «Деньги пришли» / «Не пришли» в Telegram. */
async function handleCallback({ callbackId, chatId, messageId, data }) {
  const tg = telegram();
  const match = String(data || "").match(CALLBACK_PATTERN);
  if (!match) {
    await tg.answerCallback(callbackId, "Неизвестное действие");
    return;
  }
  const [, action, bookingId] = match;

  const supabase = getSupabaseAdmin();
  const [{ data: staffRows }, booking] = await Promise.all([
    supabase.from("staff").select("id").eq("telegram_chat_id", String(chatId)),
    loadBooking(bookingId).catch(() => null),
  ]);
  const linked = (staffRows || []).map((row) => row.id);
  if (!booking || !linked.includes(booking.staff_id)) {
    await tg.answerCallback(callbackId, "Запись не найдена или недоступна", true);
    return;
  }

  try {
    const { booking: result, changed } = await settle(bookingId, action === "ok");
    if (!changed) {
      const already =
        result?.prepay_status === "paid"
          ? "Оплата уже подтверждена"
          : result?.prepay_status === "expired"
            ? "Запись уже отменена: клиент не оплатил вовремя"
            : "Запись уже обработана";
      await tg.answerCallback(callbackId, already, true);
      await tg.editMessage(chatId, messageId, `ℹ️ ${already}`);
      return;
    }
    await tg.answerCallback(callbackId, action === "ok" ? "Запись подтверждена" : "Запись отменена");
    await tg.editMessage(chatId, messageId, resultMessage(result, action === "ok"));
  } catch (error) {
    tg.logTelegramError("prepay:callback", error);
    await tg.answerCallback(callbackId, "Не удалось выполнить действие. Попробуйте позже", true);
  }
}

/** Отменяет записи, которые не оплатили вовремя. Возвращает число отменённых. */
async function expireUnpaid(now = new Date()) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("bookings")
    .update({ prepay_status: "expired", status: "canceled" })
    .eq("prepay_status", "awaiting")
    .eq("status", "pending")
    .lt("prepay_deadline", now.toISOString())
    .select("id");
  if (error) {
    console.error("[prepay] expire failed", error.code || "unknown");
    return 0;
  }
  return (data || []).length;
}

let expireTimer = null;
function startExpireScheduler() {
  if (expireTimer) return;
  expireTimer = setInterval(() => void expireUnpaid(), 60 * 1000);
  expireTimer.unref?.();
}

module.exports = {
  CALLBACK_PATTERN,
  BOOKING_SELECT,
  computePrepayAmount,
  isPrepayConfigured,
  holdMinutes,
  prepayFieldsForNewBooking,
  publicPrepayView,
  claim,
  settle,
  handleCallback,
  expireUnpaid,
  startExpireScheduler,
  loadBooking,
  // для тестов
  claimMessage,
};
