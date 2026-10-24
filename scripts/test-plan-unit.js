/**
 * Unit-тесты тарифа Free / Pro на сервере (без Supabase и сети)
 * Использование: npm run test:plan-unit
 */

const assert = require("assert");

let rpcHandler = () => ({ data: null, error: null });
const rpcCalls = [];

require("../server/lib/supabase-admin").getSupabaseAdmin = () => ({
  rpc: async (name, params) => {
    rpcCalls.push({ name, params });
    return rpcHandler(name, params);
  },
});

const {
  normalizeEntitlements,
  requireOrganizationOperational,
  mapSubscriptionError,
} = require("../server/lib/subscription-service");
const { toPublicOrganization } = require("../server/lib/public-booking-service");

const ORG_ID = "11111111-2222-4333-8444-555555555555";

function ok(message) {
  console.log("[OK]", message);
}

function entitlementsRow(overrides = {}) {
  return {
    plan_code: "free",
    is_pro: false,
    is_trial: false,
    is_suspended: false,
    status: "expired",
    days_remaining: null,
    staff_limit: 5,
    active_staff_count: 3,
    trial_available: true,
    show_branding: true,
    ...overrides,
  };
}

function testNormalize() {
  const empty = normalizeEntitlements(null);
  assert.strictEqual(empty.plan_code, "free");
  assert.strictEqual(empty.is_pro, false);
  assert.strictEqual(empty.show_branding, true, "без данных — безопасно считаем Free с подписью");

  const pro = normalizeEntitlements(entitlementsRow({ is_pro: true, staff_limit: null, show_branding: false }));
  assert.strictEqual(pro.plan_code, "pro");
  assert.strictEqual(pro.staff_limit, null);
  assert.strictEqual(pro.show_branding, false);
  ok("normalizeEntitlements: Free по умолчанию, Pro без лимита и подписи");
}

async function testOperational() {
  rpcCalls.length = 0;
  rpcHandler = () => ({ data: [entitlementsRow({ is_suspended: true, status: "suspended" })], error: null });
  await assert.rejects(
    () => requireOrganizationOperational(ORG_ID),
    (error) => error.code === "ORGANIZATION_SUSPENDED" && error.status === 403
  );
  ok("Приостановленная организация → 403 ORGANIZATION_SUSPENDED");

  rpcCalls.length = 0;
  rpcHandler = () => ({ data: [entitlementsRow()], error: null });
  const free = await requireOrganizationOperational(ORG_ID);
  assert.strictEqual(free.plan_code, "free");
  assert.ok(!rpcCalls.some((c) => c.name === "_apply_free_plan_limits"), "в пределах лимита паузы нет");
  ok("Free в пределах лимита работает без изменений");

  rpcCalls.length = 0;
  rpcHandler = (name) =>
    name === "_apply_free_plan_limits"
      ? { data: 2, error: null }
      : { data: [entitlementsRow({ active_staff_count: 7 })], error: null };
  await requireOrganizationOperational(ORG_ID);
  assert.ok(rpcCalls.some((c) => c.name === "_apply_free_plan_limits"), "сверх лимита — пауза лишних мастеров");
  ok("Free сверх лимита → пауза мастеров (_apply_free_plan_limits)");

  rpcCalls.length = 0;
  rpcHandler = () => ({
    data: [entitlementsRow({ is_pro: true, staff_limit: null, active_staff_count: 12, show_branding: false })],
    error: null,
  });
  const pro = await requireOrganizationOperational(ORG_ID);
  assert.strictEqual(pro.is_pro, true);
  assert.ok(!rpcCalls.some((c) => c.name === "_apply_free_plan_limits"), "Pro не ограничивается");
  ok("Pro: мастеров без лимита");

  rpcHandler = () => ({ data: null, error: { code: "XX000", message: "boom" } });
  await assert.rejects(
    () => requireOrganizationOperational(ORG_ID),
    (error) => error.code === "INTERNAL_ERROR" && !error.message.includes("boom")
  );
  ok("Ошибка БД не раскрывается клиенту");
}

function testBrandingAndErrors() {
  const free = toPublicOrganization({ slug: "a", name: "A", show_branding: true });
  const pro = toPublicOrganization({ slug: "b", name: "B", show_branding: false });
  assert.strictEqual(free.show_branding, true);
  assert.strictEqual(pro.show_branding, false);
  ok("Публичная организация: подпись Jazyl только на Free");

  const limit = mapSubscriptionError({ message: "STAFF_LIMIT_REACHED" });
  assert.strictEqual(limit.code, "STAFF_LIMIT_REACHED");
  ok("STAFF_LIMIT_REACHED сопоставляется с понятной ошибкой");
}

async function main() {
  const originalError = console.error;
  console.error = () => {};
  try {
    testNormalize();
    await testOperational();
    testBrandingAndErrors();
  } finally {
    console.error = originalError;
  }
  console.log("\nВсе unit-тесты тарифа пройдены.");
}

main().catch((error) => {
  console.error("[FAIL]", error.message);
  process.exit(1);
});
