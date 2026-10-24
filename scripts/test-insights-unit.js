/**
 * Unit-тесты расчётов «Клиентов» и «Аналитики»
 * Использование: npm run test:insights-unit
 */

const assert = require("assert");
const insights = require("../public/js/insights/compute.js");

// «Сейчас» — суббота 24.10.2026, 12:00 (локальное время)
const NOW = new Date(2026, 9, 24, 12, 0);
const day = (offset) => insights.addDays("2026-10-24", offset);

let seq = 0;
/** По умолчанию — завершённый визит 10 дней назад, цена записи 5 000 ₸. */
function booking(overrides = {}) {
  seq += 1;
  return {
    id: `b${seq}`,
    booking_date: day(-10),
    start_time: "10:00:00",
    end_time: "11:00:00",
    status: "completed",
    price: 5000,
    paid_amount: null,
    source: "manual",
    client_name: "Алан",
    client_phone: "+7 701 123 45 67",
    staff_id: "s1",
    service_id: "cut",
    services: { name: "Стрижка" },
    ...overrides,
  };
}

const services = [
  { id: "cut", name: "Стрижка", price: 6000 }, // прайс уже подняли — в старых записях 5 000
  { id: "beard", name: "Борода", price: 3000 },
];
const prices = new Map(services.map((s) => [s.id, s.price]));

function ok(message) {
  console.log("[OK]", message);
}

function testVisits() {
  assert.ok(insights.isVisit(booking()), "завершённая — визит");
  assert.ok(!insights.isVisit(booking({ status: "confirmed" })), "прошедшая подтверждённая — ещё не визит");
  assert.ok(insights.isAwaiting(booking({ status: "confirmed", booking_date: day(-1) }), NOW), "…она ждёт отметки");
  assert.ok(!insights.isAwaiting(booking({ status: "confirmed", booking_date: day(1) }), NOW), "будущая не ждёт");
  assert.ok(
    !insights.isAwaiting(booking({ status: "confirmed", booking_date: day(0), start_time: "11:30", end_time: "12:30" }), NOW),
    "идёт прямо сейчас"
  );
  assert.ok(!insights.isVisit(booking({ status: "no_show" })));
  ok("Визит — только отмеченный «Пришёл»/«Завершена»; прошедшие без отметки ждут отметки");
}

function testClients() {
  const bookings = [
    // Алан — постоянный, телефон в разных форматах
    booking({ booking_date: day(-90), client_phone: "8 701 123 45 67" }),
    booking({ booking_date: day(-60), service_id: "beard", services: { name: "Борода" }, price: 3000, paid_amount: 2500 }),
    booking({ booking_date: day(-30), client_name: "Алан Сапаров" }),
    booking({ booking_date: day(3), status: "confirmed" }),
    // Дана — давно не была
    booking({ booking_date: day(-70), client_name: "Дана", client_phone: "+77770000001", staff_id: "s2" }),
    // Мадина — новая, с неявкой, отменой и неотмеченным визитом
    booking({ booking_date: day(-5), client_name: "Мадина", client_phone: "87070000002", status: "no_show" }),
    booking({ booking_date: day(-2), client_name: "Мадина", client_phone: "+7 707 000 00 02", status: "canceled" }),
    booking({ booking_date: day(-1), client_name: "Мадина", client_phone: "87070000002", client_telegram_chat_id: "55" }),
    booking({ booking_date: day(-1), start_time: "15:00", end_time: "16:00", client_name: "Мадина", client_phone: "87070000002", status: "confirmed" }),
  ];

  const clients = insights.aggregateClients(bookings, { now: NOW, priceByService: prices });
  assert.strictEqual(clients.length, 3, "группировка по номеру в любом формате");

  const alan = clients.find((c) => c.key === "77011234567");
  assert.strictEqual(alan.name, "Алан", "имя из последней записи");
  assert.strictEqual(alan.visits, 3);
  assert.strictEqual(alan.spent, 5000 + 2500 + 5000, "оплачено по факту, иначе цена записи (не новый прайс)");
  assert.strictEqual(alan.lastVisit, day(-30));
  assert.strictEqual(alan.daysSinceVisit, 30);
  assert.strictEqual(alan.nextBooking.booking_date, day(3));
  assert.strictEqual(alan.favoriteServiceName, "Стрижка");

  const madina = clients.find((c) => c.name === "Мадина");
  assert.strictEqual(madina.visits, 1, "неотмеченный визит не считается");
  assert.strictEqual(madina.noShows, 1);
  assert.strictEqual(madina.cancellations, 1);
  assert.ok(madina.telegram);
  ok("Сводка по клиенту: визиты, сумма по факту, последний визит, следующая запись, неявки");

  const counts = insights.segmentCounts(clients, { lapsedDays: 45, now: NOW });
  assert.deepStrictEqual(counts, { all: 3, lapsed: 1, regular: 1, new: 1, noshow: 1 });
  assert.strictEqual(insights.filterClients(clients, { segment: "lapsed", now: NOW })[0].name, "Дана");
  assert.strictEqual(
    insights.filterClients(clients, { segment: "lapsed", lapsedDays: 25, now: NOW }).length,
    1,
    "у Алана есть будущая запись — его не приглашаем"
  );
  ok("Сегменты: давно не были / постоянные / новые / с неявками");

  assert.strictEqual(insights.filterClients(clients, { query: "мад", now: NOW }).length, 1);
  assert.strictEqual(insights.filterClients(clients, { query: "8777 000", now: NOW })[0].name, "Дана");
  ok("Поиск по имени и по номеру в любом формате");

  const csv = insights.clientsToCsv(clients, (id) => (id === "s1" ? "Ерлан" : ""));
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.includes('"Алан";"+7 701 123 45 67";"3"'));
  assert.ok(csv.includes('"Ерлан"'));
  ok("Экспорт в CSV для Excel");
}

function testAnalytics() {
  const bookings = [
    // Текущие 7 дней (18.10–24.10)
    booking({ booking_date: day(-1), source: "public_booking" }),
    booking({ booking_date: day(-2), service_id: "beard", services: { name: "Борода" }, price: 3000, paid_amount: 3500, staff_id: "s2", client_phone: "87770000001" }),
    booking({ booking_date: day(-3), status: "no_show", client_phone: "87070000009" }),
    booking({ booking_date: day(-4), status: "canceled" }),
    booking({ booking_date: day(-5), status: "confirmed" }), // прошла, но не отмечена
    booking({ booking_date: day(0), start_time: "15:00", end_time: "16:00", status: "confirmed" }), // ещё впереди
    // Предыдущие 7 дней
    booking({ booking_date: day(-9) }),
    booking({ booking_date: day(-10), source: "public_booking" }),
  ];
  const schedules = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    staff_id: "s1",
    day_of_week: d,
    is_working: true,
    start_time: "10:00",
    end_time: "20:00",
  }));
  const staff = [
    { id: "s1", name: "Ерлан" },
    { id: "s2", name: "Дана" },
  ];

  const a = insights.computeAnalytics({ bookings, schedules, staff, services, period: 7, now: NOW });

  assert.deepStrictEqual(a.range, { from: day(-6), to: day(0), days: 7 });
  assert.strictEqual(a.current.visits, 2);
  assert.strictEqual(a.current.revenue, 5000 + 3500, "цена записи и фактическая оплата");
  assert.strictEqual(a.current.avgCheck, 4250);
  assert.strictEqual(a.current.awaiting, 1, "прошедшая без отметки");
  assert.strictEqual(a.current.awaitingAmount, 5000);
  assert.strictEqual(a.current.noShows, 1);
  assert.strictEqual(a.current.noShowRate, 33);
  assert.strictEqual(a.current.cancellations, 1);
  assert.strictEqual(a.current.bookings, 5, "без отменённых");
  assert.strictEqual(a.current.onlineShare, 20);
  assert.strictEqual(a.current.newClients, 2, "Дана и клиент с неявкой впервые в этом периоде");
  ok("Итоги: выручка только по отмеченным визитам, «ждут отметки» отдельно");

  assert.strictEqual(a.previous.revenue, 10000);
  assert.strictEqual(a.deltas.revenue, -15);
  ok("Сравнение с прошлым периодом");

  assert.strictEqual(a.chart.length, 7);
  assert.strictEqual(a.chart.find((c) => c.from === day(-1)).revenue, 5000);
  ok("График выручки по дням");

  const erlan = a.byStaff.find((r) => r.name === "Ерлан");
  assert.strictEqual(erlan.visits, 1);
  assert.strictEqual(erlan.revenue, 5000);
  // 7 рабочих дней по 600 мин = 4200; занято: визит, неявка и неотмеченная — 180 мин → 4%
  assert.strictEqual(erlan.load, 4);
  assert.strictEqual(a.byStaff[0].name, "Ерлан", "сортировка по выручке");
  assert.strictEqual(a.byStaff.find((r) => r.name === "Дана").load, null, "без графика — загрузку не считаем");
  ok("По мастерам: визиты, выручка, загрузка по графику");

  assert.deepStrictEqual(a.topServices.map((s) => s.name), ["Стрижка", "Борода"]);
  assert.strictEqual(a.weekdays.reduce((s, n) => s + n, 0), 5);
  ok("Топ услуг и загрузка по дням недели");

  const q = insights.computeAnalytics({ bookings, schedules, staff, services, period: 90, now: NOW });
  assert.strictEqual(q.bucketDays, 7, "90 дней — по неделям");
  const prevMonth = insights.resolvePeriod("prev_month", NOW);
  assert.deepStrictEqual(prevMonth, { from: "2026-09-01", to: "2026-09-30", days: 30 });
  ok("Периоды: 90 дней по неделям, прошлый месяц");
}

testVisits();
testClients();
testAnalytics();
console.log("\nВсе unit-тесты клиентов и аналитики пройдены.");
