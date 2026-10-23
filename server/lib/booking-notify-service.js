/**
 * Уведомления мастеру в Telegram об изменениях записи, сделанных в кабинете:
 * новая запись, перенос, передача другому мастеру, отмена, удаление.
 *
 * Кабинет меняет записи напрямую через Supabase (RLS), а затем сообщает
 * серверу, что именно изменилось. Сервер сам перечитывает запись и проверяет,
 * что она принадлежит организации пользователя; данные «до изменения» от
 * клиента используются только для текста сообщения.
 */

const { getSupabaseAdmin } = require("./supabase-admin");
const { appError } = require("./subscription-service");
const { formatTimeForInput, formatDateInTimezone } = require("./slots");
const telegram = require("./telegram-service");

const EVENTS = new Set(["created", "updated", "deleted"]);
const STATUSES = new Set(["pending", "confirmed", "canceled", "completed", "no_show"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

const BOOKING_SELECT = `
  id,
  organization_id,
  status,
  staff_id,
  booking_date,
  start_time,
  end_time,
  client_name,
  client_phone,
  client_email,
  client_comment,
  public_reference,
  services(name),
  staff(name)
`;

const TITLES = {
  new: "🔔 <b>Новая запись</b>",
  rescheduled: "🔁 <b>Запись перенесена</b>",
  canceled: "❌ <b>Запись отменена</b>",
  reassigned: "↪️ <b>Запись передана другому мастеру</b>",
  deleted: "🗑 <b>Запись удалена</b>",
};

const CLIENT_TITLES = {
  rescheduled: "🔁 <b>Клиент перенёс запись</b>",
  canceled: "❌ <b>Клиент отменил запись</b>",
};

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

/** Снимок записи «до изменения» от клиента: только нужные поля, строго по формату. */
function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;

  const snapshot = {
    staff_id: String(raw.staff_id || ""),
    booking_date: String(raw.booking_date || ""),
    start_time: String(raw.start_time || ""),
    end_time: String(raw.end_time || raw.start_time || ""),
    status: String(raw.status || ""),
    client_name: text(raw.client_name, 120),
    client_phone: text(raw.client_phone, 40),
    service_name: text(raw.service_name, 120),
  };

  if (
    !UUID_PATTERN.test(snapshot.staff_id) ||
    !DATE_PATTERN.test(snapshot.booking_date) ||
    !TIME_PATTERN.test(snapshot.start_time) ||
    !TIME_PATTERN.test(snapshot.end_time) ||
    !STATUSES.has(snapshot.status)
  ) {
    return null;
  }

  return snapshot;
}

function todayInTimezone(timeZone) {
  try {
    return formatDateInTimezone(new Date(), timeZone);
  } catch {
    return formatDateInTimezone(new Date(), "UTC");
  }
}

function formatShortDateTime(date, time) {
  return `${telegram.formatDate(date)}, ${formatTimeForInput(time)}`;
}

async function getUserOrganizationId(userId) {
  const { data, error } = await getSupabaseAdmin()
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[booking-notify] membership lookup failed", error.code || "unknown");
    throw appError("Не удалось определить организацию", "INTERNAL_ERROR", 500);
  }

  if (!data?.organization_id) {
    throw appError("Организация не найдена", "ORGANIZATION_NOT_FOUND", 404);
  }

  return data.organization_id;
}

/** Текст сообщения для одного получателя. */
function buildMessage(kind, { organization, booking, previous, staffById, byClient = false }) {
  const organizationName = organization.public_name || organization.name || "";
  const title = (byClient && CLIENT_TITLES[kind]) || TITLES[kind];

  if (kind === "deleted") {
    return telegram.formatBookingMessage(
      {
        organizationName,
        serviceName: previous.service_name,
        staffName: staffById.get(previous.staff_id)?.name || "",
        bookingDate: previous.booking_date,
        startTime: previous.start_time,
        endTime: previous.end_time,
        clientName: previous.client_name,
        clientPhone: previous.client_phone,
      },
      { title, showStatus: false }
    );
  }

  const view = { ...telegram.viewFromBookingRow(booking), organizationName };

  if (kind === "reassigned") {
    const nextStaff = staffById.get(booking.staff_id)?.name;
    return (
      telegram.formatBookingMessage(
        {
          ...view,
          staffName: staffById.get(previous.staff_id)?.name || "",
          bookingDate: previous.booking_date,
          startTime: previous.start_time,
          endTime: previous.end_time,
          reference: "",
        },
        { title, showStatus: false }
      ) + (nextStaff ? `\n\nТеперь у мастера: ${telegram.escapeHtml(nextStaff)}` : "")
    );
  }

  if (kind === "rescheduled") {
    return telegram.formatBookingMessage(view, {
      title,
      before: formatShortDateTime(previous.booking_date, previous.start_time),
    });
  }

  if (kind === "canceled") {
    return telegram.formatBookingMessage(
      {
        ...view,
        bookingDate: previous.booking_date,
        startTime: previous.start_time,
        endTime: previous.end_time,
      },
      { title, showStatus: false }
    );
  }

  return telegram.formatBookingMessage(view, { title });
}

/** Дата, по которой решаем, не в прошлом ли запись (о прошедших не пишем). */
function relevantDate(kind, booking, previous) {
  return kind === "new" || kind === "rescheduled" ? booking.booking_date : previous.booking_date;
}

/**
 * @param {string} userId
 * @param {{ event: string, booking_id: string, previous?: object }} body
 * @returns {Promise<{ sent: number }>}
 */
async function notifyBookingChange(userId, body = {}) {
  const event = String(body.event || "");
  const bookingId = String(body.booking_id || "").toLowerCase();

  if (!EVENTS.has(event) || !UUID_PATTERN.test(bookingId)) {
    throw appError("Некорректный запрос", "VALIDATION_ERROR", 400);
  }

  const previous = event === "created" ? null : sanitizeSnapshot(body.previous);
  if (event !== "created" && !previous) {
    throw appError("Некорректный запрос", "VALIDATION_ERROR", 400);
  }

  const organizationId = await getUserOrganizationId(userId);
  if (!telegram.isEnabled()) return { sent: 0 };

  const supabase = getSupabaseAdmin();

  const [orgResult, bookingResult] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, public_name, timezone")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase.from("bookings").select(BOOKING_SELECT).eq("id", bookingId).maybeSingle(),
  ]);

  if (orgResult.error || bookingResult.error || !orgResult.data) {
    console.error("[booking-notify] lookup failed");
    throw appError("Не удалось отправить уведомление", "INTERNAL_ERROR", 500);
  }

  const organization = orgResult.data;
  const booking = bookingResult.data;

  if (event === "deleted") {
    // Об удалении сообщаем, только если записи действительно больше нет.
    if (booking) return { sent: 0 };
  } else if (!booking || booking.organization_id !== organizationId) {
    throw appError("Запись не найдена", "BOOKING_NOT_FOUND", 404);
  }

  return deliverChangeNotifications({ organization, event, booking, previous });
}

/**
 * Рассылает мастерам уведомления об изменении записи. Запись и снимок «до»
 * уже проверены вызывающим кодом. byClient — изменение сделал сам клиент.
 */
async function deliverChangeNotifications({ organization, event, booking, previous, byClient = false }) {
  const organizationId = organization.id;
  const supabase = getSupabaseAdmin();

  const plan = telegram.planBookingChangeNotifications({ event, booking, previous });
  if (!plan.length) return { sent: 0 };

  const staffIds = [
    ...new Set([...plan.map((item) => item.staffId), booking?.staff_id, previous?.staff_id].filter(Boolean)),
  ];

  const { data: staffRows, error: staffError } = await supabase
    .from("staff")
    .select("id, name, telegram_chat_id")
    .eq("organization_id", organizationId)
    .in("id", staffIds);

  if (staffError) {
    console.error("[booking-notify] staff lookup failed");
    throw appError("Не удалось отправить уведомление", "INTERNAL_ERROR", 500);
  }

  const staffById = new Map((staffRows || []).map((row) => [row.id, row]));
  const today = todayInTimezone(organization.timezone);
  let sent = 0;

  for (const { staffId, kind } of plan) {
    // Мастер чужой организации (поддельный снимок) отсутствует в staffById.
    const staff = staffById.get(staffId);
    if (!staff?.telegram_chat_id) continue;
    if (relevantDate(kind, booking, previous) < today) continue;

    const message = buildMessage(kind, { organization, booking, previous, staffById, byClient });
    const keyboard =
      kind === "new" || kind === "rescheduled"
        ? { reply_markup: telegram.bookingKeyboard(booking.id, booking.status) }
        : {};

    if (await telegram.sendToStaff(staff, message, keyboard)) sent += 1;
  }

  return { sent };
}

module.exports = {
  notifyBookingChange,
  deliverChangeNotifications,
  // для тестов
  sanitizeSnapshot,
  buildMessage,
};
