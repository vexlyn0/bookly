/**
 * Unit-тесты подтверждения номера через Telegram-бота (без Supabase и сети)
 * Использование: npm run test:phone-verification-unit
 */

const assert = require("assert");

// --- Подмена Supabase: таблицы в памяти --------------------------------------

const tables = { phone_verifications: [], organizations: [] };

function fakeSupabase() {
  return {
    from(table) {
      const filters = [];
      let single = false;
      let patch = null;
      let insertRow = null;
      let limit = Infinity;
      const builder = {
        select: () => builder,
        order: () => builder,
        limit(n) {
          limit = n;
          return builder;
        },
        insert(row) {
          insertRow = row;
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
        maybeSingle() {
          single = true;
          return builder;
        },
        then(resolve, reject) {
          if (insertRow) {
            tables[table].push({
              id: `id-${tables[table].length + 1}`,
              status: "pending",
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
              ...insertRow,
            });
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          let rows = tables[table].filter((row) => filters.every((f) => f(row)));
          if (patch) rows.forEach((row) => Object.assign(row, patch));
          rows = JSON.parse(JSON.stringify(rows))
            .reverse()
            .slice(0, limit)
            .map((row) =>
              table === "phone_verifications"
                ? { ...row, organizations: { name: "qwerty", public_name: null } }
                : row
            );
          return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
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
  sent.push(JSON.parse(options.body || "{}"));
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
};

const config = require("../server/config");
config.telegram.token = "test-token";
config.telegram.webhookSecret = "test_secret";
config.telegram.botUsername = "bookly_online_bot";
config.telegram.isConfigured = true;

const verification = require("../server/lib/phone-verification-service");
const telegram = require("../server/lib/telegram-service");

const ORG = { id: "org-1", require_phone_verification: true };
const CHAT = 5550001;
const USER = 777;

function ok(message) {
  console.log("[OK]", message);
}

function reset() {
  tables.phone_verifications = [];
  sent.length = 0;
}

function contactUpdate(phone, { userId = USER, fromId = USER } = {}) {
  return {
    message: {
      chat: { id: CHAT, type: "private" },
      from: { id: fromId },
      contact: { phone_number: phone, user_id: userId },
    },
  };
}

function startUpdate(token) {
  return { message: { chat: { id: CHAT, type: "private" }, from: { id: USER }, text: `/start v_${token}` } };
}

// -----------------------------------------------------------------------------

async function testHappyPath() {
  reset();
  assert.ok(verification.isRequired(ORG));
  assert.ok(!verification.isRequired({ ...ORG, require_phone_verification: false }));

  const { token, bot_url: botUrl } = await verification.create(ORG, "8 701 123 45 67");
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.strictEqual(botUrl, `https://t.me/bookly_online_bot?start=v_${token}`);
  assert.strictEqual((await verification.getStatus(token)).status, "pending");

  await telegram.handleUpdate(startUpdate(token));
  assert.ok(sent[0].text.includes("Поделиться номером"));
  assert.strictEqual(sent[0].reply_markup.keyboard[0][0].request_contact, true);
  assert.strictEqual(tables.phone_verifications[0].chat_id, String(CHAT));

  // Telegram присылает номер без плюса
  await telegram.handleUpdate(contactUpdate("77011234567"));
  assert.ok(sent[1].text.includes("Номер подтверждён"));
  assert.strictEqual(sent[1].reply_markup.remove_keyboard, true);
  assert.strictEqual((await verification.getStatus(token)).status, "verified");

  const row = await verification.requireVerified(ORG, token, "+7 701 123-45-67");
  assert.strictEqual(row.chat_id, String(CHAT));
  ok("Бот: /start → «Поделиться номером» → номер совпал → запись разрешена");

  await verification.markUsed(row.id);
  await assert.rejects(verification.requireVerified(ORG, token, "87011234567"), (e) => e.code === "PHONE_NOT_VERIFIED");
  ok("Одно подтверждение — одна запись");
}

async function testRejections() {
  reset();
  const { token } = await verification.create(ORG, "87011234567");
  await telegram.handleUpdate(startUpdate(token));

  // Чужой контакт из записной книжки
  await telegram.handleUpdate(contactUpdate("77011234567", { userId: 999 }));
  assert.strictEqual((await verification.getStatus(token)).status, "pending");
  ok("Чужой контакт (не свой номер) не принимается");

  // Номер Telegram другой
  await telegram.handleUpdate(contactUpdate("77770000000"));
  assert.strictEqual((await verification.getStatus(token)).status, "mismatch");
  assert.ok(sent.at(-1).text.includes("не совпадает"));
  await assert.rejects(verification.requireVerified(ORG, token, "87011234567"), (e) => e.status === 403);
  ok("Номер Telegram не совпал → mismatch, запись не создаётся");

  // Подтверждённый номер нельзя использовать для другого номера или другой организации
  reset();
  const second = await verification.create(ORG, "87011234567");
  await telegram.handleUpdate(startUpdate(second.token));
  await telegram.handleUpdate(contactUpdate("+77011234567"));
  await assert.rejects(verification.requireVerified(ORG, second.token, "87770000000"), (e) => e.code === "PHONE_NOT_VERIFIED");
  await assert.rejects(
    verification.requireVerified({ ...ORG, id: "org-2" }, second.token, "87011234567"),
    (e) => e.code === "PHONE_NOT_VERIFIED"
  );
  await assert.rejects(verification.requireVerified(ORG, "", "87011234567"), (e) => e.code === "PHONE_NOT_VERIFIED");
  ok("Подтверждение не переносится на другой номер / другую организацию; без токена — отказ");

  // Просроченная заявка
  reset();
  const expired = await verification.create(ORG, "87011234567");
  tables.phone_verifications[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.strictEqual((await verification.getStatus(expired.token)).status, "expired");
  await telegram.handleUpdate(startUpdate(expired.token));
  assert.ok(sent.at(-1).text.includes("устарела"));
  assert.strictEqual(tables.phone_verifications[0].chat_id, undefined);
  ok("Просроченная ссылка: бот просит начать заново");

  await assert.rejects(verification.create(ORG, "123"), (e) => e.status === 400);
  await assert.rejects(verification.getStatus("nope"), (e) => e.status === 404);
  ok("Короткий номер → 400, неверный токен → 404");
}

async function testUnavailable() {
  const saved = config.telegram.webhookSecret;
  config.telegram.webhookSecret = "";
  assert.ok(!verification.isRequired(ORG), "бот не работает — запись не блокируем");
  await assert.rejects(verification.create(ORG, "87011234567"), (e) => e.code === "VERIFICATION_UNAVAILABLE");
  config.telegram.webhookSecret = saved;
  ok("Бот не настроен — проверка не требуется, онлайн-запись не ломается");
}

async function testClientConfirmation() {
  reset();
  await telegram.sendClientBookingConfirmation(
    CHAT,
    {
      organizationName: "qwerty",
      serviceName: "Стрижка",
      staffName: "Ерлан",
      bookingDate: "2026-10-27",
      startTime: "12:00:00",
      endTime: "13:00:00",
      status: "confirmed",
    },
    "https://bookly.kz/b/abc"
  );
  assert.ok(sent[0].text.includes("Вы записаны"));
  assert.ok(sent[0].text.includes("12:00–13:00"));
  assert.ok(sent[0].text.includes("https://bookly.kz/b/abc"));
  ok("Клиенту в Telegram приходит подтверждение записи со ссылкой");
}

(async () => {
  await testHappyPath();
  await testRejections();
  await testUnavailable();
  await testClientConfirmation();
  console.log("\nВсе unit-тесты подтверждения номера пройдены.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
