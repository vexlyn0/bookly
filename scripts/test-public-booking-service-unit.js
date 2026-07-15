/**
 * Unit-тесты public-booking-service (без Supabase)
 */

const {
  mapDbBookingError,
  computeBookingEndTime,
  assertSupabaseResult,
} = require("../server/lib/public-booking-service");

function fail(msg) {
  console.error("[FAIL]", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[OK]", msg);
}

function testUnknownDbError() {
  const err = mapDbBookingError("FATAL: connection to server failed", "08006");
  if (err.code !== "INTERNAL_ERROR" || err.status !== 500) {
    fail(`Ожидался INTERNAL_ERROR 500, получено ${err.code} ${err.status}`);
  }
  if (err.message.includes("FATAL") || err.message.includes("connection")) {
    fail("Текст PostgreSQL не должен попадать клиенту");
  }
  if (err.message !== "Не удалось создать запись. Попробуйте позже") {
    fail(`Неожиданное сообщение: ${err.message}`);
  }
  ok("Неизвестная ошибка БД → INTERNAL_ERROR 500");
}

function testKnownDbErrorsPreserved() {
  const cases = [
    ["BOOKING_TIME_CONFLICT", "bookings_no_active_overlap", "23P01", 409],
    ["BOOKING_IN_PAST", "BOOKING_IN_PAST", "", 400],
    ["SERVICE_INACTIVE", "BOOKING_SERVICE_INACTIVE", "", 400],
    ["STAFF_INACTIVE", "BOOKING_STAFF_INACTIVE", "", 400],
    ["STAFF_SERVICE_MISMATCH", "BOOKING_STAFF_SERVICE_MISMATCH", "", 400],
    ["NO_WORK_SCHEDULE", "BOOKING_OUTSIDE_SCHEDULE", "", 400],
    ["BOOKING_REFERENCE_GENERATION_FAILED", "BOOKING_REFERENCE_GENERATION_FAILED", "", 500],
  ];

  for (const [code, message, pgCode, status] of cases) {
    const err = mapDbBookingError(message, pgCode);
    if (err.code !== code || err.status !== status) {
      fail(`mapDbBookingError(${message}): ожидался ${code}/${status}, получено ${err.code}/${err.status}`);
    }
  }
  ok("Известные сопоставления mapDbBookingError сохранены");
}

function testComputeBookingEndTime() {
  if (computeBookingEndTime("10:00", 30) !== "10:30") {
    fail("10:00 + 30 мин должно быть 10:30");
  }
  if (computeBookingEndTime("11:45", 30) !== "12:15") {
    fail("Переход через час: 11:45 + 30 = 12:15");
  }
  ok("end_time вычисляется как start_time + duration_minutes");
}

function testAssertSupabaseResultBookingsError() {
  try {
    assertSupabaseResult(
      { data: null, error: { message: "permission denied for table bookings", code: "42501" } },
      "bookings"
    );
    fail("assertSupabaseResult должен бросать при ошибке bookings");
  } catch (error) {
    if (error.code !== "INTERNAL_ERROR" || error.status !== 500) {
      fail(`Ошибка bookings: ожидался INTERNAL_ERROR 500, получено ${error.code}`);
    }
    if (String(error.message).includes("permission denied")) {
      fail("Текст ошибки БД не должен попадать клиенту");
    }
  }
  ok("Ошибка запроса bookings → INTERNAL_ERROR, слоты не рассчитываются");
}

function main() {
  testUnknownDbError();
  testKnownDbErrorsPreserved();
  testComputeBookingEndTime();
  testAssertSupabaseResultBookingsError();
  console.log("\nВсе unit-тесты public-booking-service пройдены.");
}

main();
