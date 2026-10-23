/**
 * Unit-тесты защиты онлайн-записи: лимит 2 записи на номер и чёрный список
 * Использование: npm run test:client-limits-unit
 */

const assert = require("assert");
const {
  phoneKey,
  assertClientMayBook,
  MAX_ACTIVE_BOOKINGS_PER_PHONE,
} = require("../server/lib/public-booking-service");
const { formatDateInTimezone } = require("../server/lib/slots");

const TZ = "Asia/Almaty";
const ORG = { id: "org-1", timezone: TZ };
const tables = { client_blacklist: [], bookings: [] };

function fakeSupabase() {
  return {
    from(table) {
      const filters = [];
      let single = false;
      const builder = {
        select: () => builder,
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
        maybeSingle() {
          single = true;
          return builder;
        },
        then(resolve, reject) {
          const rows = tables[table].filter((row) => filters.every((f) => f(row)));
          return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const day = (offset) => formatDateInTimezone(new Date(Date.now() + offset * 86400000), TZ);
const booking = (overrides) => ({
  organization_id: ORG.id,
  client_phone_key: "77011234567",
  status: "confirmed",
  booking_date: day(1),
  end_time: "13:00:00",
  ...overrides,
});

function ok(message) {
  console.log("[OK]", message);
}

(async () => {
  const supabase = fakeSupabase();

  assert.strictEqual(phoneKey("8 (701) 123-45-67"), "77011234567");
  assert.strictEqual(phoneKey("+7 701 123 45 67"), "77011234567");
  assert.strictEqual(phoneKey("7011234567"), "77011234567");
  ok("Номер приводится к единому виду");

  assert.strictEqual(MAX_ACTIVE_BOOKINGS_PER_PHONE, 2);
  tables.bookings = [booking()];
  await assertClientMayBook(supabase, ORG, "8 701 123 45 67");

  tables.bookings = [booking(), booking({ booking_date: day(2) })];
  await assert.rejects(
    assertClientMayBook(supabase, ORG, "+77011234567"),
    (e) => e.code === "TOO_MANY_ACTIVE_BOOKINGS" && e.status === 409
  );
  ok("Две предстоящие записи на номер — третья онлайн не создаётся (в любом формате номера)");

  tables.bookings = [
    booking(),
    booking({ status: "canceled" }),
    booking({ status: "completed" }),
    booking({ booking_date: day(-1) }),
    booking({ booking_date: day(0), end_time: "00:00:00" }),
    booking({ organization_id: "other-org" }),
    booking({ client_phone_key: "77770000000" }),
  ];
  await assertClientMayBook(supabase, ORG, "87011234567");
  ok("Не считаются: отменённые, завершённые, прошедшие, другая организация, другой номер");

  tables.bookings = [];
  tables.client_blacklist = [{ organization_id: ORG.id, phone_key: "77011234567" }];
  await assert.rejects(
    assertClientMayBook(supabase, ORG, "8 701 123 45 67"),
    (e) => e.code === "CLIENT_BLOCKED" && e.status === 403 && !/чёрн/i.test(e.message)
  );
  await assertClientMayBook(supabase, { ...ORG, id: "other-org" }, "8 701 123 45 67");
  ok("Чёрный список: отказ без слова «чёрный список»; в другой организации номер не заблокирован");

  console.log("\nВсе unit-тесты защиты онлайн-записи пройдены.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
