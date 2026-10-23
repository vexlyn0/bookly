/**
 * Unit-тесты Telegram-бота для клиентов (без Supabase и сети)
 * Использование: npm run test:client-bot-unit
 */

const assert = require("assert");

// --- Подмена Supabase: таблицы в памяти --------------------------------------

const tables = { bookings: [], telegram_clients: [], phone_verifications: [] };

function fakeSupabase() {
  return {
    from(table) {
      const filters = [];
      let single = false;
      let patch = null;
      let remove = false;
      let limit = Infinity;
      const builder = {
        select: () => builder,
        order: () => builder,
        limit(value) {
          limit = value;
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
        gte(column, value) {
          filters.push((row) => row[column] >= value);
          return builder;
        },
        lte(column, value) {
          filters.push((row) => row[column] <= value);
          return builder;
        },
        is(column, value) {
          filters.push((row) => (row[column] ?? null) === value);
          return builder;
        },
        update(payload) {
          patch = payload;
          return builder;
        },
        delete() {
          remove = true;
          return builder;
        },
        upsert(row) {
          tables[table] = tables[table].filter((item) => item.chat_id !== row.chat_id);
          tables[table].push(row);
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle() {
          single = true;
          return builder;
        },
        then(resolve, reject) {
          let rows = tables[table].filter((row) => filters.every((f) => f(row)));
          if (remove) tables[table] = tables[table].filter((row) => !rows.includes(row));
          if (patch) rows.forEach((row) => Object.assign(row, patch));
          rows = JSON.parse(JSON.stringify(rows)).slice(0, limit);
          return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

require("../server/lib/supabase-admin").getSupabaseAdmin = () => fakeSupabase();

const proOrgs = new Set(["org-pro"]);
require("../server/lib/subscription-service").getOrganizationEntitlements = async (id) => ({ is_pro: proOrgs.has(id) });

const cancelCalls = [];
let cancelError = null;
require("../server/lib/client-manage-service").cancelByToken = async (token) => {
  cancelCalls.push(token);
  if (cancelError) throw cancelError;
  const row = tables.bookings.find((b) => b.manage_token === token);
  row.status = "canceled";
  return {};
};

// --- Подмена Telegram Bot API ------------------------------------------------

const api = [];
global.fetch = async (url, options) => {
  api.push({ method: String(url).split("/").pop(), body: JSON.parse(options.body || "{}") });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
};

const config = require("../server/config");
config.telegram.token = "test-token";
config.telegram.webhookSecret = "secret";
config.telegram.botUsername = "bookly_online_bot";
config.telegram.isConfigured = true;
config.publicUrl = "https://bookly.test";

const telegram = require("../server/lib/telegram-service");
const bot = require("../server/lib/client-bot-service");
const { formatDateInTimezone } = require("../server/lib/slots");

const TZ = "Asia/Almaty";
const CHAT = "9001";
const OTHER_CHAT = "9002";
const TOKEN = "0123456789abcdef0123456789abcdef";
const KEY = "77011234567";

const sentMessages = () => api.filter((c) => c.method === "sendMessage").map((c) => c.body);
const edits = () => api.filter((c) => c.method === "editMessageText").map((c) => c.body);

function ok(message) {
  console.log("[OK]", message);
}

/** Запись через `minutes` минут от сейчас (время в Алматы). */
function bookingAt(minutes, overrides = {}) {
  const start = new Date(Date.now() + minutes * 60000);
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(start);
  return {
    id: `b-${Math.random().toString(16).slice(2)}`,
    organization_id: "org-pro",
    status: "confirmed",
    booking_date: formatDateInTimezone(start, TZ),
    start_time: `${hhmm}:00`,
    end_time: `${hhmm}:00`,
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    manage_token: TOKEN,
    client_name: "Алан",
    client_phone_key: KEY,
    client_telegram_chat_id: null,
    client_confirmed_at: null,
    reminder_day_sent_at: null,
    reminder_2h_sent_at: null,
    services: { name: "Стрижка" },
    staff: { name: "Ерлан" },
    organizations: { name: "qwerty", public_name: null, address: "Абая 10", phone: "+77001112233", timezone: TZ },
    ...overrides,
  };
}

function reset() {
  api.length = 0;
  cancelCalls.length = 0;
  cancelError = null;
  tables.bookings = [];
  tables.telegram_clients = [{ chat_id: CHAT, phone_key: KEY }];
}

function callback(data, chatId = CHAT) {
  return { callback_query: { id: "cb", data, message: { message_id: 5, chat: { id: Number(chatId), type: "private" } } } };
}

// -----------------------------------------------------------------------------

async function testMyBookings() {
  reset();
  tables.bookings = [
    bookingAt(26 * 60),
    bookingAt(-60, { manage_token: "f".repeat(32) }),
    bookingAt(48 * 60, { status: "canceled", manage_token: "e".repeat(32) }),
    bookingAt(30 * 60, { client_phone_key: "77770000000", manage_token: "d".repeat(32) }),
  ];

  await telegram.handleUpdate({ message: { chat: { id: Number(CHAT), type: "private" }, from: { id: 1 }, text: "📋 Мои записи" } });
  const messages = sentMessages();
  assert.strictEqual(messages.length, 1, "только предстоящая активная запись этого номера");
  assert.ok(messages[0].text.includes("Ваша запись"));
  assert.ok(messages[0].text.includes("Абая 10"));
  const buttons = messages[0].reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((b) => b.url === `https://bookly.test/b/${TOKEN}`));
  assert.ok(buttons.some((b) => b.callback_data === `cl:c:${TOKEN}`));
  ok("«Мои записи»: предстоящие записи номера с кнопками «Перенести» / «Отменить»");

  reset();
  tables.telegram_clients = [];
  await telegram.handleUpdate({ message: { chat: { id: Number(CHAT), type: "private" }, from: { id: 1 }, text: "/my" } });
  assert.strictEqual(sentMessages()[0].reply_markup.keyboard[0][0].request_contact, true);
  ok("Номер не привязан — бот просит поделиться номером");

  reset();
  tables.telegram_clients = [];
  await telegram.handleUpdate({
    message: {
      chat: { id: Number(CHAT), type: "private" },
      from: { id: 42 },
      contact: { phone_number: "+7 701 123 45 67", user_id: 42 },
    },
  });
  assert.deepStrictEqual(tables.telegram_clients.map((r) => [r.chat_id, r.phone_key]), [[CHAT, KEY]]);
  assert.ok(sentMessages()[0].text.includes("Готово"));
  ok("Поделился номером без записи — бот привязан как клиентский");
}

async function testCancelFromBot() {
  reset();
  tables.bookings = [bookingAt(26 * 60)];

  await telegram.handleUpdate(callback(`cl:c:${TOKEN}`));
  assert.ok(edits()[0].text.includes("Отменить запись?"));
  assert.strictEqual(cancelCalls.length, 0, "сначала только вопрос");

  await telegram.handleUpdate(callback(`cl:cy:${TOKEN}`));
  assert.deepStrictEqual(cancelCalls, [TOKEN]);
  assert.ok(edits().at(-1).text.includes("Запись отменена"));
  ok("Отмена из бота: вопрос → «Да, отменить» → запись отменена через общие правила");

  reset();
  tables.bookings = [bookingAt(26 * 60)];
  await telegram.handleUpdate(callback(`cl:cy:${TOKEN}`, OTHER_CHAT));
  assert.strictEqual(cancelCalls.length, 0, "чужой чат не может отменить");
  ok("Чужая запись: отменить нельзя");

  reset();
  tables.bookings = [bookingAt(60)];
  cancelError = Object.assign(new Error("Отменить эту запись онлайн нельзя. Позвоните в салон"), { status: 403 });
  await telegram.handleUpdate(callback(`cl:cy:${TOKEN}`));
  const alert = api.find((c) => c.method === "answerCallbackQuery").body;
  assert.ok(alert.show_alert && alert.text.includes("Позвоните"));
  assert.strictEqual(tables.bookings[0].status, "confirmed");
  ok("Поздно для отмены — бот показывает «позвоните в салон», запись остаётся");

  reset();
  tables.bookings = [bookingAt(26 * 60)];
  await telegram.handleUpdate(callback(`cl:ok:${TOKEN}`));
  assert.ok(tables.bookings[0].client_confirmed_at);
  assert.ok(edits()[0].text.includes("Вы подтвердили визит"));
  ok("«Приду» отмечает визит подтверждённым");
}

async function testNotifyClient() {
  const prev = (overrides = {}) => ({ staff_id: "s1", booking_date: "2030-01-10", start_time: "12:00:00", status: "confirmed", ...overrides });
  const next = (overrides = {}) => ({ ...prev(), ...overrides });

  assert.strictEqual(bot.planClientNotification({ event: "created", booking: next() }), "new");
  assert.strictEqual(bot.planClientNotification({ event: "updated", booking: next({ start_time: "14:00" }), previous: prev() }), "rescheduled");
  assert.strictEqual(bot.planClientNotification({ event: "updated", booking: next({ staff_id: "s2" }), previous: prev() }), "rescheduled");
  assert.strictEqual(bot.planClientNotification({ event: "updated", booking: next({ status: "canceled" }), previous: prev() }), "canceled");
  assert.strictEqual(
    bot.planClientNotification({ event: "updated", booking: next(), previous: prev({ status: "pending" }) }),
    "confirmed"
  );
  assert.strictEqual(bot.planClientNotification({ event: "updated", booking: next({ status: "completed" }), previous: prev() }), null);
  assert.strictEqual(bot.planClientNotification({ event: "deleted", booking: null, previous: prev() }), "canceled");
  ok("План сообщений клиенту: записан / перенесено / отменено / подтверждено");

  reset();
  const booking = bookingAt(26 * 60);
  const sent = await bot.notifyClientOfChange({
    organization: booking.organizations,
    event: "updated",
    booking,
    previous: { ...booking, start_time: "09:00:00" },
  });
  assert.strictEqual(sent, 1);
  assert.ok(sentMessages()[0].text.includes("Салон перенёс вашу запись"));
  assert.ok(sentMessages()[0].text.includes("Было: <s>"));

  reset();
  assert.strictEqual(
    await bot.notifyClientOfChange({ organization: booking.organizations, event: "updated", booking, previous: { ...booking, start_time: "09:00:00" }, byClient: true }),
    0,
    "сам клиент перенёс — не дублируем"
  );
  tables.telegram_clients = [];
  assert.strictEqual(
    await bot.notifyClientOfChange({ organization: booking.organizations, event: "created", booking }),
    0,
    "клиент не подключён к боту"
  );
  ok("Сообщение клиенту при переносе салоном; не шлём, если перенёс сам или бот не подключён");
}

async function testReminders() {
  const now = new Date();
  assert.strictEqual(bot.dueReminder(bookingAt(23 * 60)), "day");
  assert.strictEqual(bot.dueReminder(bookingAt(100)), "2h");
  assert.strictEqual(bot.dueReminder(bookingAt(5 * 60)), "day", "сервер спал в момент «за сутки» — догоняем");
  assert.strictEqual(bot.dueReminder(bookingAt(150)), null, "между суточным и 2-часовым окном");
  assert.strictEqual(bot.dueReminder(bookingAt(23 * 60, { created_at: now.toISOString() })), null, "записался меньше чем за сутки");
  assert.strictEqual(bot.dueReminder(bookingAt(100, { created_at: new Date(Date.now() - 30 * 60000).toISOString() })), null);
  assert.strictEqual(bot.dueReminder(bookingAt(23 * 60, { reminder_day_sent_at: now.toISOString() })), null);
  assert.strictEqual(bot.dueReminder(bookingAt(-10)), null);
  ok("Окна напоминаний: за сутки и за 2 часа, без лишних");

  reset();
  tables.bookings = [
    bookingAt(23 * 60, { id: "pro-day", manage_token: "a".repeat(32) }),
    bookingAt(100, { id: "pro-2h", manage_token: "b".repeat(32) }),
    bookingAt(23 * 60, { id: "free-day", organization_id: "org-free", manage_token: "c".repeat(32) }),
    bookingAt(23 * 60, { id: "nobot", client_phone_key: "77770000000", manage_token: "d".repeat(32) }),
  ];

  const sent = await bot.sendDueReminders();
  assert.strictEqual(sent, 2, "только Pro и только подключённым к боту");
  const texts = sentMessages().map((m) => m.text);
  assert.strictEqual(texts.filter((t) => t.includes("Напоминание:")).length, 2);
  assert.ok(texts.every((t) => /Напоминание: (сегодня|завтра) в \d{2}:\d{2}/.test(t)));
  const firstButtons = sentMessages()[0].reply_markup.inline_keyboard.flat().map((b) => b.text);
  assert.ok(firstButtons.includes("✅ Приду") && firstButtons.includes("❌ Отменить"));
  assert.ok(tables.bookings.find((b) => b.id === "pro-day").reminder_day_sent_at);
  assert.ok(!tables.bookings.find((b) => b.id === "free-day").reminder_day_sent_at);

  api.length = 0;
  assert.strictEqual(await bot.sendDueReminders(), 0, "повторно не отправляется");
  ok("Напоминания: только Pro, с кнопками «Приду» / «Отменить», без повторов");
}

async function testCronRoute() {
  const request = require("supertest");
  const app = require("../server/app");
  delete process.env.CRON_SECRET;
  await request(app).post("/api/cron/reminders").expect(404);
  process.env.CRON_SECRET = "cron_secret_123";
  await request(app).post("/api/cron/reminders").expect(401);
  await request(app).post("/api/cron/reminders").set("X-Cron-Secret", "wrong").expect(401);
  reset();
  const res = await request(app).get("/api/cron/reminders?secret=cron_secret_123").expect(200);
  assert.strictEqual(res.body.ok, true);
  ok("/api/cron/reminders: без CRON_SECRET выключен, с неверным секретом 401");
}

(async () => {
  await testMyBookings();
  await testCancelFromBot();
  await testNotifyClient();
  await testReminders();
  await testCronRoute();
  console.log("\nВсе unit-тесты клиентского бота пройдены.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
