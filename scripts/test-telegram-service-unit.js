/**
 * Unit-тесты Telegram-интеграции (без Supabase и без сети)
 * Использование: npm run test:telegram-unit
 */

const assert = require("assert");

// --- Подмена Supabase до загрузки telegram-service --------------------------

let dbHandler = () => ({ data: null, error: null });
const dbCalls = [];

function fakeSupabase() {
  return {
    from(table) {
      const query = { table, op: "select", filters: {}, payload: null };
      const builder = {
        select() {
          return builder;
        },
        update(payload) {
          query.op = "update";
          query.payload = payload;
          return builder;
        },
        eq(column, value) {
          query.filters[column] = value;
          return builder;
        },
        maybeSingle() {
          return builder;
        },
        then(resolve, reject) {
          dbCalls.push(query);
          return Promise.resolve(dbHandler(query)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

require("../server/lib/supabase-admin").getSupabaseAdmin = () => fakeSupabase();

// --- Подмена Telegram Bot API ------------------------------------------------

const apiCalls = [];
let apiResponder = () => ({ ok: true, result: {} });

global.fetch = async (url, options) => {
  const method = String(url).split("/").pop();
  const body = JSON.parse(options.body || "{}");
  apiCalls.push({ method, body });
  const data = apiResponder(method, body);
  return { ok: data.ok, status: data.ok ? 200 : data.error_code, json: async () => data };
};

const config = require("../server/config");
config.telegram.token = "test-token";
config.telegram.webhookSecret = "test_webhook_secret_123";
config.telegram.isConfigured = true;

const telegram = require("../server/lib/telegram-service");

const BOOKING_ID = "11111111-2222-4333-8444-555555555555";
const STAFF_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CHAT_ID = 424242;

function reset() {
  dbCalls.length = 0;
  apiCalls.length = 0;
  dbHandler = () => ({ data: null, error: null });
  apiResponder = () => ({ ok: true, result: {} });
}

function ok(message) {
  console.log("[OK]", message);
}

function bookingRow(overrides = {}) {
  return {
    id: BOOKING_ID,
    status: "pending",
    staff_id: STAFF_ID,
    booking_date: "2026-10-24",
    start_time: "10:00:00",
    end_time: "10:30:00",
    client_name: "Айгерим",
    client_phone: "+77001234567",
    client_email: null,
    client_comment: null,
    public_reference: "BK-ABC234",
    services: { name: "Стрижка" },
    staff: { name: "Дана" },
    organizations: { name: "Салон", public_name: null },
    ...overrides,
  };
}

function callbackUpdate(data, chatId = CHAT_ID) {
  return {
    callback_query: {
      id: "cb1",
      data,
      message: { message_id: 7, chat: { id: chatId, type: "private" }, text: "old" },
    },
  };
}

// -----------------------------------------------------------------------------

function testFormatting() {
  const text = telegram.formatBookingMessage({
    organizationName: "Salon <b>",
    serviceName: "Cut & Style",
    staffName: "Dana",
    bookingDate: "2026-10-24",
    startTime: "10:00:00",
    endTime: "10:30:00",
    clientName: "<script>alert(1)</script>",
    clientComment: "a > b",
    reference: "BK-ABC234",
    status: "pending",
  });

  assert.ok(!text.includes("<script>"), "client input must be escaped");
  assert.ok(text.includes("&lt;script&gt;"));
  assert.ok(text.includes("Cut &amp; Style"));
  assert.ok(text.includes("24.10.2026 (сб), 10:00–10:30"));
  assert.ok(text.includes(telegram.STATUS_LABELS.pending));
  ok("Сообщение форматируется, пользовательский ввод экранируется");
}

function testParsing() {
  assert.deepStrictEqual(telegram.parseCallbackData(`bk:confirm:${BOOKING_ID}`), {
    action: "confirm",
    bookingId: BOOKING_ID,
  });
  assert.strictEqual(telegram.parseCallbackData(`confirm_${BOOKING_ID}`), null);
  assert.strictEqual(telegram.parseCallbackData("bk:delete:" + BOOKING_ID), null);
  assert.strictEqual(telegram.parseCallbackData("bk:confirm:not-a-uuid-not-a-uuid-not-a-uuid-1234"), null);

  assert.deepStrictEqual(telegram.parseCommand("/start@BooklyBot abc123"), {
    command: "start",
    args: "abc123",
  });
  assert.deepStrictEqual(telegram.parseCommand("/stop"), { command: "stop", args: "" });
  assert.strictEqual(telegram.parseCommand("привет"), null);

  assert.strictEqual(telegram.bookingKeyboard(BOOKING_ID, "pending").inline_keyboard.length, 1);
  assert.strictEqual(telegram.bookingKeyboard(BOOKING_ID, "confirmed").inline_keyboard.length, 0);
  for (const button of telegram.bookingKeyboard(BOOKING_ID, "pending").inline_keyboard[0]) {
    assert.ok(Buffer.byteLength(button.callback_data) <= 64, "callback_data ≤ 64 bytes");
  }
  ok("callback_data / команды / клавиатура разбираются корректно");
}

function testSecret() {
  assert.strictEqual(telegram.verifyWebhookSecret("test_webhook_secret_123"), true);
  assert.strictEqual(telegram.verifyWebhookSecret("wrong"), false);
  assert.strictEqual(telegram.verifyWebhookSecret(""), false);
  assert.strictEqual(telegram.verifyWebhookSecret(undefined), false);
  ok("Проверка secret_token webhook");
}

async function testWebhookRoute() {
  const request = require("supertest");
  const app = require("../server/app");

  reset();
  await request(app).post("/api/telegram/webhook").send({}).expect(401);
  await request(app)
    .post("/api/telegram/webhook")
    .set("X-Telegram-Bot-Api-Secret-Token", "wrong")
    .send({})
    .expect(401);
  await request(app)
    .post("/api/telegram/webhook")
    .set("X-Telegram-Bot-Api-Secret-Token", "test_webhook_secret_123")
    .send({ update_id: 1 })
    .expect(200);

  const saved = config.telegram.webhookSecret;
  config.telegram.webhookSecret = "";
  await request(app).post("/api/telegram/webhook").send({}).expect(404);
  config.telegram.webhookSecret = saved;
  ok("Webhook: 401 без секрета, 404 если не настроен, 200 с верным секретом");
}

async function testCallbackForeignChat() {
  reset();
  dbHandler = (q) => {
    if (q.table === "staff") return { data: [], error: null };
    if (q.table === "bookings") return { data: bookingRow(), error: null };
    return { data: null, error: null };
  };

  await telegram.handleUpdate(callbackUpdate(`bk:confirm:${BOOKING_ID}`, 999));

  assert.ok(!dbCalls.some((q) => q.op === "update"), "чужой чат не должен менять запись");
  const answer = apiCalls.find((c) => c.method === "answerCallbackQuery");
  assert.ok(answer && answer.body.show_alert === true);
  ok("Callback из непривязанного чата не меняет запись");
}

async function testCallbackConfirmAndReject() {
  for (const [action, expected] of [
    ["confirm", "confirmed"],
    ["reject", "canceled"],
  ]) {
    reset();
    dbHandler = (q) => {
      if (q.table === "staff") return { data: [{ id: STAFF_ID }], error: null };
      if (q.table === "bookings" && q.op === "update") {
        return { data: { status: q.payload.status }, error: null };
      }
      if (q.table === "bookings") return { data: bookingRow(), error: null };
      return { data: null, error: null };
    };

    await telegram.handleUpdate(callbackUpdate(`bk:${action}:${BOOKING_ID}`));

    const update = dbCalls.find((q) => q.op === "update");
    assert.ok(update, "должен быть UPDATE");
    assert.strictEqual(update.payload.status, expected);
    assert.strictEqual(update.filters.status, "pending", "UPDATE только из pending");
    assert.strictEqual(update.filters.id, BOOKING_ID);

    const edit = apiCalls.find((c) => c.method === "editMessageText");
    assert.ok(edit.body.text.includes(telegram.STATUS_LABELS[expected]));
    assert.deepStrictEqual(edit.body.reply_markup.inline_keyboard, []);
  }
  ok("Подтвердить → confirmed, Отклонить → canceled; кнопки убираются");
}

async function testCallbackAlreadyProcessed() {
  reset();
  dbHandler = (q) => {
    if (q.table === "staff") return { data: [{ id: STAFF_ID }], error: null };
    if (q.table === "bookings") return { data: bookingRow({ status: "confirmed" }), error: null };
    return { data: null, error: null };
  };

  await telegram.handleUpdate(callbackUpdate(`bk:reject:${BOOKING_ID}`));
  assert.ok(!dbCalls.some((q) => q.op === "update"));
  ok("Уже обработанная запись не меняется повторно");
}

async function testStartLinksStaff() {
  reset();
  const oldToken = "0123456789abcdef0123456789abcdef";
  dbHandler = (q) => {
    if (q.table === "staff" && q.op === "select") {
      return { data: { id: STAFF_ID, name: "Дана", organizations: { name: "Салон" } }, error: null };
    }
    return { data: null, error: null };
  };

  await telegram.handleUpdate({
    message: { chat: { id: CHAT_ID, type: "private" }, text: `/start ${oldToken}` },
  });

  const update = dbCalls.find((q) => q.op === "update");
  assert.strictEqual(update.payload.telegram_chat_id, String(CHAT_ID));
  assert.notStrictEqual(update.payload.telegram_link_token, oldToken, "токен ротируется");
  assert.strictEqual(update.filters.telegram_link_token, oldToken);
  assert.ok(apiCalls.find((c) => c.method === "sendMessage").body.text.includes("Готово"));

  reset();
  await telegram.handleUpdate({
    message: { chat: { id: -100, type: "group" }, text: `/start ${oldToken}` },
  });
  assert.strictEqual(dbCalls.length, 0, "в группах не привязываем");
  ok("/start <token> привязывает чат и меняет токен; группы игнорируются");
}

async function testNotify() {
  const base = {
    organization: { name: "Салон" },
    service: { name: "Стрижка" },
    booking: {
      id: BOOKING_ID,
      public_reference: "BK-ABC234",
      status: "pending",
      booking_date: "2026-10-24",
      start_time: "10:00",
      end_time: "10:30",
    },
    client: { client_name: "Айгерим", client_phone: "+77001234567" },
  };

  reset();
  await telegram.notifyNewBooking({ ...base, staff: { id: STAFF_ID, name: "Дана", telegram_chat_id: null } });
  assert.strictEqual(apiCalls.length, 0);

  reset();
  await telegram.notifyNewBooking({ ...base, staff: { id: STAFF_ID, name: "Дана", telegram_chat_id: "1" } });
  const sent = apiCalls.find((c) => c.method === "sendMessage");
  assert.ok(sent.body.reply_markup.inline_keyboard[0][0].callback_data.includes(BOOKING_ID));

  reset();
  apiResponder = () => ({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
  await telegram.notifyNewBooking({ ...base, staff: { id: STAFF_ID, name: "Дана", telegram_chat_id: "1" } });
  const unlink = dbCalls.find((q) => q.op === "update");
  assert.strictEqual(unlink.payload.telegram_chat_id, null);

  reset();
  apiResponder = () => {
    throw new Error("network down");
  };
  await telegram.notifyNewBooking({ ...base, staff: { id: STAFF_ID, name: "Дана", telegram_chat_id: "1" } });
  ok("Уведомление: шлётся только привязанным, 403 отвязывает, ошибки не пробрасываются");
}

async function main() {
  const originalError = console.error;
  console.error = () => {};
  try {
    testFormatting();
    testParsing();
    testSecret();
    await testWebhookRoute();
    await testCallbackForeignChat();
    await testCallbackConfirmAndReject();
    await testCallbackAlreadyProcessed();
    await testStartLinksStaff();
    await testNotify();
  } finally {
    console.error = originalError;
  }
  console.log("\nВсе unit-тесты Telegram пройдены.");
}

main().catch((error) => {
  console.error("[FAIL]", error.message);
  process.exit(1);
});
