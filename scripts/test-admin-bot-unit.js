/**
 * Unit-тесты Telegram администратора: заявки на оплату Pro (без Supabase и без сети)
 * Использование: npm run test:admin-bot-unit
 */

const assert = require("assert");

// --- Подмена Supabase: таблицы в памяти --------------------------------------

const tables = { platform_admins: [], manual_payment_requests: [], staff: [], organizations: [], telegram_clients: [] };

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
        limit(n) {
          limit = n;
          return builder;
        },
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        not(column, op, value) {
          filters.push((row) => (row[column] ?? null) !== value);
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
        maybeSingle() {
          single = true;
          return builder;
        },
        then(resolve, reject) {
          let rows = tables[table].filter((row) => filters.every((f) => f(row)));
          if (patch) rows.forEach((row) => Object.assign(row, patch));
          if (remove) tables[table] = tables[table].filter((row) => !rows.includes(row));
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
config.telegram.botUsername = "jazyl_bot";

// --- Подмена подтверждения в админке (RPC admin_approve / admin_reject) -------

const platformAdmin = require("../server/lib/platform-admin-service");
const decisions = [];
platformAdmin.approvePaymentRequest = async (id, adminUserId, note) => {
  decisions.push({ action: "approve", id, adminUserId, note });
  const row = tables.manual_payment_requests.find((r) => r.id === id);
  if (row.status === "approved") throw Object.assign(new Error("Заявка уже обработана"), { code: "PAYMENT_ALREADY_PROCESSED" });
  Object.assign(row, { status: "approved", approved_period_end: "2026-11-24T10:00:00.000Z" });
  return { already_processed: false };
};
platformAdmin.rejectPaymentRequest = async (id, adminUserId, note) => {
  decisions.push({ action: "reject", id, adminUserId, note });
  Object.assign(tables.manual_payment_requests.find((r) => r.id === id), { status: "rejected", admin_note: note });
  return {};
};

const telegram = require("../server/lib/telegram-service");
const adminBot = require("../server/lib/admin-bot-service");

const ADMIN = "a0000000-0000-4000-8000-000000000001";
const REQUEST = "e1000000-0000-4000-8000-000000000001";
const ADMIN_CHAT = "9001";
const OWNER_CHAT = "5005";
const TOKEN = "0123456789abcdef0123456789abcdef";

const sent = () => api.filter((c) => c.method === "sendMessage").map((c) => c.body);
const edits = () => api.filter((c) => c.method === "editMessageText").map((c) => c.body);
const alerts = () => api.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body);

function ok(message) {
  console.log("[OK]", message);
}

function reset({ linked = true } = {}) {
  api.length = 0;
  decisions.length = 0;
  tables.platform_admins = [{ user_id: ADMIN, telegram_chat_id: linked ? ADMIN_CHAT : null, telegram_link_token: TOKEN }];
  tables.manual_payment_requests = [
    {
      id: REQUEST,
      organization_id: "org",
      amount: 15000,
      currency: "KZT",
      billing_months: 3,
      payer_name: "Айгерим Б.",
      payer_phone: "+7 701 000 00 00",
      payment_reference: "Jazyl Pro",
      payment_date: "2026-10-24T09:00:00.000Z",
      customer_note: null,
      status: "pending",
      admin_note: null,
      approved_period_end: null,
      created_at: "2026-10-24T09:05:00.000Z",
      organizations: { id: "org", name: "Aru", public_name: "Nail studio Aru", slug: "aru", owner_telegram_chat_id: OWNER_CHAT },
    },
  ];
}

function callback(action, chatId = ADMIN_CHAT) {
  return {
    callback_query: {
      id: "cb",
      data: `sub:${action}:${REQUEST}`,
      message: { message_id: 7, chat: { id: Number(chatId), type: "private" } },
    },
  };
}

function command(text, chatId = ADMIN_CHAT) {
  return { message: { chat: { id: Number(chatId), type: "private" }, from: { id: 1 }, text } };
}

(async () => {
  // Привязка по ссылке из админки
  reset({ linked: false });
  await telegram.handleUpdate(command(`/start pa_${TOKEN}`));
  assert.strictEqual(tables.platform_admins[0].telegram_chat_id, ADMIN_CHAT);
  assert.notStrictEqual(tables.platform_admins[0].telegram_link_token, TOKEN, "ссылка одноразовая");
  assert.ok(sent()[0].text.includes("администратора Jazyl"));
  const status = await adminBot.getStatus(ADMIN);
  assert.strictEqual(status.connected, true);
  assert.ok(status.link.startsWith("https://t.me/jazyl_bot?start=pa_"));
  ok("/start pa_<токен> привязывает чат администратора, ссылка одноразовая");

  // Новая заявка → администратору с кнопками
  reset();
  assert.strictEqual(await adminBot.notifyNewPaymentRequest(REQUEST), 1);
  const message = sent()[0];
  assert.strictEqual(message.chat_id, ADMIN_CHAT);
  assert.ok(message.text.includes("Заявка на Pro"));
  assert.ok(message.text.includes("15 000 ₸") && message.text.includes("3 мес."));
  assert.ok(message.text.includes("Nail studio Aru"));
  assert.deepStrictEqual(
    message.reply_markup.inline_keyboard.flat().map((b) => b.callback_data),
    [`sub:ok:${REQUEST}`, `sub:no:${REQUEST}`]
  );
  ok("Новая заявка приходит администратору: салон, сумма, отправитель, кнопки");

  // Чужой чат не может подтвердить
  reset();
  await telegram.handleUpdate(callback("ok", "1234"));
  assert.strictEqual(decisions.length, 0);
  assert.strictEqual(tables.manual_payment_requests[0].status, "pending");
  ok("Подтвердить может только администратор платформы");

  // «Оплата пришла» → подтверждение как в админке, владельцу — итог
  reset();
  await telegram.handleUpdate(callback("ok"));
  assert.deepStrictEqual(decisions, [{ action: "approve", id: REQUEST, adminUserId: ADMIN, note: "Подтверждено в Telegram" }]);
  assert.ok(edits()[0].text.includes("Оплата подтверждена"));
  const toOwner = sent().find((m) => m.chat_id === OWNER_CHAT);
  assert.ok(toOwner && toOwner.text.includes("Pro подключён до"));
  ok("«Оплата пришла» → Pro подключён через ту же функцию, владельцу — сообщение");

  // Повторное нажатие — «уже обработана», ничего не меняется
  api.length = 0;
  decisions.length = 0;
  await telegram.handleUpdate(callback("r1"));
  assert.strictEqual(decisions.length, 0);
  assert.ok(alerts()[0].text.includes("уже обработана"));
  ok("Повторное нажатие (или подтверждение в админке) ничего не ломает");

  // «Отклонить» → причина → отклонено, владельцу — причина
  reset();
  await telegram.handleUpdate(callback("no"));
  assert.ok(edits()[0].text.includes("Почему отклоняем?"));
  assert.strictEqual(edits()[0].reply_markup.inline_keyboard.length, 3);
  assert.strictEqual(decisions.length, 0, "без причины не отклоняем");
  await telegram.handleUpdate(callback("r1"));
  assert.deepStrictEqual(decisions, [{ action: "reject", id: REQUEST, adminUserId: ADMIN, note: "Перевод не найден в Kaspi" }]);
  assert.ok(sent().some((m) => m.chat_id === OWNER_CHAT && m.text.includes("Перевод не найден в Kaspi")));
  ok("«Отклонить» → выбор причины → заявка отклонена, владелец видит причину");

  // /pay — список ждущих заявок; у не-админа команда не срабатывает
  reset();
  await telegram.handleUpdate(command("/pay"));
  assert.ok(sent()[0].text.includes("Заявка на Pro"));
  api.length = 0;
  await telegram.handleUpdate(command("/pay", "1234"));
  assert.ok(!sent()[0].text.includes("Заявка на Pro"));
  ok("/pay показывает ждущие заявки только администратору");

  // /stop отвязывает чат администратора
  reset();
  await telegram.handleUpdate(command("/stop"));
  assert.strictEqual(tables.platform_admins[0].telegram_chat_id, null);
  ok("/stop отключает заявки в Telegram");

  // Кнопка «🔕 Отключить уведомления»: сначала вопрос, отключает только «Да»
  const MASTER_CHAT = "5555";
  const offCallback = (data) => ({
    callback_query: { id: "cb", data, message: { message_id: 9, chat: { id: Number(MASTER_CHAT), type: "private" } } },
  });
  reset();
  tables.staff = [{ id: "s1", telegram_chat_id: MASTER_CHAT }];
  tables.telegram_clients = [{ chat_id: MASTER_CHAT, phone_key: "77010000000" }];
  await telegram.handleUpdate(command(telegram.STOP_TEXT, MASTER_CHAT));
  assert.ok(sent()[0].text.includes("Отключить все уведомления"));
  assert.deepStrictEqual(
    sent()[0].reply_markup.inline_keyboard[0].map((b) => b.callback_data),
    ["off:yes", "off:no"]
  );
  assert.strictEqual(tables.staff[0].telegram_chat_id, MASTER_CHAT, "до подтверждения ничего не отключаем");
  await telegram.handleUpdate(offCallback("off:no"));
  assert.strictEqual(tables.staff[0].telegram_chat_id, MASTER_CHAT);
  api.length = 0;
  await telegram.handleUpdate(offCallback("off:yes"));
  assert.strictEqual(tables.staff[0].telegram_chat_id, null);
  assert.strictEqual(tables.telegram_clients.length, 0, "клиентская подписка тоже снята");
  assert.ok(sent().some((m) => m.text.includes("Уведомления отключены") && m.reply_markup.remove_keyboard));
  ok("Кнопка «Отключить уведомления» спрашивает подтверждение и отключает мастера и клиента");

  console.log("\nВсе unit-тесты Telegram администратора пройдены.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
