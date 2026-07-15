/**
 * Тесты переноса записей (миграция 008)
 * Требует: 001–008, TEST_EMAIL, TEST_PASSWORD
 */

const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const url = String(process.env.SUPABASE_URL || "").trim();
const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
const email = String(process.env.TEST_EMAIL || "").trim();
const password = String(process.env.TEST_PASSWORD || "").trim();

const created = {
  bookingIds: [],
  staffIds: [],
  serviceIds: [],
};

function fail(msg) {
  console.error("[FAIL]", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[OK]", msg);
}

function isOverlapError(message = "") {
  const text = String(message);
  return (
    text.includes("BOOKING_TIME_CONFLICT") ||
    text.includes("bookings_no_active_overlap") ||
    text.toLowerCase().includes("exclusion constraint") ||
    text.includes("23P01")
  );
}

function isInactiveStaffError(message = "") {
  return String(message).includes("BOOKING_STAFF_INACTIVE");
}

function isInactiveServiceError(message = "") {
  return String(message).includes("BOOKING_SERVICE_INACTIVE");
}

async function signIn() {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) fail(`Вход: ${error.message}`);
  return client;
}

async function getOrgId(client) {
  const { data, error } = await client
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();
  if (error) fail(error.message);
  if (!data?.organization_id) fail("Нет организации");
  return data.organization_id;
}

function nextWeekdayDate(daysAhead = 4) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

function shiftWeekdayDate(dateStr, days) {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() + days);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + (days > 0 ? 1 : -1));
  }
  return date.toISOString().slice(0, 10);
}

async function createFixture(sb, orgId, suffix, { serviceActive = true, staffActive = true } = {}) {
  const { data: service, error: serviceErr } = await sb
    .from("services")
    .insert({
      organization_id: orgId,
      name: `Reschedule услуга ${suffix}`,
      price: 1200,
      duration_minutes: 30,
      is_active: serviceActive,
    })
    .select("id")
    .single();
  if (serviceErr) fail(serviceErr.message);
  created.serviceIds.push(service.id);

  const { data: staff, error: staffErr } = await sb
    .from("staff")
    .insert({
      organization_id: orgId,
      name: `Reschedule мастер ${suffix}`,
      is_active: staffActive,
    })
    .select("id")
    .single();
  if (staffErr) fail(staffErr.message);
  created.staffIds.push(staff.id);

  const { error: linkErr } = await sb.from("staff_services").insert({
    organization_id: orgId,
    staff_id: staff.id,
    service_id: service.id,
  });
  if (linkErr) fail(linkErr.message);

  return { serviceId: service.id, staffId: staff.id };
}

async function createBooking(sb, orgId, fixture, dateStr, startTime, status = "confirmed") {
  const { data, error } = await sb
    .from("bookings")
    .insert({
      organization_id: orgId,
      service_id: fixture.serviceId,
      staff_id: fixture.staffId,
      client_name: "Тест клиент",
      client_phone: "+77001112233",
      booking_date: dateStr,
      start_time: startTime,
      end_time: startTime,
      status,
      source: "manual",
    })
    .select("id, booking_date, start_time, status")
    .single();

  if (error) return { error };
  created.bookingIds.push(data.id);
  return { data };
}

async function cleanup(sb) {
  if (created.bookingIds.length) {
    await sb.from("bookings").delete().in("id", created.bookingIds);
  }
  if (created.staffIds.length) {
    await sb.from("staff").delete().in("id", created.staffIds);
  }
  if (created.serviceIds.length) {
    await sb.from("services").delete().in("id", created.serviceIds);
  }
}

async function main() {
  if (!url || !anonKey || !email || !password) {
    fail("Задайте SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD");
  }

  const sb = await signIn();
  const orgId = await getOrgId(sb);
  const suffix = Date.now();
  const dateStr = nextWeekdayDate(4);
  const newDate = shiftWeekdayDate(dateStr, 1);

  try {
    const fixture = await createFixture(sb, orgId, suffix, { serviceActive: true, staffActive: true });
    const { data: booking, error: createErr } = await createBooking(sb, orgId, fixture, dateStr, "10:00");
    if (createErr) fail(`Создание записи: ${createErr.message}`);

    const { error: deactivateStaffErr } = await sb
      .from("staff")
      .update({ is_active: false })
      .eq("id", fixture.staffId);
    if (deactivateStaffErr) fail(deactivateStaffErr.message);

    const { error: statusErr } = await sb
      .from("bookings")
      .update({ status: "pending" })
      .eq("id", booking.id)
      .select("id, status")
      .single();
    if (statusErr) fail(`Смена статуса: ${statusErr.message}`);
    ok("Смена только статуса при неактивном сотруднике — разрешена");

    const { error: clientErr } = await sb
      .from("bookings")
      .update({ client_name: "Новое имя клиента" })
      .eq("id", booking.id);
    if (clientErr) fail(`Смена имени клиента: ${clientErr.message}`);
    ok("Смена имени клиента — разрешена");

    const { error: timeRescheduleErr } = await sb
      .from("bookings")
      .update({
        booking_date: dateStr,
        start_time: "11:00",
        end_time: "11:00",
      })
      .eq("id", booking.id);
    if (!timeRescheduleErr || !isInactiveStaffError(timeRescheduleErr.message)) {
      fail("Перенос времени при неактивном сотруднике должен быть запрещён");
    }
    ok("Перенос времени при неактивном сотруднике — запрещён");

    const { error: dateRescheduleErr } = await sb
      .from("bookings")
      .update({
        booking_date: newDate,
        start_time: "10:00",
        end_time: "10:00",
      })
      .eq("id", booking.id);
    if (!dateRescheduleErr || !isInactiveStaffError(dateRescheduleErr.message)) {
      fail("Перенос даты при неактивном сотруднике должен быть запрещён");
    }
    ok("Перенос даты при неактивном сотруднике — запрещён");

    await sb.from("staff").update({ is_active: true }).eq("id", fixture.staffId);
    await sb.from("services").update({ is_active: false }).eq("id", fixture.serviceId);

    const { error: serviceTimeErr } = await sb
      .from("bookings")
      .update({
        booking_date: dateStr,
        start_time: "12:00",
        end_time: "12:00",
      })
      .eq("id", booking.id);
    if (!serviceTimeErr || !isInactiveServiceError(serviceTimeErr.message)) {
      fail("Перенос времени при неактивной услуге должен быть запрещён");
    }
    ok("Перенос времени при неактивной услуге — запрещён");

    await sb.from("services").update({ is_active: true }).eq("id", fixture.serviceId);

    const activeStaff = await createFixture(sb, orgId, `${suffix}-active-staff`);
    const { error: moveErr } = await sb
      .from("bookings")
      .update({
        service_id: fixture.serviceId,
        staff_id: activeStaff.staffId,
        booking_date: newDate,
        start_time: "14:00",
        end_time: "14:00",
      })
      .eq("id", booking.id)
      .select("id, staff_id, booking_date, start_time")
      .single();
    if (moveErr) fail(`Перенос на активного сотрудника: ${moveErr.message}`);
    ok("Перенос на активного сотрудника и активную услугу — разрешён");

    const { data: blocker, error: blockerErr } = await createBooking(
      sb,
      orgId,
      activeStaff,
      newDate,
      "14:00"
    );
    if (blockerErr) fail(`Блокирующая запись: ${blockerErr.message}`);

    await sb.from("bookings").update({ status: "completed" }).eq("id", booking.id);

    const { error: conflictErr } = await sb
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", booking.id);
    if (!conflictErr || !isOverlapError(conflictErr.message)) {
      fail("Конфликт времени при возврате в confirmed должен быть запрещён");
    }
    ok("Конфликт времени по-прежнему запрещён");

    await sb.from("bookings").delete().eq("id", blocker.id);
    created.bookingIds = created.bookingIds.filter((id) => id !== blocker.id);

    console.log("\nВсе тесты reschedule-fix пройдены.");
  } finally {
    await cleanup(sb);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
