/**
 * Unit-тесты часов работы салона («Открыто до 20:00»)
 * Использование: npm run test:org-hours-unit
 */

const assert = require("assert");
const { computeOrgHours, dayIndex } = require("../server/lib/org-hours");

function ok(message) {
  console.log("[OK]", message);
}

const TODAY = "2030-03-12"; // вторник
assert.strictEqual(dayIndex(TODAY), 1);

// Айгерим вт 10–19 с перерывом, Ерлан вт 12–21, в воскресенье никто
const schedules = [
  { staff_id: "a", day_of_week: 1, is_working: true, start_time: "10:00", end_time: "19:00", break_start: "13:00", break_end: "14:00" },
  { staff_id: "b", day_of_week: 1, is_working: true, start_time: "12:00", end_time: "21:00" },
  { staff_id: "a", day_of_week: 2, is_working: true, start_time: "10:00", end_time: "18:00" },
  { staff_id: "b", day_of_week: 6, is_working: false },
];
const staffIds = ["a", "b"];

let result = computeOrgHours({ staffIds, schedules, timeOff: [], today: TODAY, nowMinutes: 11 * 60 });
assert.deepStrictEqual(result.hours[1], { open: "10:00", close: "21:00" });
assert.strictEqual(result.hours[6], null);
assert.deepStrictEqual(result.status, { open_now: true, closes_at: "21:00" });
ok("Открыто: закрывается, когда уходит последний мастер");

result = computeOrgHours({ staffIds, schedules, timeOff: [], today: TODAY, nowMinutes: 8 * 60 });
assert.deepStrictEqual(result.status, { open_now: false, opens_at: "10:00", opens_date: TODAY });
ok("Утром: «откроется в 10:00»");

result = computeOrgHours({ staffIds, schedules, timeOff: [], today: TODAY, nowMinutes: 22 * 60 });
assert.deepStrictEqual(result.status, { open_now: false, opens_at: "10:00", opens_date: "2030-03-13" });
ok("Вечером: откроется завтра");

// Ерлан в отпуске — салон закрывается раньше
result = computeOrgHours({
  staffIds,
  schedules,
  timeOff: [{ staff_id: "b", kind: "off", date_from: TODAY, date_to: TODAY }],
  today: TODAY,
  nowMinutes: 11 * 60,
});
assert.deepStrictEqual(result.status, { open_now: true, closes_at: "19:00" });
ok("Отпуск мастера учитывается");

// Никто не работает
result = computeOrgHours({ staffIds: [], schedules, timeOff: [], today: TODAY, nowMinutes: 600 });
assert.deepStrictEqual(result.status, { open_now: false });
assert.ok(result.hours.every((h) => h === null));
ok("Без мастеров — часов нет");

console.log("\nВсе unit-тесты часов работы салона пройдены.");
