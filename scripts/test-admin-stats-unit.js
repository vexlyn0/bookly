/**
 * Unit-тесты показателей админ-панели платформы
 * Использование: npm run test:admin-stats-unit
 */

const assert = require("assert");
const stats = require("../server/lib/platform-admin-stats");

const NOW = new Date("2026-10-24T12:00:00Z");
const ago = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();
const ahead = (days) => new Date(NOW.getTime() + days * 86400000).toISOString();

function ok(message) {
  console.log("[OK]", message);
}

const raw = {
  organizations: [
    { id: "live", name: "Live ТОО", public_name: "Барбершоп Live", slug: "live", created_at: ago(40), public_booking_enabled: true },
    { id: "trial", name: "Trial", slug: "trial", created_at: ago(12), public_booking_enabled: true },
    { id: "sleep", name: "Sleepy", slug: "sleepy", created_at: ago(5), public_booking_enabled: false },
    { id: "new", name: "Newbie", slug: "newbie", created_at: ago(1), public_booking_enabled: false },
    { id: "susp", name: "Bad", slug: "bad", created_at: ago(20), public_booking_enabled: true },
  ],
  subscriptions: [
    { organization_id: "live", status: "active", current_period_end: ahead(20) },
    { organization_id: "trial", status: "trialing", trial_ends_at: ahead(2) },
    { organization_id: "sleep", status: "expired" },
    { organization_id: "susp", status: "suspended" },
    // у "new" строки нет — Free
  ],
  owners: [
    { organization_id: "live", user_id: "u1" },
    { organization_id: "sleep", user_id: "u2" },
  ],
  users: [
    { id: "u1", email: "owner@live.kz", last_sign_in_at: ago(1) },
    { id: "u2", email: "sleepy@mail.kz" },
  ],
  staff: [
    { organization_id: "live", is_active: true, telegram_chat_id: "1" },
    { organization_id: "live", is_active: true, telegram_chat_id: null },
    { organization_id: "live", is_active: false, telegram_chat_id: "2" },
    { organization_id: "trial", is_active: true, telegram_chat_id: null },
  ],
  services: [
    { organization_id: "live", is_active: true },
    { organization_id: "trial", is_active: true },
    { organization_id: "sleep", is_active: false },
  ],
  bookings: [
    { organization_id: "live", created_at: ago(1), source: "public_booking", status: "confirmed" },
    { organization_id: "live", created_at: ago(2), source: "manual", status: "completed" },
    { organization_id: "live", created_at: ago(9), source: "public_booking", status: "completed" },
    { organization_id: "live", created_at: ago(35), source: "manual", status: "completed" },
    { organization_id: "trial", created_at: ago(10), source: "public_booking", status: "canceled" },
  ],
  payments: [
    { id: "p1", organization_id: "live", amount: 6990, billing_months: 1, status: "approved", created_at: ago(15), reviewed_at: ago(14) },
    { id: "p2", organization_id: "live", amount: 6990, billing_months: 1, status: "approved", created_at: ago(50), reviewed_at: ago(49) },
    { id: "p3", organization_id: "trial", amount: 6990, billing_months: 1, status: "pending", created_at: ago(1) },
  ],
};

function testPlans() {
  assert.deepStrictEqual(stats.planOf(null, NOW), { plan: "free", until: null });
  assert.strictEqual(stats.planOf({ status: "expired" }, NOW).plan, "free");
  assert.strictEqual(stats.planOf({ status: "trialing", trial_ends_at: ahead(1) }, NOW).plan, "trial");
  assert.strictEqual(stats.planOf({ status: "trialing", trial_ends_at: ago(1) }, NOW).plan, "free", "пробный закончился");
  assert.strictEqual(stats.planOf({ status: "active", current_period_end: ahead(5) }, NOW).plan, "pro");
  assert.strictEqual(stats.planOf({ status: "canceled", current_period_end: ahead(5) }, NOW).plan, "pro", "отменён, но оплачен до конца периода");
  assert.strictEqual(stats.planOf({ status: "active", current_period_end: ago(1) }, NOW).plan, "free");
  assert.strictEqual(
    stats.planOf({ status: "past_due", current_period_end: ago(1), grace_period_ends_at: ahead(2) }, NOW).plan,
    "pro",
    "льготный период"
  );
  assert.strictEqual(stats.planOf({ status: "suspended" }, NOW).plan, "suspended");
  ok("Тариф: Free / Pro / пробный / приостановлен, с учётом дат");
}

function testOrganizations() {
  const orgs = stats.buildOrganizations(raw, NOW);
  const live = orgs.find((o) => o.id === "live");

  assert.strictEqual(live.name, "Барбершоп Live", "публичное название");
  assert.strictEqual(live.owner_email, "owner@live.kz");
  assert.strictEqual(live.plan, "pro");
  assert.strictEqual(live.staff_active, 2);
  assert.strictEqual(live.telegram_staff, 1, "отключённые мастера не считаются");
  assert.strictEqual(live.bookings_total, 4);
  assert.strictEqual(live.bookings_30d, 3);
  assert.strictEqual(live.bookings_7d, 2);
  assert.strictEqual(live.online_30d, 2);
  assert.deepStrictEqual(live.setup, { services: true, staff: true, public_booking: true, telegram: true });
  assert.ok(live.is_live && !live.is_sleeping && !live.is_stuck);

  const sleep = orgs.find((o) => o.id === "sleep");
  assert.ok(sleep.is_sleeping, "5 дней, ни одной записи");
  assert.ok(sleep.is_stuck, "настройка не пройдена");
  assert.strictEqual(sleep.setup_done, 0);

  const fresh = orgs.find((o) => o.id === "new");
  assert.ok(!fresh.is_sleeping && !fresh.is_stuck, "новичку меньше двух дней — не тревожим");
  assert.strictEqual(fresh.plan, "free");
  ok("Строка салона: владелец, тариф, мастера, Telegram, записи, настройка, живой / спящий / застрял");

  const counts = stats.segmentCounts(orgs);
  assert.deepStrictEqual(counts, { all: 5, free: 2, pro: 1, trial: 1, suspended: 1, live: 1, sleeping: 2, stuck: 2 });
  assert.deepStrictEqual(stats.filterOrganizations(orgs, { search: "OWNER@" }).map((o) => o.id), ["live"]);
  assert.deepStrictEqual(stats.filterOrganizations(orgs, { segment: "trial" }).map((o) => o.id), ["trial"]);
  assert.strictEqual(stats.filterOrganizations(orgs)[0].id, "new", "сначала новые");
  ok("Фильтры и поиск по названию, адресу страницы и почте владельца");
}

function testOverview() {
  const orgs = stats.buildOrganizations(raw, NOW);
  const o = stats.buildOverview(raw, orgs, NOW);

  assert.strictEqual(o.organizations.total, 5);
  assert.strictEqual(o.organizations.new_7d, 2);
  assert.strictEqual(o.organizations.new_prev_7d, 1);
  assert.strictEqual(o.organizations.live, 1);
  assert.deepStrictEqual(o.plans, { free: 2, pro: 1, trial: 1, suspended: 1 });

  assert.strictEqual(o.bookings.last_7d, 2);
  assert.strictEqual(o.bookings.prev_7d, 2);
  assert.strictEqual(o.bookings.delta, 0);
  assert.strictEqual(o.bookings.online_share_7d, 50);

  assert.strictEqual(o.payments.approved_30d_amount, 6990, "только оплаты за 30 дней");
  assert.strictEqual(o.payments.pending, 1);

  assert.strictEqual(o.charts.days.length, 30);
  assert.strictEqual(o.charts.signups.reduce((a, b) => a + b, 0), 4, "регистрации за 30 дней");
  assert.strictEqual(o.charts.bookings.reduce((a, b) => a + b, 0), 4);
  ok("Главная: салоны, тарифы, записи с динамикой, оплаты, графики");

  assert.strictEqual(o.attention.pending_payments[0].organization_name, "Trial");
  assert.deepStrictEqual(o.attention.trials_ending.map((x) => x.id), ["trial"]);
  assert.ok(o.attention.stuck.some((x) => x.id === "sleep"));
  ok("«Требует внимания»: заявки, заканчивающиеся пробные, застрявшие салоны");
}

testPlans();
testOrganizations();
testOverview();
console.log("\nВсе unit-тесты показателей админки пройдены.");
