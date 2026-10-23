/**
 * Личная ссылка клиента на запись (/b/<token>): просмотр, отмена, перенос.
 *
 * Правила:
 *   - менять можно только активную запись (pending / confirmed);
 *   - не позже чем за organizations.client_manage_cutoff_hours до начала
 *     (null — только через салон);
 *   - перенос — на свободное время того же мастера и той же услуги,
 *     не больше MAX_CLIENT_RESCHEDULES раз.
 * Мастер получает уведомление в Telegram.
 */

const { getSupabaseAdmin } = require("./supabase-admin");
const {
  computeSlots,
  findScheduleForDate,
  formatTimeForInput,
  isDateTooFarAhead,
  minutesUntil,
  isPastSlot,
  timeToMinutes,
  MAX_BOOKING_DAYS_AHEAD,
} = require("./slots");
const { requireOrganizationOperational } = require("./subscription-service");
const { deliverChangeNotifications } = require("./booking-notify-service");

const MAX_CLIENT_RESCHEDULES = 2;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const ACTIVE_STATUSES = ["pending", "confirmed"];

const BOOKING_SELECT = `
  id,
  organization_id,
  service_id,
  staff_id,
  status,
  booking_date,
  start_time,
  end_time,
  client_name,
  client_phone,
  client_email,
  client_comment,
  public_reference,
  client_reschedule_count,
  services(name, duration_minutes),
  staff(name)
`;

const ORG_SELECT = "id, slug, name, public_name, phone, address, timezone, client_manage_cutoff_hours";

function appError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function internalError(context, error) {
  console.error("[client-manage]", context, error?.code || "unknown");
  return appError("Не удалось выполнить запрос. Попробуйте позже", "INTERNAL_ERROR", 500);
}

/**
 * Что клиенту можно сделать с записью.
 * @returns {{ canCancel: boolean, canReschedule: boolean, reason: string|null }}
 */
function getManageState(booking, organization, now = new Date()) {
  if (!ACTIVE_STATUSES.includes(booking.status)) {
    return { canCancel: false, canReschedule: false, reason: "inactive" };
  }

  const left = minutesUntil(booking.booking_date, booking.start_time, organization.timezone, now);
  if (left <= 0) {
    return { canCancel: false, canReschedule: false, reason: "inactive" };
  }

  const cutoff = organization.client_manage_cutoff_hours;
  if (cutoff === null || cutoff === undefined) {
    return { canCancel: false, canReschedule: false, reason: "disabled" };
  }

  if (left < cutoff * 60) {
    return { canCancel: false, canReschedule: false, reason: "too_late" };
  }

  if ((booking.client_reschedule_count || 0) >= MAX_CLIENT_RESCHEDULES) {
    return { canCancel: true, canReschedule: false, reason: "reschedule_limit" };
  }

  return { canCancel: true, canReschedule: true, reason: null };
}

function toPublicView(booking, organization, now = new Date()) {
  const state = getManageState(booking, organization, now);
  return {
    organization: {
      slug: organization.slug,
      name: organization.public_name || organization.name,
      phone: organization.phone || "",
      address: organization.address || "",
    },
    booking: {
      reference: booking.public_reference || "",
      status: booking.status,
      service_name: booking.services?.name || "",
      staff_name: booking.staff?.name || "",
      client_name: booking.client_name,
      booking_date: booking.booking_date,
      start_time: formatTimeForInput(booking.start_time),
      end_time: formatTimeForInput(booking.end_time),
    },
    can_cancel: state.canCancel,
    can_reschedule: state.canReschedule,
    reason: state.reason,
    cutoff_hours: organization.client_manage_cutoff_hours,
    reschedules_left: Math.max(0, MAX_CLIENT_RESCHEDULES - (booking.client_reschedule_count || 0)),
    max_days_ahead: MAX_BOOKING_DAYS_AHEAD,
  };
}

async function loadByToken(token) {
  const value = String(token || "").toLowerCase();
  if (!TOKEN_PATTERN.test(value)) {
    throw appError("Запись не найдена", "BOOKING_NOT_FOUND", 404);
  }

  const supabase = getSupabaseAdmin();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("manage_token", value)
    .maybeSingle();

  if (error) throw internalError("booking", error);
  if (!booking) throw appError("Запись не найдена", "BOOKING_NOT_FOUND", 404);

  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .select(ORG_SELECT)
    .eq("id", booking.organization_id)
    .maybeSingle();

  if (orgError || !organization) throw internalError("organization", orgError);

  return { booking, organization };
}

function snapshotOf(booking) {
  return {
    staff_id: booking.staff_id,
    booking_date: booking.booking_date,
    start_time: booking.start_time,
    end_time: booking.end_time,
    status: booking.status,
  };
}

async function notifyStaff(organization, booking, previous) {
  try {
    await deliverChangeNotifications({ organization, event: "updated", booking, previous, byClient: true });
  } catch (error) {
    console.error("[client-manage] notify failed", error?.code || "unknown");
  }
}

function mapUpdateError(error) {
  const text = `${error?.message || ""} ${error?.details || ""}`;
  if (error?.code === "23P01" || text.includes("bookings_no_active_overlap")) {
    return appError("Это время уже занято. Выберите другое", "BOOKING_TIME_CONFLICT", 409);
  }
  if (text.includes("BOOKING_IN_PAST")) {
    return appError("Нельзя перенести на прошедшее время", "BOOKING_IN_PAST", 400);
  }
  if (
    text.includes("BOOKING_STAFF_DAY_OFF") ||
    text.includes("BOOKING_OUTSIDE_SCHEDULE") ||
    text.includes("BOOKING_STAFF_INACTIVE") ||
    text.includes("BOOKING_SERVICE_INACTIVE")
  ) {
    return appError("Это время недоступно. Выберите другое", "SLOT_UNAVAILABLE", 409);
  }
  if (text.includes("SUBSCRIPTION")) {
    return appError("Онлайн-изменение записи временно недоступно. Позвоните в салон", "ORGANIZATION_SUSPENDED", 403);
  }
  return internalError("update", error);
}

// -----------------------------------------------------------------------------

async function getManageInfo(token) {
  const { booking, organization } = await loadByToken(token);
  return toPublicView(booking, organization);
}

async function getManageSlots(token, date) {
  const { booking, organization } = await loadByToken(token);
  const state = getManageState(booking, organization);
  if (!state.canReschedule) {
    throw appError("Перенос этой записи онлайн недоступен", "RESCHEDULE_NOT_ALLOWED", 403);
  }

  const dateStr = String(date || "");
  if (!DATE_PATTERN.test(dateStr)) {
    throw appError("Некорректная дата", "VALIDATION_ERROR", 400);
  }
  if (isDateTooFarAhead(dateStr, organization.timezone)) {
    return { date: dateStr, slots: [] };
  }

  const supabase = getSupabaseAdmin();
  const [schedulesResult, bookingsResult] = await Promise.all([
    supabase
      .from("staff_schedules")
      .select("*")
      .eq("organization_id", organization.id)
      .eq("staff_id", booking.staff_id),
    supabase
      .from("bookings")
      .select("id, start_time, end_time, status")
      .eq("organization_id", organization.id)
      .eq("staff_id", booking.staff_id)
      .eq("booking_date", dateStr),
  ]);

  if (schedulesResult.error) throw internalError("schedules", schedulesResult.error);
  if (bookingsResult.error) throw internalError("bookings", bookingsResult.error);

  const slots = computeSlots({
    schedule: findScheduleForDate(schedulesResult.data || [], dateStr),
    durationMinutes: booking.services?.duration_minutes,
    bookings: bookingsResult.data || [],
    excludeBookingId: booking.id,
    dateStr,
    timeZone: organization.timezone,
  }).filter(
    // Текущее время записи не предлагаем как «новое».
    (slot) =>
      !(dateStr === booking.booking_date && slot.start_time === formatTimeForInput(booking.start_time))
  );

  return { date: dateStr, slots };
}

async function cancelByToken(token) {
  const { booking, organization } = await loadByToken(token);
  await requireOrganizationOperational(organization.id);

  const state = getManageState(booking, organization);
  if (!state.canCancel) {
    throw appError("Отменить эту запись онлайн нельзя. Позвоните в салон", "CANCEL_NOT_ALLOWED", 403);
  }

  const previous = snapshotOf(booking);

  const supabase = getSupabaseAdmin();
  const { data: updated, error } = await supabase
    .from("bookings")
    .update({ status: "canceled" })
    .eq("id", booking.id)
    .in("status", ACTIVE_STATUSES)
    .select(BOOKING_SELECT)
    .maybeSingle();

  if (error) throw mapUpdateError(error);
  if (!updated) {
    throw appError("Запись уже изменена. Обновите страницу", "BOOKING_CHANGED", 409);
  }

  await notifyStaff(organization, updated, previous);
  return toPublicView(updated, organization);
}

async function rescheduleByToken(token, body = {}) {
  const bookingDate = String(body.booking_date || "");
  const startTime = String(body.start_time || "");
  if (!DATE_PATTERN.test(bookingDate) || !TIME_PATTERN.test(startTime)) {
    throw appError("Выберите дату и время", "VALIDATION_ERROR", 400);
  }

  const { booking, organization } = await loadByToken(token);
  await requireOrganizationOperational(organization.id);

  const state = getManageState(booking, organization);
  if (!state.canReschedule) {
    throw appError("Перенести эту запись онлайн нельзя. Позвоните в салон", "RESCHEDULE_NOT_ALLOWED", 403);
  }

  if (isPastSlot(bookingDate, timeToMinutes(startTime), organization.timezone)) {
    throw appError("Нельзя перенести на прошедшее время", "BOOKING_IN_PAST", 400);
  }

  const { slots } = await getManageSlots(token, bookingDate);
  const slot = slots.find((item) => item.start_time === startTime);
  if (!slot) {
    throw appError("Это время уже занято. Выберите другое", "BOOKING_TIME_CONFLICT", 409);
  }

  const previous = snapshotOf(booking);
  const supabase = getSupabaseAdmin();
  const count = booking.client_reschedule_count || 0;
  const { data: updated, error } = await supabase
    .from("bookings")
    .update({
      booking_date: bookingDate,
      start_time: slot.start_time,
      end_time: slot.end_time,
      client_reschedule_count: count + 1,
    })
    .eq("id", booking.id)
    .eq("client_reschedule_count", count)
    .in("status", ACTIVE_STATUSES)
    .select(BOOKING_SELECT)
    .maybeSingle();

  if (error) throw mapUpdateError(error);
  if (!updated) {
    throw appError("Запись уже изменена. Обновите страницу", "BOOKING_CHANGED", 409);
  }

  await notifyStaff(organization, updated, previous);
  return toPublicView(updated, organization);
}

module.exports = {
  getManageInfo,
  getManageSlots,
  cancelByToken,
  rescheduleByToken,
  // для тестов
  getManageState,
  minutesUntil,
  MAX_CLIENT_RESCHEDULES,
};
