/**
 * Unit-тесты предоплаты Kaspi: сумма, «Я оплатил», «Деньги пришли / Не пришли», автоотмена
 * Использование: npm run test:prepay-unit
 */

const assert = require("assert");

const tables = {};
const sent = [];

function fakeSupabase() {
  return {
    from(table) {
      const filters = [];
      let patch = null;
      let single = false;
      const builder = {
        select: () => builder,
        order: () => builder,
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        in(column, values) {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        lt(column, value) {
          filters.push((row) => row[column] < value);
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
          const rows = (tables[table] || []).filter((row) => filters.every((f) => f(row)));
          if (patch) rows.forEach((row) => Object.assign(row, patch));
          const copy = JSON.parse(JSON.stringify(rows));
          return Promise.resolve({ data: single ? copy[0] || null : copy, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

require("../server/lib/supabase-admin").getSupabaseAdmin = () => fakeSupabase();
const telegram = require("../server/lib/telegram-service");
telegram.sendToStaff = async (staff, text, extra) => sent.push({ to: staff.telegram_chat_id, text, extra });
telegram.answerCallback = async (id, text) => sent.push({ answer: text });
telegram.editMessage = async (chatId, messageId, text) => sent.push({ edit: text });
require("../server/lib/client-bot-service").notifyClientOfChange = async () => 0;

const prepay = require("../server/lib/prepay-service");

function ok(message) {
  console.log("[OK]", message);
}

const BOOKING_ID = "11111111-1111-1111-1111-111111111111";

function reset(overrides = {}) {
  sent.length = 0;
  tables.staff = [{ id: "s1", telegram_chat_id: "777" }];
  tables.bookings = [
    {
      id: BOOKING_ID,
      organization_id: "o1",
      staff_id: "s1",
      status: "pending",
      booking_date: "2030-03-12",
      start_time: "15:00:00",
      end_time: "16:00:00",
      client_name: "Асель",
      client_phone: "+77010000000",
      prepay_amount: 3000,
      prepay_status: "awaiting",
      prepay_deadline: "2030-03-10T10:30:00.000Z",
      services: { name: "Маникюр", price: 8000 },
      staff: { id: "s1", name: "Айгерим", telegram_chat_id: "777" },
      organizations: { id: "o1", name: "Aru", timezone: "UTC" },
      ...overrides,
    },
  ];
}

(async () => {
  // Сумма
  assert.strictEqual(prepay.computePrepayAmount({ prepay_type: "none", price: 8000 }), 0);
  assert.strictEqual(prepay.computePrepayAmount({ prepay_type: "fixed", prepay_value: 2000, price: 8000 }), 2000);
  assert.strictEqual(prepay.computePrepayAmount({ prepay_type: "fixed", prepay_value: 9000, price: 8000 }), 8000);
  assert.strictEqual(prepay.computePrepayAmount({ prepay_type: "percent", prepay_value: 30, price: 15000 }), 4500);
  assert.strictEqual(prepay.computePrepayAmount({ prepay_type: "percent", prepay_value: 33, price: 10000 }), 3300);
  assert.strictEqual(prepay.computePrepayAmount({ prepay_type: "percent", prepay_value: 30, price: 0 }), 0);
  ok("Сумма предоплаты: фиксированная (не больше цены) и процент с округлением до 100 ₸");

  // Без Kaspi у салона — без предоплаты; с Kaspi — держим 30 минут
  const service = { prepay_type: "fixed", prepay_value: 2000, price: 8000 };
  assert.strictEqual(prepay.prepayFieldsForNewBooking({}, service), null);
  const now = new Date("2030-03-10T10:00:00.000Z");
  const fields = prepay.prepayFieldsForNewBooking({ kaspi_phone: "+7 701 000 00 00" }, service, now);
  assert.deepStrictEqual(fields, {
    prepay_amount: 2000,
    prepay_status: "awaiting",
    prepay_deadline: "2030-03-10T10:30:00.000Z",
  });
  ok("Предоплата включается, только если у салона указан Kaspi; держим 30 минут по умолчанию");

  // «Я оплатил» → мастеру «Проверьте Kaspi» с кнопками
  reset();
  await prepay.claim(tables.bookings[0]);
  assert.strictEqual(tables.bookings[0].prepay_status, "claimed");
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, "777");
  assert.ok(sent[0].text.includes("3 000 ₸"));
  assert.deepStrictEqual(
    sent[0].extra.reply_markup.inline_keyboard[0].map((b) => b.callback_data),
    [`pp:ok:${BOOKING_ID}`, `pp:no:${BOOKING_ID}`]
  );
  ok("«Я оплатил» → мастеру в Telegram «Проверьте Kaspi» с кнопками");

  // «Деньги пришли» → подтверждено
  await prepay.handleCallback({ callbackId: "c1", chatId: 777, messageId: 1, data: `pp:ok:${BOOKING_ID}` });
  assert.strictEqual(tables.bookings[0].status, "confirmed");
  assert.strictEqual(tables.bookings[0].prepay_status, "paid");
  ok("«Деньги пришли» → запись подтверждена");

  // Повторное нажатие — «уже подтверждена», ничего не меняет
  sent.length = 0;
  await prepay.handleCallback({ callbackId: "c2", chatId: 777, messageId: 1, data: `pp:no:${BOOKING_ID}` });
  assert.strictEqual(tables.bookings[0].status, "confirmed");
  assert.ok(sent.some((m) => m.answer === "Оплата уже подтверждена"));
  ok("Второе нажатие (или нажал владелец в кабинете) ничего не ломает");

  // «Не пришли» → отменено
  reset({ prepay_status: "claimed" });
  await prepay.handleCallback({ callbackId: "c3", chatId: 777, messageId: 1, data: `pp:no:${BOOKING_ID}` });
  assert.strictEqual(tables.bookings[0].status, "canceled");
  assert.strictEqual(tables.bookings[0].prepay_status, "rejected");
  ok("«Не пришли» → запись отменена");

  // Чужой чат не может подтвердить
  reset({ prepay_status: "claimed" });
  await prepay.handleCallback({ callbackId: "c4", chatId: 999, messageId: 1, data: `pp:ok:${BOOKING_ID}` });
  assert.strictEqual(tables.bookings[0].status, "pending");
  ok("Подтвердить оплату может только мастер этой записи");

  // Автоотмена: просрочено и не нажал «Я оплатил»
  reset();
  assert.strictEqual(await prepay.expireUnpaid(new Date("2030-03-10T10:29:00.000Z")), 0);
  assert.strictEqual(await prepay.expireUnpaid(new Date("2030-03-10T10:31:00.000Z")), 1);
  assert.strictEqual(tables.bookings[0].status, "canceled");
  assert.strictEqual(tables.bookings[0].prepay_status, "expired");
  reset({ prepay_status: "claimed" });
  assert.strictEqual(await prepay.expireUnpaid(new Date("2030-03-10T11:00:00.000Z")), 0);
  ok("Не оплатил вовремя — запись отменяется; нажал «Я оплатил» — ждём салон, не отменяем");

  console.log("\nВсе unit-тесты предоплаты пройдены.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
