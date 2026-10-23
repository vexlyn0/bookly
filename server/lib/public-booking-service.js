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
} = require("./slots");
const { validatePublicBookingPayload, validationError } = require("./public-booking-validation");
const { requireOrganizationOperational } = require("./subscription-service");
const telegramService = require("./telegram-service");

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
  booking_confirmation_mode
`;

const REFERENCE_PATTERN = /^BK-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

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
    .select("id, organization_id, is_active")
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

  return (data || [])
    .map((row) => row.staff)
    .filter((member) => member && member.is_active === true)
    .map((member) => ({
      id: member.id,
      name: member.name,
      position: member.position || "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
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

async function insertPublicBooking(supabase, organization, payload, service, staff, status) {
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

async function createPublicBooking(slug, body, { honeypotFilled = false } = {}) {
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
    status
  );

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

module.exports = {
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
};
