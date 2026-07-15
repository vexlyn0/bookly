/**
 * Тесты hardening бронирований (миграция 006)
 * Требует: 001–006, TEST_EMAIL, TEST_PASSWORD
 * Опционально: TEST_EMAIL_B для проверки RLS между организациями
 */

const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const url = String(process.env.SUPABASE_URL || "").trim();
const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
const email = String(process.env.TEST_EMAIL || "").trim();
const password = String(process.env.TEST_PASSWORD || "").trim();
const emailB = String(process.env.TEST_EMAIL_B || "").trim();
const passwordB = String(process.env.TEST_PASSWORD_B || "").trim();

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

function isPastError(message = "") {
  return String(message).includes("BOOKING_IN_PAST");
}

function isScheduleError(message = "") {
  return String(message).includes("BOOKING_OUTSIDE_SCHEDULE");
}

async function signIn(userEmail, userPassword) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({
    email: userEmail,
    password: userPassword,
  });
  if (error) fail(`Вход (${userEmail}): ${error.message}`);
  return client;
}

async function getOrgId(client) {
  const { data, error } = await client
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();
  if (error) fail(`organization_members: ${error.message}`);
  if (!data?.organization_id) fail("Нет организации у тестового пользователя");
  return data.organization_id;
}

function nextWeekdayDate(daysAhead = 2) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

function yesterdayDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function createFixture(sb, orgId, suffix) {
  const { data: service, error: serviceErr } = await sb
    .from("services")
    .insert({
      organization_id: orgId,
      name: `Hardening услуга ${suffix}`,
      price: 1500,
      duration_minutes: 30,
      is_active: true,
    })
    .select("id")
    .single();
  if (serviceErr) fail(`Создание услуги: ${serviceErr.message}`);
  created.serviceIds.push(service.id);

  const { data: staff, error: staffErr } = await sb
    .from("staff")
    .insert({
      organization_id: orgId,
      name: `Hardening мастер ${suffix}`,
      is_active: true,
    })
    .select("id")
    .single();
  if (staffErr) fail(`Создание сотрудника: ${staffErr.message}`);
  created.staffIds.push(staff.id);

  const { error: linkErr } = await sb.from("staff_services").insert({
    organization_id: orgId,
    staff_id: staff.id,
    service_id: service.id,
  });
  if (linkErr) fail(`Привязка услуги: ${linkErr.message}`);

  return { serviceId: service.id, staffId: staff.id };
}

async function createBooking(sb, orgId, fixture, dateStr, startTime, extra = {}) {
  const { data, error } = await sb
    .from("bookings")
    .insert({
      organization_id: orgId,
      service_id: fixture.serviceId,
      staff_id: fixture.staffId,
      client_name: extra.client_name || "Тест клиент",
      client_phone: extra.client_phone || "+77001112233",
      booking_date: dateStr,
      start_time: startTime,
      end_time: startTime,
      status: extra.status || "confirmed",
      source: "manual",
    })
    .select("id, end_time, status")
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

async function assertMigration006(sb, orgId, fixture, dateStr) {
  const { error } = await createBooking(sb, orgId, fixture, yesterdayDate(), "10:00");
  if (!error || !isPastError(error.message)) {
    fail("Миграция 006 не применена: BOOKING_IN_PAST не срабатывает для записей в прошлом");
  }
  ok("Миграция 006 обнаружена (BOOKING_IN_PAST)");

  const { error: overlapErr } = await createBooking(sb, orgId, fixture, dateStr, "10:00");
  if (overlapErr) fail(`Базовая запись не создана: ${overlapErr.message}`);

  const { error: conflictErr } = await createBooking(sb, orgId, fixture, dateStr, "10:15");
  if (!conflictErr || !isOverlapError(conflictErr.message)) {
    fail("Пересечение не блокируется (ожидался EXCLUDE или BOOKING_TIME_CONFLICT)");
  }
  ok("EXCLUDE / конфликт времени работает");
}

async function main() {
  if (!url || !anonKey || !email || !password) {
    fail("Задайте SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD");
  }

  const probe = createClient(url, anonKey);
  const { error: probeErr } = await probe.from("bookings").select("id").limit(1);
  if (probeErr?.code === "PGRST205") fail("Таблица bookings не найдена. Выполните 005_bookings.sql");

  const sb = await signIn(email, password);
  const orgId = await getOrgId(sb);
  const dateStr = nextWeekdayDate(2);
  const suffix = Date.now();
  const fixture = await createFixture(sb, orgId, suffix);

  try {
    await assertMigration006(sb, orgId, fixture, dateStr);

    const { error: pastErr } = await createBooking(sb, orgId, fixture, yesterdayDate(), "12:00");
    if (!pastErr || !isPastError(pastErr.message)) {
      fail("Запись в прошлом должна быть запрещена (BOOKING_IN_PAST)");
    }
    ok("Запись в прошлом запрещена");

    const { data: first } = await createBooking(sb, orgId, fixture, dateStr, "11:00");
    if (!first) fail("Не удалось создать первую запись 11:00");

    const { error: overlapErr } = await createBooking(sb, orgId, fixture, dateStr, "11:15");
    if (!overlapErr || !isOverlapError(overlapErr.message)) {
      fail("Последовательное пересечение не заблокировано");
    }
    ok("Последовательное пересечение заблокировано");

    const { error: adjacentErr } = await createBooking(sb, orgId, fixture, dateStr, "11:30");
    if (adjacentErr) fail(`Смежный слот 11:30 должен быть разрешён: ${adjacentErr.message}`);
    ok("Запись ровно после окончания предыдущей разрешена");

    const parallelDate = nextWeekdayDate(3);
    const parallelFixture = await createFixture(sb, orgId, `${suffix}-parallel`);

    const clientA = await signIn(email, password);
    const clientB = await signIn(email, password);

    const [parallelA, parallelB] = await Promise.all([
      clientA
        .from("bookings")
        .insert({
          organization_id: orgId,
          service_id: parallelFixture.serviceId,
          staff_id: parallelFixture.staffId,
          client_name: "Параллель A",
          client_phone: "+77001110001",
          booking_date: parallelDate,
          start_time: "14:00",
          end_time: "14:00",
          status: "confirmed",
          source: "manual",
        })
        .select("id")
        .single(),
      clientB
        .from("bookings")
        .insert({
          organization_id: orgId,
          service_id: parallelFixture.serviceId,
          staff_id: parallelFixture.staffId,
          client_name: "Параллель B",
          client_phone: "+77001110002",
          booking_date: parallelDate,
          start_time: "14:00",
          end_time: "14:00",
          status: "confirmed",
          source: "manual",
        })
        .select("id")
        .single(),
    ]);

    const parallelResults = [parallelA, parallelB];
    const parallelSuccess = parallelResults.filter((r) => !r.error && r.data?.id);
    const parallelFailed = parallelResults.filter((r) => r.error && isOverlapError(r.error.message));

    if (parallelSuccess.length !== 1 || parallelFailed.length !== 1) {
      fail("Параллельные вставки: одна должна пройти, вторая — конфликт");
    }

    if (parallelSuccess[0].data?.id) created.bookingIds.push(parallelSuccess[0].data.id);
    ok("Параллельная гонка: только одна запись создана");

    const canceledFixture = await createFixture(sb, orgId, `${suffix}-cancel`);
    const cancelDate = nextWeekdayDate(4);
    const { data: canceledBooking } = await createBooking(
      sb,
      orgId,
      canceledFixture,
      cancelDate,
      "15:00"
    );
    if (!canceledBooking) fail("Не удалось создать запись для теста canceled");

    const { error: cancelStatusErr } = await sb
      .from("bookings")
      .update({ status: "canceled" })
      .eq("id", canceledBooking.id);
    if (cancelStatusErr) fail(`Отмена: ${cancelStatusErr.message}`);

    const { error: afterCancelErr } = await createBooking(
      sb,
      orgId,
      canceledFixture,
      cancelDate,
      "15:00"
    );
    if (afterCancelErr) fail(`После canceled слот должен быть свободен: ${afterCancelErr.message}`);
    ok("canceled не блокирует время");

    const completedFixture = await createFixture(sb, orgId, `${suffix}-completed`);
    const completedDate = nextWeekdayDate(5);
    const { data: completedBooking } = await createBooking(
      sb,
      orgId,
      completedFixture,
      completedDate,
      "16:00"
    );
    if (!completedBooking) fail("Не удалось создать запись для теста completed");

    const { error: completeStatusErr } = await sb
      .from("bookings")
      .update({ status: "completed" })
      .eq("id", completedBooking.id);
    if (completeStatusErr) fail(`Завершение: ${completeStatusErr.message}`);

    const { error: afterCompletedErr } = await createBooking(
      sb,
      orgId,
      completedFixture,
      completedDate,
      "16:00"
    );
    if (afterCompletedErr) fail(`После completed слот должен быть свободен: ${afterCompletedErr.message}`);
    ok("completed не блокирует время");

    const deactivateServiceFixture = await createFixture(sb, orgId, `${suffix}-ds`);
    const deactivateServiceDate = nextWeekdayDate(6);
    const { data: bookingForServiceDeactivate } = await createBooking(
      sb,
      orgId,
      deactivateServiceFixture,
      deactivateServiceDate,
      "12:00"
    );
    if (!bookingForServiceDeactivate) fail("Не удалось создать запись для деактивации услуги");

    const { error: deactivateServiceErr } = await sb
      .from("services")
      .update({ is_active: false })
      .eq("id", deactivateServiceFixture.serviceId);
    if (deactivateServiceErr) fail(`Деактивация услуги: ${deactivateServiceErr.message}`);

    const { error: cancelAfterServiceErr } = await sb
      .from("bookings")
      .update({ status: "canceled" })
      .eq("id", bookingForServiceDeactivate.id)
      .select("id, status")
      .single();
    if (cancelAfterServiceErr) {
      fail(`Отмена после деактивации услуги: ${cancelAfterServiceErr.message}`);
    }
    ok("Отмена записи работает после деактивации услуги");

    const deactivateStaffFixture = await createFixture(sb, orgId, `${suffix}-dst`);
    const deactivateStaffDate = nextWeekdayDate(7);
    const { data: bookingForStaffDeactivate } = await createBooking(
      sb,
      orgId,
      deactivateStaffFixture,
      deactivateStaffDate,
      "13:00"
    );
    if (!bookingForStaffDeactivate) fail("Не удалось создать запись для деактивации сотрудника");

    const { error: deactivateStaffErr } = await sb
      .from("staff")
      .update({ is_active: false })
      .eq("id", deactivateStaffFixture.staffId);
    if (deactivateStaffErr) fail(`Деактивация сотрудника: ${deactivateStaffErr.message}`);

    const { error: cancelAfterStaffErr } = await sb
      .from("bookings")
      .update({ status: "canceled" })
      .eq("id", bookingForStaffDeactivate.id)
      .select("id, status")
      .single();
    if (cancelAfterStaffErr) {
      fail(`Отмена после деактивации сотрудника: ${cancelAfterStaffErr.message}`);
    }
    ok("Отмена записи работает после деактивации сотрудника");

    const scheduleFixture = await createFixture(sb, orgId, `${suffix}-sched`);
    const scheduleDate = nextWeekdayDate(8);
    const { error: outsideScheduleErr } = await createBooking(
      sb,
      orgId,
      scheduleFixture,
      scheduleDate,
      "07:00"
    );
    if (!outsideScheduleErr || !isScheduleError(outsideScheduleErr.message)) {
      fail("Перенос/создание вне графика должно быть запрещено (BOOKING_OUTSIDE_SCHEDULE)");
    }
    ok("Запись вне рабочего графика запрещена");

    if (emailB && passwordB) {
      const clientBOrg = await signIn(emailB, passwordB);
      const rlsFixture = await createFixture(sb, orgId, `${suffix}-rls`);
      const rlsDate = nextWeekdayDate(9);
      const { data: rlsBooking } = await createBooking(sb, orgId, rlsFixture, rlsDate, "10:00");
      if (!rlsBooking) fail("Не удалось создать запись для RLS");

      const { data: leaked } = await clientBOrg
        .from("bookings")
        .select("id")
        .eq("id", rlsBooking.id)
        .maybeSingle();
      if (leaked) fail("Утечка: пользователь B видит запись организации A");

      const { error: crossOrgUpdateErr } = await clientBOrg
        .from("bookings")
        .update({ status: "canceled" })
        .eq("id", rlsBooking.id);
      if (!crossOrgUpdateErr) fail("Пользователь B не должен менять записи организации A");

      ok("RLS между двумя организациями сохраняется");
    } else {
      console.log("[SKIP] RLS между организациями — задайте TEST_EMAIL_B и TEST_PASSWORD_B");
    }

    console.log("\nВсе тесты hardening пройдены.");
  } finally {
    await cleanup(sb);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
