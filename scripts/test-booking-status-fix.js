/**
 * Тесты исправления смены статуса (миграция 007)
 * Требует: 001–007, TEST_EMAIL, TEST_PASSWORD
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

function isInactiveServiceError(message = "") {
  return String(message).includes("BOOKING_SERVICE_INACTIVE");
}

function isInactiveStaffError(message = "") {
  return String(message).includes("BOOKING_STAFF_INACTIVE");
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

function nextWeekdayDate(daysAhead = 3) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

async function createFixture(sb, orgId, suffix) {
  const { data: service, error: serviceErr } = await sb
    .from("services")
    .insert({
      organization_id: orgId,
      name: `StatusFix услуга ${suffix}`,
      price: 1000,
      duration_minutes: 30,
      is_active: true,
    })
    .select("id")
    .single();
  if (serviceErr) fail(serviceErr.message);
  created.serviceIds.push(service.id);

  const { data: staff, error: staffErr } = await sb
    .from("staff")
    .insert({
      organization_id: orgId,
      name: `StatusFix мастер ${suffix}`,
      is_active: true,
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

async function createBooking(sb, orgId, fixture, dateStr, startTime) {
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
      status: "confirmed",
      source: "manual",
    })
    .select("id, status, start_time, end_time")
    .single();

  if (error) return { error };
  created.bookingIds.push(data.id);
  return { data };
}

async function setStatus(sb, bookingId, status) {
  return sb.from("bookings").update({ status }).eq("id", bookingId).select("id, status").single();
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

async function runServiceStatusSuite(sb, orgId, suffix) {
  const fixture = await createFixture(sb, orgId, `${suffix}-service`);
  const dateStr = nextWeekdayDate(3);

  const { data: booking, error: createErr } = await createBooking(sb, orgId, fixture, dateStr, "10:00");
  if (createErr) fail(`Создание записи: ${createErr.message}`);

  const { error: deactivateErr } = await sb
    .from("services")
    .update({ is_active: false })
    .eq("id", fixture.serviceId);
  if (deactivateErr) fail(`Деактивация услуги: ${deactivateErr.message}`);

  const { error: toPendingErr } = await setStatus(sb, booking.id, "pending");
  if (toPendingErr) fail(`confirmed → pending: ${toPendingErr.message}`);
  ok("confirmed → pending при неактивной услуге");

  const { error: toCanceledErr } = await setStatus(sb, booking.id, "canceled");
  if (toCanceledErr) fail(`pending → canceled: ${toCanceledErr.message}`);
  ok("pending → canceled при неактивной услуге");

  const { error: toCompletedErr } = await setStatus(sb, booking.id, "completed");
  if (toCompletedErr) fail(`canceled → completed: ${toCompletedErr.message}`);
  ok("canceled → completed при неактивной услуге");

  const { error: toConfirmedErr } = await setStatus(sb, booking.id, "confirmed");
  if (toConfirmedErr) fail(`completed → confirmed без конфликта: ${toConfirmedErr.message}`);
  ok("completed → confirmed без конфликта");

  const { error: clientUpdateErr } = await sb
    .from("bookings")
    .update({
      client_name: "Новое имя",
      client_phone: "+77009998877",
    })
    .eq("id", booking.id)
    .select("id")
    .single();
  if (clientUpdateErr) fail(`Изменение клиента: ${clientUpdateErr.message}`);
  ok("Изменение имени/телефона клиента при неактивной услуге");

  const { error: rescheduleErr } = await sb
    .from("bookings")
    .update({
      booking_date: dateStr,
      start_time: "11:00",
      end_time: "11:00",
    })
    .eq("id", booking.id);
  if (!rescheduleErr || !isInactiveServiceError(rescheduleErr.message)) {
    fail("Перенос времени при неактивной услуге должен быть запрещён");
  }
  ok("Перенос времени при неактивной услуге запрещён");

  const { error: reactivateErr } = await sb
    .from("services")
    .update({ is_active: true })
    .eq("id", fixture.serviceId);
  if (reactivateErr) fail(`Временная активация услуги: ${reactivateErr.message}`);

  await setStatus(sb, booking.id, "completed");

  const { data: blocker, error: blockerErr } = await createBooking(sb, orgId, fixture, dateStr, "10:00");
  if (blockerErr) fail(`Создание блокирующей записи: ${blockerErr.message}`);

  const { error: deactivateAgainErr } = await sb
    .from("services")
    .update({ is_active: false })
    .eq("id", fixture.serviceId);
  if (deactivateAgainErr) fail(`Повторная деактивация услуги: ${deactivateAgainErr.message}`);

  const { error: conflictErr } = await setStatus(sb, booking.id, "confirmed");
  if (!conflictErr || !isOverlapError(conflictErr.message)) {
    fail("completed → confirmed при занятом времени должен давать конфликт");
  }
  ok("completed → confirmed при занятом времени — ошибка конфликта");

  await sb.from("bookings").delete().eq("id", blocker.id);
  created.bookingIds = created.bookingIds.filter((id) => id !== blocker.id);
}

async function runStaffStatusSuite(sb, orgId, suffix) {
  const fixture = await createFixture(sb, orgId, `${suffix}-staff`);
  const dateStr = nextWeekdayDate(5);

  const { data: booking, error: createErr } = await createBooking(sb, orgId, fixture, dateStr, "12:00");
  if (createErr) fail(`Создание записи (staff): ${createErr.message}`);

  const { error: deactivateErr } = await sb
    .from("staff")
    .update({ is_active: false })
    .eq("id", fixture.staffId);
  if (deactivateErr) fail(`Деактивация сотрудника: ${deactivateErr.message}`);

  const { error: toPendingErr } = await setStatus(sb, booking.id, "pending");
  if (toPendingErr) fail(`confirmed → pending (staff): ${toPendingErr.message}`);

  const { error: toNoShowErr } = await setStatus(sb, booking.id, "no_show");
  if (toNoShowErr) fail(`pending → no_show (staff): ${toNoShowErr.message}`);

  const { error: toCanceledErr } = await setStatus(sb, booking.id, "canceled");
  if (toCanceledErr) fail(`no_show → canceled (staff): ${toCanceledErr.message}`);
  ok("Смена статусов при неактивном сотруднике работает");

  const { error: clientUpdateErr } = await sb
    .from("bookings")
    .update({ client_name: "Другой клиент" })
    .eq("id", booking.id);
  if (clientUpdateErr) fail(`Изменение клиента (staff): ${clientUpdateErr.message}`);
  ok("Изменение клиента при неактивном сотруднике");

  const { error: rescheduleErr } = await sb
    .from("bookings")
    .update({
      booking_date: dateStr,
      start_time: "13:00",
      end_time: "13:00",
    })
    .eq("id", booking.id);
  if (!rescheduleErr || !isInactiveStaffError(rescheduleErr.message)) {
    fail("Перенос времени при неактивном сотруднике должен быть запрещён");
  }
  ok("Перенос времени при неактивном сотруднике запрещён");
}

async function main() {
  if (!url || !anonKey || !email || !password) {
    fail("Задайте SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD");
  }

  const sb = await signIn();
  const orgId = await getOrgId(sb);
  const suffix = Date.now();

  try {
    await runServiceStatusSuite(sb, orgId, suffix);
    await runStaffStatusSuite(sb, orgId, suffix);
    console.log("\nВсе тесты status-fix пройдены.");
  } finally {
    await cleanup(sb);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
