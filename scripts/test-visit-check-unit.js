/**
 * Unit-тесты «Визит завершён?» (мастер подтверждает визит и оплату в Telegram)
 * Использование: npm run test:visit-check-unit
 */

const assert = require("assert");

// --- Подмена Supabase: таблицы в памяти --------------------------------------

const tables = { bookings: [], staff: [] };

function fakeSupabase() {
  return {
    from(table) {
      const filters = [];
      let single = false;
      let patch = null;
      let limit = Infinity;
      const builder = {
        select: () => builder,
        order: () => builder,
        limit(n) {
          limit = n;
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
        is(column, value) {
          filters.push((row) => (row[column] ?? null) === value);
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
        update(payload) {
          patch = payload;
          return builder;
        },
        maybeSingle() {
          single = true;
          return builder;
        },
        then(resolve, reject) {
          let rows = tables[table].filter((row) => filters.every((f) => f(row)));
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

// --- Подмена Telegram Bot API ------------------------------------------------

const api = [];
global.fetch = async (url, options) => {
  api.push({ method: String(url).split("/").pop(), body: JSON.parse(options.body || "{}") });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
};

const config = require("../server/config");
config.telegram.token = "test-token";
config.telegram.webhookSecret = "secret";
config.telegram.isConfigured = true;

const telegram = require("../server/lib/telegram-service");
const visit = require("../server/lib/visit-check-service");
const { formatDateInTimezone } = require("../server/lib/slots");

const TZ = "Asia/Almaty";
const CHAT = "7001";
const BOOKING = "c1000000-0000-4000-8000-000000000001";
const STAFF = "a1000000-0000-4000-8000-000000000001";

const sent = () => api.filter((c) => c.method === "sendMessage").map((c) => c.body);
const edits = () => api.filter((c) => c.method === "editMessageText").map((c) => c.body);
const alerts = () => api.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body);

function ok(message) {
  console.log("[OK]", message);
}

/** Запись, закончившаяся `minutesAgo` минут назад (по Алматы). */
function bookingEndedAgo(minutesAgo, overrides = {}) {
  const end = new Date(Date.now() - minutesAgo * 60000);
  const start = new Date(end.getTime() - 60 * 60000);
  const hhmm = (d) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return {
    id: BOOKING,
    organization_id: "org",
    staff_id: STAFF,
    status: "confirmed",
    booking_date: formatDateInTimezone(start, TZ),
    start_time: `${hhmm(start)}:00`,
    end_time: `${hhmm(end)}:00`,
    price: 5000,
    paid_amount: null,
    client_name: "Алан",
    client_phone: "+77001234567",
    visit_check_sent_at: null,
    services: { name: "Стрижка", price: 6000 },
    staff: { name: "Ерлан", telegram_chat_id: CHAT },
    organizations: { name: "qwerty", public_name: null, timezone: TZ },
    ...overrides,
  };
}

function reset(booking) {
  api.length = 0;
  tables.bookings = booking ? [booking] : [];
  tables.staff = [{ id: STAFF, telegram_chat_id: CHAT, pending_amount_booking_id: null }];
}

function callback(action, chatId = CHAT) {
  return {
    callback_query: {
      id: "cb",
      data: `bk:${action}:${BOOKING}`,
      message: { message_id: 9, chat: { id: Number(chatId), type: "private" } },
    },
  };
}

function text(value) {
  return { message: { chat: { id: Number(CHAT), type: "private" }, from: { id: 1 }, text: value } };
}

// -----------------------------------------------------------------------------

async function testSchedule() {
  // Не наступило время окончания (запись «закончится» через 10 мин) — не шлём
  reset(bookingEndedAgo(-10));
  assert.strictEqual(await visit.sendDueVisitChecks(), 0);

  // Закончилась 3 минуты назад — шлём один раз
  reset(bookingEndedAgo(3));
  assert.strictEqual(await visit.sendDueVisitChecks(), 1);
  const message = sent()[0];
  assert.strictEqual(message.chat_id, CHAT);
  assert.ok(message.text.includes("Визит завершён?"));
  assert.ok(message.text.includes("5 000 ₸"), "цена на момент записи, а не новый прайс");
  const buttons = message.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepStrictEqual(buttons, [`bk:done:${BOOKING}`, `bk:sum:${BOOKING}`, `bk:noshow:${BOOKING}`]);
  assert.ok(tables.bookings[0].visit_check_sent_at);
  api.length = 0;
  assert.strictEqual(await visit.sendDueVisitChecks(), 0, "повторно не отправляется");

  // Закончилась больше суток назад — не тревожим задним числом
  reset(bookingEndedAgo(26 * 60));
  assert.strictEqual(await visit.sendDueVisitChecks(), 0);

  // Отменённая — не спрашиваем
  reset(bookingEndedAgo(3, { status: "canceled" }));
  assert.strictEqual(await visit.sendDueVisitChecks(), 0);
  ok("«Визит завершён?» приходит мастеру, когда закончилось время записи, один раз");
}

async function testButtons() {
  reset(bookingEndedAgo(3));
  await telegram.handleUpdate(callback("done"));
  assert.strictEqual(tables.bookings[0].status, "completed");
  assert.strictEqual(tables.bookings[0].paid_amount, null, "оплата по цене записи");
  assert.ok(edits()[0].text.includes("оплачено <b>5 000 ₸</b>"));
  ok("«Пришёл» — визит засчитан по цене записи");

  api.length = 0;
  await telegram.handleUpdate(callback("noshow"));
  assert.strictEqual(tables.bookings[0].status, "completed", "уже отмеченный не меняется");
  assert.ok(alerts()[0].text.includes("уже отмечен"));
  ok("Повторное нажатие не меняет отмеченный визит");

  reset(bookingEndedAgo(3));
  await telegram.handleUpdate(callback("noshow"));
  assert.strictEqual(tables.bookings[0].status, "no_show");
  ok("«Не пришёл» — неявка");

  reset(bookingEndedAgo(3));
  await telegram.handleUpdate(callback("done", "9999"));
  assert.strictEqual(tables.bookings[0].status, "confirmed", "чужой чат не может отметить");
  ok("Отметить может только мастер этой записи");
}

async function testCustomAmount() {
  reset(bookingEndedAgo(3));
  await telegram.handleUpdate(callback("sum"));
  assert.strictEqual(tables.staff[0].pending_amount_booking_id, BOOKING);
  assert.ok(sent()[0].text.includes("Напишите сумму"));
  assert.strictEqual(sent()[0].reply_markup.force_reply, true);

  api.length = 0;
  await telegram.handleUpdate(text("четыре тысячи"));
  assert.ok(sent()[0].text.includes("Не понял сумму"));
  assert.strictEqual(tables.bookings[0].status, "confirmed");

  api.length = 0;
  await telegram.handleUpdate(text("4 500 тг"));
  assert.strictEqual(tables.bookings[0].status, "completed");
  assert.strictEqual(tables.bookings[0].paid_amount, 4500);
  assert.strictEqual(tables.staff[0].pending_amount_booking_id, null);
  assert.ok(sent()[0].text.includes("4 500 ₸"));

  // Обычный текст без ожидания суммы — справка, а не сумма
  api.length = 0;
  await telegram.handleUpdate(text("5000"));
  assert.ok(sent()[0].text.includes("Bookly"), "без «Другая сумма» число не трогает записи");
  ok("«Другая сумма»: бот ждёт число, понимает «4 500 тг», не понимает «четыре тысячи»");

  assert.strictEqual(visit.parseAmount("4500"), 4500);
  assert.strictEqual(visit.parseAmount("4.500"), 4500);
  assert.strictEqual(visit.parseAmount("4500₸"), 4500);
  assert.strictEqual(visit.parseAmount("-100"), null);
  assert.strictEqual(visit.parseAmount("999999999999"), null);
  ok("Разбор суммы");
}

(async () => {
  await testSchedule();
  await testButtons();
  await testCustomAmount();
  console.log("\nВсе unit-тесты «Визит завершён?» пройдены.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
