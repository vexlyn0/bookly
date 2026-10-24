/**
 * Unit-тесты уведомлений мастеру об изменениях записи (без Supabase и без сети)
 * Использование: npm run test:booking-notify-unit
 */

const assert = require("assert");

// --- Подмена Supabase: таблицы в памяти, фильтры eq / in --------------------

const tables = { organization_members: [], organizations: [], bookings: [], staff: [] };

function fakeSupabase() {
  return {
    from(table) {
      const filters = [];
      let single = false;
      const builder = {
        select() {
          return builder;
        },
        update() {
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
          const rows = (tables[table] || []).filter((row) => filters.every((f) => f(row)));
          const result = { data: single ? rows[0] || null : rows, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

require("../server/lib/supabase-admin").getSupabaseAdmin = () => fakeSupabase();

// --- Подмена Telegram Bot API ------------------------------------------------

const sent = [];
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body || "{}");
  sent.push(body);
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
};

const config = require("../server/config");
config.telegram.token = "test-token";
config.telegram.isConfigured = true;

const telegram = require("../server/lib/telegram-service");
const { notifyBookingChange, sanitizeSnapshot, buildMessage } = require("../server/lib/booking-notify-service");

const USER = "u0000000-0000-4000-8000-000000000001";
const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const BOOKING = "b1000000-0000-4000-8000-000000000001";
const ALAN = "a1000000-0000-4000-8000-000000000001";
const DANA = "a2000000-0000-4000-8000-000000000002";
const STRANGER = "a3000000-0000-4000-8000-000000000003";

const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const later = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);

function ok(message) {
  console.log("[OK]", message);
}

function bookingRow(overrides = {}) {
  return {
    id: BOOKING,
    organization_id: ORG,
    status: "confirmed",
    staff_id: ALAN,
    booking_date: future,
    start_time: "14:00:00",
    end_time: "15:00:00",
    client_name: "Алан",
    client_phone: "+77001234567",
    client_email: null,
    client_comment: null,
    public_reference: null,
    services: { name: "Стрижка" },
    staff: { name: "Алан" },
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    staff_id: ALAN,
    booking_date: future,
    start_time: "12:00:00",
    end_time: "13:00:00",
    status: "confirmed",
    client_name: "Алан",
    client_phone: "+77001234567",
    service_name: "Стрижка",
    ...overrides,
  };
}

function reset(booking = bookingRow()) {
  sent.length = 0;
  tables.organization_members = [{ user_id: USER, organization_id: ORG }];
  tables.organizations = [{ id: ORG, name: "Барбершоп", public_name: null, timezone: "Asia/Almaty" }];
  tables.bookings = booking ? [booking] : [];
  tables.staff = [
    { id: ALAN, organization_id: ORG, name: "Алан", telegram_chat_id: "111" },
    { id: DANA, organization_id: ORG, name: "Дана", telegram_chat_id: "222" },
    { id: STRANGER, organization_id: OTHER_ORG, name: "Чужой", telegram_chat_id: "999" },
  ];
}

// -----------------------------------------------------------------------------

function testPlan() {
  const plan = (event, booking, previous) =>
    telegram.planBookingChangeNotifications({ event, booking, previous }).map((i) => `${i.kind}:${i.staffId}`);

  const before = { staff_id: ALAN, booking_date: future, start_time: "12:00:00", status: "confirmed" };

  assert.deepStrictEqual(plan("created", { staff_id: ALAN, status: "confirmed" }), [`new:${ALAN}`]);
  assert.deepStrictEqual(plan("created", { staff_id: ALAN, status: "completed" }), []);
  assert.deepStrictEqual(plan("updated", { ...before, start_time: "14:00" }, before), [`rescheduled:${ALAN}`]);
  assert.deepStrictEqual(plan("updated", { ...before, booking_date: later }, before), [`rescheduled:${ALAN}`]);
  assert.deepStrictEqual(plan("updated", { ...before, start_time: "12:00" }, before), [], "только данные клиента");
  assert.deepStrictEqual(plan("updated", { ...before, staff_id: DANA }, before), [
    `reassigned:${ALAN}`,
    `new:${DANA}`,
  ]);
  assert.deepStrictEqual(plan("updated", { ...before, status: "canceled" }, before), [`canceled:${ALAN}`]);
  assert.deepStrictEqual(
    plan("updated", { ...before, status: "confirmed" }, { ...before, status: "canceled" }),
    [`new:${ALAN}`],
    "восстановленная запись"
  );
  assert.deepStrictEqual(plan("updated", { ...before, status: "completed" }, before), []);
  assert.deepStrictEqual(plan("updated", { ...before, status: "confirmed" }, { ...before, status: "pending" }), []);
  assert.deepStrictEqual(plan("deleted", null, before), [`deleted:${ALAN}`]);
  assert.deepStrictEqual(plan("deleted", null, { ...before, status: "completed" }), []);
  ok("План уведомлений: новая / перенос / другой мастер / отмена / удаление");
}

function testSanitize() {
  assert.ok(sanitizeSnapshot(snapshot()));
  assert.strictEqual(sanitizeSnapshot(snapshot({ staff_id: "x" })), null);
  assert.strictEqual(sanitizeSnapshot(snapshot({ booking_date: "24.10.2026" })), null);
  assert.strictEqual(sanitizeSnapshot(snapshot({ status: "hacked" })), null);
  assert.strictEqual(sanitizeSnapshot(null), null);
  assert.strictEqual(sanitizeSnapshot(snapshot({ client_name: "x".repeat(500) })).client_name.length, 120);
  ok("Снимок «до изменения» проверяется строго");
}

async function testReschedule() {
  reset();
  const result = await notifyBookingChange(USER, { event: "updated", booking_id: BOOKING, previous: snapshot() });
  assert.strictEqual(result.sent, 1);
  assert.strictEqual(sent[0].chat_id, "111");
  assert.ok(sent[0].text.includes("Запись перенесена"));
  assert.ok(sent[0].text.includes("Было: <s>"));
  assert.ok(sent[0].text.includes("12:00"));
  assert.ok(sent[0].text.includes("14:00–15:00"));
  const byClient = buildMessage("rescheduled", {
    organization: tables.organizations[0],
    booking: bookingRow(),
    previous: snapshot(),
    staffById: new Map(),
    byClient: true,
  });
  assert.ok(byClient.includes("Клиент перенёс запись"));
  ok("Перенос 12:00 → 14:00: мастеру приходит «Запись перенесена», было/стало; от клиента — «Клиент перенёс»");
}

async function testReassign() {
  reset(bookingRow({ staff_id: DANA, staff: { name: "Дана" } }));
  const result = await notifyBookingChange(USER, {
    event: "updated",
    booking_id: BOOKING,
    previous: snapshot({ start_time: "14:00:00", end_time: "15:00:00" }),
  });
  assert.strictEqual(result.sent, 2);
  const toAlan = sent.find((m) => m.chat_id === "111");
  const toDana = sent.find((m) => m.chat_id === "222");
  assert.ok(toAlan.text.includes("передана другому мастеру"));
  assert.ok(toAlan.text.includes("Теперь у мастера: Дана"));
  assert.ok(toDana.text.includes("Новая запись"));
  ok("Передача другому мастеру: старому «передана», новому «Новая запись»");
}

async function testCancelAndDelete() {
  reset(bookingRow({ status: "canceled" }));
  let result = await notifyBookingChange(USER, { event: "updated", booking_id: BOOKING, previous: snapshot() });
  assert.strictEqual(result.sent, 1);
  assert.ok(sent[0].text.includes("Запись отменена"));
  assert.ok(sent[0].text.includes("12:00"), "время до отмены");

  reset(null);
  result = await notifyBookingChange(USER, { event: "deleted", booking_id: BOOKING, previous: snapshot() });
  assert.strictEqual(result.sent, 1);
  assert.ok(sent[0].text.includes("Запись удалена"));
  assert.ok(sent[0].text.includes("Стрижка"));

  // Запись на самом деле существует — «удаление» не рассылаем.
  reset();
  result = await notifyBookingChange(USER, { event: "deleted", booking_id: BOOKING, previous: snapshot() });
  assert.strictEqual(result.sent, 0);
  ok("Отмена и удаление; ложное «удалена» для существующей записи не шлётся");
}

async function testGuards() {
  reset(bookingRow({ organization_id: OTHER_ORG }));
  await assert.rejects(
    notifyBookingChange(USER, { event: "created", booking_id: BOOKING }),
    (error) => error.status === 404
  );
  assert.strictEqual(sent.length, 0);

  // Снимок с мастером чужой организации — сообщение не уходит.
  reset(null);
  const result = await notifyBookingChange(USER, {
    event: "deleted",
    booking_id: BOOKING,
    previous: snapshot({ staff_id: STRANGER }),
  });
  assert.strictEqual(result.sent, 0);

  // Прошедшие записи не тревожат мастера.
  reset(bookingRow({ booking_date: past }));
  assert.strictEqual(
    (await notifyBookingChange(USER, { event: "created", booking_id: BOOKING })).sent,
    0
  );

  // Мастер без Telegram — просто пропускаем.
  reset();
  tables.staff[0].telegram_chat_id = null;
  assert.strictEqual(
    (await notifyBookingChange(USER, { event: "updated", booking_id: BOOKING, previous: snapshot() })).sent,
    0
  );

  await assert.rejects(
    notifyBookingChange(USER, { event: "updated", booking_id: BOOKING }),
    (error) => error.status === 400
  );
  await assert.rejects(
    notifyBookingChange(USER, { event: "hack", booking_id: BOOKING }),
    (error) => error.status === 400
  );
  ok("Чужая запись → 404, чужой мастер / прошлое / без Telegram — не шлём, мусор → 400");
}

async function testOwnerCopies() {
  const { deliverChangeNotifications } = require("../server/lib/booking-notify-service");
  const withOwner = (extra = {}) => {
    tables.organizations[0] = {
      ...tables.organizations[0],
      owner_telegram_chat_id: "500",
      owner_notify_bookings: true,
      owner_notify_changes: true,
      ...extra,
    };
  };

  // Клиент перенёс запись — мастеру и копия владельцу
  reset();
  withOwner();
  await deliverChangeNotifications({
    organization: tables.organizations[0],
    event: "updated",
    booking: bookingRow(),
    previous: snapshot(),
    byClient: true,
  });
  assert.deepStrictEqual(sent.map((m) => m.chat_id).sort(), ["111", "500"]);
  assert.ok(sent.find((m) => m.chat_id === "500").text.includes("Клиент перенёс запись"));

  // Правка в кабинете — владельцу копию не шлём
  reset();
  withOwner();
  await notifyBookingChange(USER, { event: "updated", booking_id: BOOKING, previous: snapshot() });
  assert.deepStrictEqual(sent.map((m) => m.chat_id), ["111"]);

  // Выключил «Отмены и переносы» — не шлём
  reset();
  withOwner({ owner_notify_changes: false });
  await deliverChangeNotifications({
    organization: tables.organizations[0],
    event: "updated",
    booking: bookingRow({ status: "canceled" }),
    previous: snapshot(),
    byClient: true,
  });
  assert.deepStrictEqual(sent.map((m) => m.chat_id), ["111"]);

  // Владелец сам этот мастер — без дубля
  reset();
  withOwner({ owner_telegram_chat_id: "111" });
  await deliverChangeNotifications({
    organization: tables.organizations[0],
    event: "updated",
    booking: bookingRow({ status: "canceled" }),
    previous: snapshot(),
    byClient: true,
  });
  assert.deepStrictEqual(sent.map((m) => m.chat_id), ["111"]);

  // Новая онлайн-запись: мастер не подключил Telegram — владелец всё равно узнаёт
  reset();
  withOwner();
  await telegram.notifyNewBooking({
    organization: tables.organizations[0],
    service: { name: "Стрижка" },
    staff: { id: ALAN, name: "Тимур", telegram_chat_id: null },
    booking: { id: BOOKING, booking_date: future, start_time: "14:00:00", end_time: "15:00:00", status: "pending" },
    client: { client_name: "Алан", client_phone: "+77001234567" },
  });
  assert.deepStrictEqual(sent.map((m) => m.chat_id), ["500"]);
  assert.ok(sent[0].text.includes("Мастер: Тимур"));
  assert.ok(sent[0].reply_markup.inline_keyboard.length, "владелец может подтвердить pending");
  ok("Владельцу: копии новых онлайн-записей и отмен/переносов клиентом; без дублей и по настройке");
}

async function testRoute() {
  const request = require("supertest");
  const app = require("../server/app");
  await request(app).post("/api/bookings/notify").send({}).expect(401);
  ok("POST /api/bookings/notify без авторизации → 401");
}

(async () => {
  testPlan();
  testSanitize();
  await testReschedule();
  await testReassign();
  await testCancelAndDelete();
  await testGuards();
  await testOwnerCopies();
  await testRoute();
  console.log("\nВсе unit-тесты уведомлений об изменениях записи пройдены.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
