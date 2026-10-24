/**
 * Сервис публичной онлайн-записи
 */

const { getSupabaseAdmin } = require("./supabase-admin");
const {
  computeSlots,
  findScheduleForDate,
  formatTimeForInput,
  isDateTooFarAhead,
  isPastSlot,
  timeToMinutes,
  minutesToTime,
  MAX_BOOKING_DAYS_AHEAD,
  formatDateInTimezone,
  getMinutesInTimezone,
} = require("./slots");
const { validatePublicBookingPayload, validationError } = require("./public-booking-validation");
const { requireOrganizationOperational } = require("./subscription-service");
const telegramService = require("./telegram-service");
const phoneVerification = require("./phone-verification-service");

const PUBLIC_ORG_FIELDS = `
  id,
  slug,
  name,
  public_name,
  description,
  phone,
  address,
  timezone,
  public_booking_enabled,
  booking_confirmation_mode,
  require_phone_verification,
  brand_color
`;

const REFERENCE_PATTERN = /^BK-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

const DEFAULT_BRAND_COLOR = "#534AB7";

/** На сколько дней вперёд ищем «ближайшее свободное время» мастера. */
const NEXT_AVAILABLE_DAYS = 14;

function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Рабочие дни и ближайшее свободное время каждого мастера для услуги.
 * Ошибка расчёта не ломает список мастеров — просто без подсказки.
 */
async function attachAvailability(supabase, organization, durationMinutes, members) {
  if (!members.length) return members;

  const ids = members.map((member) => member.id);
  const today = formatDateInTimezone(new Date(), organization.timezone);
  const lastDate = addDays(today, NEXT_AVAILABLE_DAYS - 1);

  const [schedulesResult, bookingsResult] = await Promise.all([
    supabase.from("staff_schedules").select("*").eq("organization_id", organization.id).in("staff_id", ids),
    supabase
      .from("bookings")
      .select("staff_id, booking_date, start_time, end_time, status")
      .eq("organization_id", organization.id)
      .in("staff_id", ids)
      .in("status", ["pending", "confirmed"])
      .gte("booking_date", today)
      .lte("booking_date", lastDate),
  ]);

  if (schedulesResult.error || bookingsResult.error) {
    logQueryError("staff:availability", schedulesResult.error || bookingsResult.error);
    return members.map((member) => ({ ...member, work_days: null, next_available: null }));
  }

  const schedules = schedulesResult.data || [];
  const bookings = bookingsResult.data || [];

  return members.map((member) => {
    const own = schedules.filter((row) => row.staff_id === member.id);
    const workDays = own.filter((row) => row.is_working === true).map((row) => row.day_of_week);
    let nextAvailable = null;

    for (let offset = 0; offset < NEXT_AVAILABLE_DAYS && !nextAvailable; offset += 1) {
      const date = addDays(today, offset);
      const slots = computeSlots({
        schedule: findScheduleForDate(own, date),
        durationMinutes,
        bookings: bookings.filter((row) => row.staff_id === member.id && row.booking_date === date),
        dateStr: date,
        timeZone: organization.timezone,
      });
      if (slots.length) nextAvailable = { date, start_time: slots[0].start_time };
    }

    return { ...member, work_days: workDays, next_available: nextAvailable };
  });
}

/** Сколько предстоящих записей можно иметь на один номер при онлайн-записи. */
const MAX_ACTIVE_BOOKINGS_PER_PHONE = 2;

/** Номер в едином виде — та же логика, что public.phone_key() в базе. */
function phoneKey(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

/**
 * Номер в чёрном списке организации или уже есть 2 предстоящие записи — отказ.
 * Причину блокировки клиенту не раскрываем.
 */
async function assertClientMayBook(supabase, organization, clientPhone) {
  const key = phoneKey(clientPhone);
  if (!key) return;

  const today = formatDateInTimezone(new Date(), organization.timezone);
  const nowMinutes = getMinutesInTimezone(new Date(), organization.timezone);

  const [blacklistResult, bookingsResult] = await Promise.all([
    supabase
      .from("client_blacklist")
      .select("id")
      .eq("organization_id", organization.id)
      .eq("phone_key", key)
      .maybeSingle(),
    supabase
      .from("bookings")
      .select("booking_date, end_time")
      .eq("organization_id", organization.id)
      .eq("client_phone_key", key)
      .in("status", ["pending", "confirmed"])
      .gte("booking_date", today),
  ]);

  if (assertSupabaseResult(blacklistResult, "client_blacklist")) {
    throw appError(
      "Онлайн-запись для этого номера недоступна. Свяжитесь с организацией по телефону",
      "CLIENT_BLOCKED",
      403
    );
  }

  const upcoming = (assertSupabaseResult(bookingsResult, "bookings:phone") || []).filter(
    (row) => row.booking_date > today || (timeToMinutes(row.end_time) ?? 0) > nowMinutes
  );

  if (upcoming.length >= MAX_ACTIVE_BOOKINGS_PER_PHONE) {
    throw appError(
      `На этот номер уже есть ${MAX_ACTIVE_BOOKINGS_PER_PHONE} предстоящие записи. ` +
        "Чтобы записаться ещё, перенесите или отмените одну из них по ссылке из подтверждения — или позвоните в салон",
      "TOO_MANY_ACTIVE_BOOKINGS",
      409
    );
  }
}

function appError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function isOverlapError(message = "", code = "") {
  const text = String(message);
  return (
    code === "23P01" ||
    text.includes("bookings_no_active_overlap") ||
    text.toLowerCase().includes("exclusion constraint")
  );
}

function isReferenceUniqueError(message = "", code = "") {
  const text = String(message);
  return (
    code === "23505" &&
    (text.includes("bookings_public_reference_unique") ||
      text.toLowerCase().includes("public_reference"))
  );
}

function internalError(message = "Не удалось выполнить запрос. Попробуйте позже") {
  const error = new Error(message);
  error.code = "INTERNAL_ERROR";
  error.status = 500;
  return error;
}

function logQueryError(context, error) {
  console.error("[public-booking] query failed:", context, error?.code || "unknown");
}

function assertSupabaseResult(result, context) {
  if (result?.error) {
    logQueryError(context, result.error);
    throw internalError();
  }
  return result.data;
}

function computeBookingEndTime(startTime, durationMinutes) {
  const startMinutes = timeToMinutes(startTime);
  if (startMinutes === null) {
    throw validationError("start_time некорректен");
  }

  const duration = Number(durationMinutes) || 0;
  if (duration < 1) {
    throw validationError("Некорректная длительность услуги");
  }

  return minutesToTime(startMinutes + duration);
}

function mapDbBookingError(message = "", code = "") {
  const text = String(message);

  if (text.includes("BOOKING_REFERENCE_GENERATION_FAILED")) {
    return appError("Не удалось создать запись", "BOOKING_REFERENCE_GENERATION_FAILED", 500);
  }

  if (isReferenceUniqueError(text, code)) {
    return appError("Не удалось создать запись", "BOOKING_REFERENCE_GENERATION_FAILED", 500);
  }

  if (text.includes("BOOKING_IN_PAST")) {
    return appError("Нельзя записаться на прошедшее время", "BOOKING_IN_PAST", 400);
  }
  if (text.includes("BOOKING_SERVICE_INACTIVE")) {
    return appError("Услуга недоступна", "SERVICE_INACTIVE", 400);
  }
  if (text.includes("BOOKING_STAFF_INACTIVE")) {
    return appError("Сотрудник недоступен", "STAFF_INACTIVE", 400);
  }
  if (text.includes("BOOKING_STAFF_SERVICE_MISMATCH")) {
    return appError("Сотрудник не оказывает эту услугу", "STAFF_SERVICE_MISMATCH", 400);
  }
  if (text.includes("BOOKING_STAFF_DAY_OFF")) {
    return appError("Сотрудник не работает в этот день", "NO_WORK_SCHEDULE", 400);
  }
  if (text.includes("BOOKING_OUTSIDE_SCHEDULE")) {
    return appError("Выбранное время вне рабочего графика", "NO_WORK_SCHEDULE", 400);
  }
  if (isOverlapError(text, code)) {
    return appError("Это время уже занято. Выберите другой слот", "BOOKING_TIME_CONFLICT", 409);
  }

  return appError("Не удалось создать запись. Попробуйте позже", "INTERNAL_ERROR", 500);
}

async function getOrganizationBySlug(slug) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("organizations")
    .select(PUBLIC_ORG_FIELDS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function requirePublicOrganization(slug) {
  const organization = await getOrganizationBySlug(slug);
  if (!organization) {
    throw appError("Организация не найдена", "ORGANIZATION_NOT_FOUND", 404);
  }

  // Онлайн-запись работает на любом тарифе (Free / Pro), блокирует только приостановка
  // организации. Проверяется раньше бизнес-настройки public_booking_enabled.
  const entitlements = await requireOrganizationOperational(organization.id);
  organization.show_branding = entitlements.show_branding;

  if (organization.public_booking_enabled !== true) {
    throw appError("Онлайн-запись временно недоступна", "PUBLIC_BOOKING_DISABLED", 403);
  }
  return organization;
}

function toPublicOrganization(organization) {
  return {
    slug: organization.slug,
    name: organization.public_name || organization.name,
    description: organization.description || "",
    phone: organization.phone || "",
    address: organization.address || "",
    show_branding: organization.show_branding !== false,
    phone_verification_required: phoneVerification.isRequired(organization),
    brand_color: /^#[0-9a-f]{6}$/i.test(String(organization.brand_color || ""))
      ? organization.brand_color
      : DEFAULT_BRAND_COLOR,
  };
}

async function getPublicServices(slug) {
  const organization = await requirePublicOrganization(slug);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("services")
    .select("id, name, description, duration_minutes, price")
    .eq("organization_id", organization.id)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw error;

  return (data || []).map((service) => ({
    id: service.id,
    name: service.name,
    description: service.description || "",
    duration_minutes: service.duration_minutes,
    price: service.price,
    currency: "KZT",
  }));
}

async function getPublicStaff(slug, serviceId) {
  const organization = await requirePublicOrganization(slug);
  const supabase = getSupabaseAdmin();

  const { data: service, error: serviceError } = await supabase
    .from("services")
    .select("id, organization_id, is_active, duration_minutes")
    .eq("id", serviceId)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (serviceError) throw serviceError;
  if (!service) throw appError("Услуга не найдена", "SERVICE_NOT_FOUND", 404);
  if (service.is_active !== true) throw appError("Услуга недоступна", "SERVICE_INACTIVE", 400);

  const { data, error } = await supabase
    .from("staff_services")
    .select("staff_id, staff(id, name, position, is_active)")
    .eq("organization_id", organization.id)
    .eq("service_id", serviceId);

  if (error) throw error;

  const members = (data || [])
    .map((row) => row.staff)
    .filter((member) => member && member.is_active === true)
    .map((member) => ({
      id: member.id,
      name: member.name,
      position: member.position || "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return attachAvailability(supabase, organization, service.duration_minutes, members);
}

async function getPublicSlots(slug, { serviceId, staffId, date }) {
  const organization = await requirePublicOrganization(slug);

  if (!serviceId || !staffId || !date) {
    throw validationError("service_id, staff_id и date обязательны");
  }

  if (isDateTooFarAhead(date, organization.timezone)) {
    return { date, slots: [] };
  }

  const supabase = getSupabaseAdmin();

  const [serviceResult, staffResult, linkResult] = await Promise.all([
    supabase
      .from("services")
      .select("id, duration_minutes, is_active, organization_id")
      .eq("id", serviceId)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    supabase
      .from("staff")
      .select("id, is_active, organization_id")
      .eq("id", staffId)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    supabase
      .from("staff_services")
      .select("staff_id")
      .eq("organization_id", organization.id)
      .eq("service_id", serviceId)
      .eq("staff_id", staffId)
      .maybeSingle(),
  ]);

  const service = assertSupabaseResult(serviceResult, "services");
  const staff = assertSupabaseResult(staffResult, "staff");
  const link = assertSupabaseResult(linkResult, "staff_services");

  if (!service) {
    throw appError("Услуга не найдена", "SERVICE_NOT_FOUND", 404);
  }
  if (service.is_active !== true) {
    throw appError("Услуга недоступна", "SERVICE_INACTIVE", 400);
  }
  if (!staff) {
    throw appError("Сотрудник не найден", "STAFF_NOT_FOUND", 404);
  }
  if (staff.is_active !== true) {
    throw appError("Сотрудник недоступен", "STAFF_INACTIVE", 400);
  }
  if (!link) {
    throw appError("Сотрудник не оказывает эту услугу", "STAFF_SERVICE_MISMATCH", 400);
  }

  const [schedulesResult, bookingsResult] = await Promise.all([
    supabase
      .from("staff_schedules")
      .select("*")
      .eq("organization_id", organization.id)
      .eq("staff_id", staffId),
    supabase
      .from("bookings")
      .select("id, start_time, end_time, status")
      .eq("organization_id", organization.id)
      .eq("staff_id", staffId)
      .eq("booking_date", date),
  ]);

  const schedules = assertSupabaseResult(schedulesResult, "staff_schedules");
  const bookings = assertSupabaseResult(bookingsResult, "bookings");

  const schedule = findScheduleForDate(schedules || [], date);
  const slots = computeSlots({
    schedule,
    durationMinutes: service.duration_minutes,
    bookings: bookings || [],
    dateStr: date,
    timeZone: organization.timezone,
  });

  return { date, slots };
}

function toPublicBookingResponse(booking, service, staff) {
  return {
    success: true,
    booking: {
      reference: booking.public_reference,
      manage_url: booking.manage_token ? `/b/${booking.manage_token}` : "",
      status: booking.status,
      service_name: service.name,
      staff_name: staff.name,
      booking_date: booking.booking_date,
      start_time: formatTimeForInput(booking.start_time),
      end_time: formatTimeForInput(booking.end_time),
    },
  };
}

async function insertPublicBooking(supabase, organization, payload, service, staff, status, extra = {}) {
  const startTime = formatTimeForInput(payload.start_time);
  const endTime = computeBookingEndTime(startTime, service.duration_minutes);
  const insertPayload = {
    organization_id: organization.id,
    service_id: payload.service_id,
    staff_id: payload.staff_id,
    client_name: payload.client_name,
    client_phone: payload.client_phone,
    client_email: payload.client_email,
    client_comment: payload.client_comment,
    booking_date: payload.booking_date,
    start_time: startTime,
    end_time: endTime,
    status,
    source: "public_booking",
    ...extra,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase
      .from("bookings")
      .insert(insertPayload)
      .select("id, public_reference, manage_token, status, booking_date, start_time, end_time")
      .single();

    if (!error && data?.public_reference) {
      if (!REFERENCE_PATTERN.test(data.public_reference)) {
        throw appError("Не удалось создать запись", "BOOKING_REFERENCE_GENERATION_FAILED", 500);
      }
      // id остаётся на сервере (для уведомлений), клиенту уходит только response.
      return { row: data, response: toPublicBookingResponse(data, service, staff) };
    }

    if (isOverlapError(error?.message, error?.code)) {
      throw appError("Это время уже занято. Выберите другой слот", "BOOKING_TIME_CONFLICT", 409);
    }

    if (isReferenceUniqueError(error?.message, error?.code)) {
      continue;
    }

    throw mapDbBookingError(error?.message, error?.code);
  }

  throw appError("Не удалось создать запись", "BOOKING_REFERENCE_GENERATION_FAILED", 500);
}

async function createPublicBooking(slug, body, { honeypotFilled = false, baseUrl = "" } = {}) {
  if (honeypotFilled) {
    return { success: true };
  }

  const organization = await requirePublicOrganization(slug);
  const payload = validatePublicBookingPayload(body);

  if (isDateTooFarAhead(payload.booking_date, organization.timezone)) {
    throw appError(
      `Запись возможна максимум на ${MAX_BOOKING_DAYS_AHEAD} дней вперёд`,
      "VALIDATION_ERROR",
      400
    );
  }

  const startMinutes = timeToMinutes(payload.start_time);
  if (startMinutes === null || isPastSlot(payload.booking_date, startMinutes, organization.timezone)) {
    throw appError("Нельзя записаться на прошедшее время", "BOOKING_IN_PAST", 400);
  }

  const supabase = getSupabaseAdmin();

  const [serviceResult, staffResult, linkResult] = await Promise.all([
    supabase
      .from("services")
      .select("id, name, duration_minutes, is_active")
      .eq("id", payload.service_id)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    supabase
      .from("staff")
      .select("id, name, is_active, telegram_chat_id")
      .eq("id", payload.staff_id)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    supabase
      .from("staff_services")
      .select("staff_id")
      .eq("organization_id", organization.id)
      .eq("service_id", payload.service_id)
      .eq("staff_id", payload.staff_id)
      .maybeSingle(),
  ]);

  const service = assertSupabaseResult(serviceResult, "services");
  const staff = assertSupabaseResult(staffResult, "staff");
  const link = assertSupabaseResult(linkResult, "staff_services");

  if (!service) throw appError("Услуга не найдена", "SERVICE_NOT_FOUND", 404);
  if (service.is_active !== true) throw appError("Услуга недоступна", "SERVICE_INACTIVE", 400);
  if (!staff) throw appError("Сотрудник не найден", "STAFF_NOT_FOUND", 404);
  if (staff.is_active !== true) throw appError("Сотрудник недоступен", "STAFF_INACTIVE", 400);
  if (!link) throw appError("Сотрудник не оказывает эту услугу", "STAFF_SERVICE_MISMATCH", 400);

  await assertClientMayBook(supabase, organization, payload.client_phone);

  // Номер подтверждён в Telegram-боте (если владелец включил проверку).
  // Подтверждение нужно только новым номерам: кто уже подтверждал номер
  // в боте или был в салоне, записывается без лишних шагов.
  const trust = await phoneVerification.trustInfo(organization, payload.client_phone);
  const verification =
    phoneVerification.isRequired(organization) && !trust.trusted
      ? await phoneVerification.requireVerified(organization, body?.verification_token, payload.client_phone)
      : null;

  const { slots } = await getPublicSlots(slug, {
    serviceId: payload.service_id,
    staffId: payload.staff_id,
    date: payload.booking_date,
  });

  const slotAllowed = slots.some(
    (slot) => formatTimeForInput(slot.start_time) === formatTimeForInput(payload.start_time)
  );
  if (!slotAllowed) {
    throw appError("Это время уже занято. Выберите другой слот", "BOOKING_TIME_CONFLICT", 409);
  }

  const status = organization.booking_confirmation_mode === "manual" ? "pending" : "confirmed";

  const { row, response } = await insertPublicBooking(
    supabase,
    organization,
    payload,
    service,
    staff,
    status,
    verification?.chat_id ? { client_telegram_chat_id: verification.chat_id } : {}
  );

  if (verification) await phoneVerification.markUsed(verification.id);

  // Подтверждение записи в Telegram — всем чатам, привязанным к этому номеру.
  const clientChats = [...new Set([verification?.chat_id, ...trust.chatIds].filter(Boolean))];
  for (const chatId of clientChats) {
    void telegramService.sendClientBookingConfirmation(
      chatId,
      {
        organizationName: organization.public_name || organization.name,
        serviceName: service.name,
        staffName: staff.name,
        bookingDate: row.booking_date,
        startTime: row.start_time,
        endTime: row.end_time,
        status: row.status,
      },
      baseUrl && response.booking.manage_url ? `${baseUrl}${response.booking.manage_url}` : ""
    );
  }

  // Не ждём Telegram: уведомление не должно задерживать или ломать ответ клиенту.
  void telegramService.notifyNewBooking({
    organization,
    service,
    staff,
    booking: row,
    client: payload,
  });

  return response;
}

/**
 * Заявка на подтверждение номера: заранее проверяем чёрный список и лимит,
 * чтобы клиент не проходил подтверждение впустую.
 */
async function createPhoneVerification(slug, body = {}) {
  const organization = await requirePublicOrganization(slug);
  const clientPhone = String(body.client_phone || "").trim();
  await assertClientMayBook(getSupabaseAdmin(), organization, clientPhone);
  return phoneVerification.create(organization, clientPhone);
}

module.exports = {
  createPhoneVerification,
  getOrganizationBySlug,
  requirePublicOrganization,
  toPublicOrganization,
  getPublicServices,
  getPublicStaff,
  getPublicSlots,
  createPublicBooking,
  appError,
  mapDbBookingError,
  computeBookingEndTime,
  assertSupabaseResult,
  REFERENCE_PATTERN,
  phoneKey,
  assertClientMayBook,
  MAX_ACTIVE_BOOKINGS_PER_PHONE,
};
