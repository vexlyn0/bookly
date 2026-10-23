/**
 * Unit-тесты личной ссылки клиента (отмена / перенос) — без Supabase и сети
 * Использование: npm run test:client-manage-unit
 */

const assert = require("assert");

// --- Подмена Supabase: таблицы в памяти --------------------------------------

const tables = { bookings: [], organizations: [], staff_schedules: [] };
const updates = [];

function fakeSupabase() {
  return {
    from(table) {
      const filters = [];
      let single = false;
      let patch = null;
      const builder = {
        select() {
          return builder;
        },
        update(payload) {
          patch = payload;
          return builder;
        },
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        in(column, values) {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        maybeSingle() {
          single = true;
          return builder;
        },
        then(resolve, reject) {
          let rows = (tables[table] || []).filter((row) => filters.every((f) => f(row)));
          if (patch) {
            updates.push({ table, patch });
            rows.forEach((row) => Object.assign(row, patch));
          }
          rows = JSON.parse(JSON.stringify(rows));
          const result = { data: single ? rows[0] || null : rows, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

require("../server/lib/supabase-admin").getSupabaseAdmin = () => fakeSupabase();
require("../server/lib/subscription-service").requireOrganizationOperational = async () => ({});

const notifications = [];
require("../server/lib/booking-notify-service").deliverChangeNotifications = async (args) => {
  notifications.push(args);
  return { sent: 1 };
};

const manage = require("../server/lib/client-manage-service");
const { formatDateInTimezone } = require("../server/lib/slots");

const TOKEN = "0123456789abcdef0123456789abcdef";
const ORG = "0a000000-0000-4000-8000-000000000001";
const STAFF = "a1000000-0000-4000-8000-000000000001";
const TZ = "Asia/Almaty";

function dayFromNow(days) {
  return formatDateInTimezone(new Date(Date.now() + days * 86400000), TZ);
}

function ok(message) {
  console.log("[OK]", message);
}

function reset({ booking = {}, org = {} } = {}) {
  updates.length = 0;
  notifications.length = 0;
  tables.organizations = [
    {
      id: ORG,
      slug: "qwerty",
      name: "qwerty",
      public_name: null,
      phone: "+77001112233",
      address: "",
      timezone: TZ,
      client_manage_cutoff_hours: 2,
      ...org,
    },
  ];
  tables.bookings = [
    {
      id: "b1",
      manage_token: TOKEN,
      organization_id: ORG,
      service_id: "s1",
      staff_id: STAFF,
      status: "confirmed",
      booking_date: dayFromNow(2),
      start_time: "12:00:00",
      end_time: "13:00:00",
      client_name: "Алан",
      client_phone: "+77001234567",
      public_reference: "BK-ABC234",
      client_reschedule_count: 0,
      services: { name: "Стрижка", duration_minutes: 60 },
      staff: { name: "Ерлан" },
      ...booking,
    },
  ];
  // Работает каждый день 10:00–20:00
  tables.staff_schedules = Array.from({ length: 7 }, (_, day) => ({
    organization_id: ORG,
    staff_id: STAFF,
    day_of_week: day,
    is_working: true,
    start_time: "10:00:00",
    end_time: "20:00:00",
  }));
}

// -----------------------------------------------------------------------------

function testState() {
  const org = { timezone: TZ, client_manage_cutoff_hours: 2 };
  const now = new Date("2026-10-24T06:00:00Z"); // 11:00 в Алматы (UTC+5)

  const at = (date, time, extra = {}) => ({ status: "confirmed", booking_date: date, start_time: time, ...extra });

  assert.strictEqual(manage.minutesUntil("2026-10-24", "14:00", TZ, now), 180);
  assert.strictEqual(manage.minutesUntil("2026-10-25", "11:00", TZ, now), 1440);

  assert.deepStrictEqual(manage.getManageState(at("2026-10-24", "14:00"), org, now), {
    canCancel: true,
    canReschedule: true,
    reason: null,
  });
  assert.strictEqual(manage.getManageState(at("2026-10-24", "12:30"), org, now).reason, "too_late");
  assert.strictEqual(manage.getManageState(at("2026-10-24", "10:00"), org, now).reason, "inactive");
  assert.strictEqual(manage.getManageState(at("2026-10-25", "10:00", { status: "canceled" }), org, now).reason, "inactive");
  assert.strictEqual(
    manage.getManageState(at("2026-10-25", "10:00"), { ...org, client_manage_cutoff_hours: null }, now).reason,
    "disabled"
  );
  const limited = manage.getManageState(at("2026-10-25", "10:00", { client_reschedule_count: 2 }), org, now);
  assert.ok(limited.canCancel && !limited.canReschedule && limited.reason === "reschedule_limit");
  ok("Правила: срок отмены, прошедшие/отменённые, «только через салон», лимит переносов");
}

async function testInfo() {
  reset();
  const info = await manage.getManageInfo(TOKEN);
  assert.strictEqual(info.booking.start_time, "12:00");
  assert.strictEqual(info.booking.staff_name, "Ерлан");
  assert.ok(info.can_cancel && info.can_reschedule);
  assert.strictEqual(info.reschedules_left, 2);
  assert.ok(!("client_phone" in info.booking), "телефон клиента не отдаём");
  assert.ok(!("id" in info.booking), "внутренний id не отдаём");

  await assert.rejects(manage.getManageInfo("bad-token"), (e) => e.status === 404);
  await assert.rejects(manage.getManageInfo("f".repeat(32)), (e) => e.status === 404);
  ok("Просмотр записи по ссылке; неверный токен → 404");
}

async function testCancel() {
  reset();
  const info = await manage.cancelByToken(TOKEN);
  assert.strictEqual(info.booking.status, "canceled");
  assert.ok(!info.can_cancel);
  assert.deepStrictEqual(updates[0].patch, { status: "canceled" });
  assert.strictEqual(notifications.length, 1);
  assert.strictEqual(notifications[0].byClient, true);
  assert.strictEqual(notifications[0].previous.status, "confirmed");

  await assert.rejects(manage.cancelByToken(TOKEN), (e) => e.code === "CANCEL_NOT_ALLOWED");

  reset({ booking: { booking_date: dayFromNow(0), start_time: "00:00:00" } });
  await assert.rejects(manage.cancelByToken(TOKEN), (e) => e.status === 403);
  assert.strictEqual(updates.length, 0);
  ok("Отмена: статус canceled, мастер уведомлён; повторно и поздно — нельзя");
}

async function testReschedule() {
  reset();
  const target = dayFromNow(3);

  const { slots } = await manage.getManageSlots(TOKEN, target);
  assert.ok(slots.some((s) => s.start_time === "15:00"));

  const info = await manage.rescheduleByToken(TOKEN, { booking_date: target, start_time: "15:00" });
  assert.strictEqual(info.booking.booking_date, target);
  assert.strictEqual(info.booking.start_time, "15:00");
  assert.strictEqual(info.booking.end_time, "16:00");
  assert.strictEqual(info.reschedules_left, 1);
  assert.strictEqual(notifications[0].byClient, true);
  assert.strictEqual(notifications[0].previous.start_time, "12:00:00");

  // Своё текущее время не предлагается, соседний слот не блокируется собственной записью
  const same = await manage.getManageSlots(TOKEN, target);
  assert.ok(!same.slots.some((s) => s.start_time === "15:00"));
  assert.ok(same.slots.some((s) => s.start_time === "15:30"));

  // Занятое другим клиентом время
  tables.bookings.push({
    id: "b2",
    organization_id: ORG,
    staff_id: STAFF,
    status: "confirmed",
    booking_date: target,
    start_time: "17:00:00",
    end_time: "18:00:00",
  });
  await assert.rejects(
    manage.rescheduleByToken(TOKEN, { booking_date: target, start_time: "17:00" }),
    (e) => e.code === "BOOKING_TIME_CONFLICT"
  );

  await manage.rescheduleByToken(TOKEN, { booking_date: target, start_time: "11:00" });
  await assert.rejects(
    manage.rescheduleByToken(TOKEN, { booking_date: target, start_time: "12:00" }),
    (e) => e.code === "RESCHEDULE_NOT_ALLOWED"
  );
  await assert.rejects(manage.getManageSlots(TOKEN, target), (e) => e.status === 403);

  await assert.rejects(
    manage.rescheduleByToken(TOKEN, { booking_date: "завтра", start_time: "12:00" }),
    (e) => e.status === 400
  );
  ok("Перенос: только свободное время, не больше 2 раз, мастер уведомлён");
}

async function testRoutes() {
  const request = require("supertest");
  const app = require("../server/app");
  reset();
  const res = await request(app).get(`/api/public/manage/${TOKEN}`).expect(200);
  assert.strictEqual(res.body.ok, true);
  await request(app).get("/api/public/manage/nope").expect(404);
  const page = await request(app).get(`/b/${TOKEN}`).expect(200);
  assert.ok(page.text.includes("pm-panel"));
  ok("API /api/public/manage/:token и страница /b/:token");
}

(async () => {
  testState();
  await testInfo();
  await testCancel();
  await testReschedule();
  await testRoutes();
  console.log("\nВсе unit-тесты личной ссылки клиента пройдены.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
