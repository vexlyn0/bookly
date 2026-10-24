/**
 * Unit-тесты расчёта свободного времени: перерывы, выходные, блоки, другие часы
 * Использование: npm run test:slots-unit
 */

const assert = require("assert");
const { computeSlots, resolveDay } = require("../server/lib/slots");

const DATE = "2030-03-12"; // далеко в будущем — «прошедшее время» не мешает
const schedule = { is_working: true, start_time: "10:00", end_time: "15:00", break_start: "12:00", break_end: "13:00" };
const starts = (slots) => slots.map((s) => s.start_time);

function ok(message) {
  console.log("[OK]", message);
}

// Перерыв
let slots = computeSlots({ schedule, durationMinutes: 60, bookings: [], dateStr: DATE, timeZone: "UTC" });
assert.ok(starts(slots).includes("10:00"));
assert.ok(starts(slots).includes("11:00"), "11:00–12:00 заканчивается ровно к перерыву");
assert.ok(!starts(slots).includes("11:15"), "11:15 залезает на перерыв");
assert.ok(!starts(slots).includes("12:00") && !starts(slots).includes("12:45"));
assert.ok(starts(slots).includes("13:00"));
ok("Перерыв 12:00–13:00 закрывает пересекающееся время");

// Блок
slots = computeSlots({
  schedule,
  durationMinutes: 60,
  bookings: [],
  dateStr: DATE,
  timeZone: "UTC",
  timeOff: [{ kind: "block", date_from: DATE, date_to: DATE, start_time: "13:30", end_time: "14:00", note: "Личное" }],
});
assert.ok(!starts(slots).includes("13:00") && !starts(slots).includes("13:15"));
assert.ok(starts(slots).includes("14:00"));
ok("Блок времени закрывает пересекающееся время");

// Другие часы — вместо графика, без перерыва; работают даже в выходной по графику
const offSchedule = { is_working: false };
slots = computeSlots({
  schedule: offSchedule,
  durationMinutes: 60,
  bookings: [],
  dateStr: DATE,
  timeZone: "UTC",
  timeOff: [{ kind: "hours", date_from: DATE, date_to: DATE, start_time: "12:00", end_time: "14:00" }],
});
assert.deepStrictEqual(starts(slots), ["12:00", "12:15", "12:30", "12:45", "13:00"]);
ok("«Другие часы» включают выходной день и заменяют график");

// Отпуск — день целиком
const day = resolveDay(schedule, DATE, [{ kind: "off", date_from: "2030-03-10", date_to: "2030-03-15", note: "Отпуск" }]);
assert.deepStrictEqual(day, { schedule: null, blocked: [], off: "Отпуск" });
assert.strictEqual(
  computeSlots({ schedule, durationMinutes: 30, bookings: [], dateStr: DATE, timeZone: "UTC", timeOff: [{ kind: "off", date_from: DATE, date_to: DATE }] }).length,
  0
);
assert.strictEqual(resolveDay(schedule, "2030-03-16", [{ kind: "off", date_from: "2030-03-10", date_to: "2030-03-15" }]).off, null, "после отпуска — работает");
ok("Отпуск закрывает все дни периода, после него — обычный график");

// Исключения на другие даты не влияют
slots = computeSlots({
  schedule,
  durationMinutes: 60,
  bookings: [],
  dateStr: DATE,
  timeZone: "UTC",
  timeOff: [{ kind: "block", date_from: "2030-03-13", date_to: "2030-03-13", start_time: "10:00", end_time: "15:00" }],
});
assert.ok(starts(slots).includes("10:00"));
ok("Исключения других дней не мешают");

console.log("\nВсе unit-тесты расчёта свободного времени пройдены.");
