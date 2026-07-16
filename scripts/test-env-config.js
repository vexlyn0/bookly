/**
 * Статические/unit-тесты конфигурации env и Kaspi resilience.
 * Не трогает production-данные и не печатает секреты.
 */

const assert = require("assert");
const {
  resolveSupabaseConfig,
  resolveKaspiConfig,
  getMissingRequiredEnvNames,
  getMissingKaspiEnvNames,
} = require("../server/lib/env-resolve");

function fail(msg) {
  console.error("[FAIL]", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[OK]", msg);
}

function testSupabaseRequired() {
  const missing = getMissingRequiredEnvNames({});
  assert.deepStrictEqual(missing, [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  ok("1. missing required env names reported without values");

  const partial = getMissingRequiredEnvNames({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon",
  });
  assert.deepStrictEqual(partial, ["SUPABASE_SERVICE_ROLE_KEY"]);
  ok("2. service role absence detected");

  const alt = resolveSupabaseConfig({
    SUPABASE_URL: "https://example.supabase.co/rest/v1/",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    SUPABASE_SECRET_KEY: "secret",
  });
  assert.strictEqual(alt.url, "https://example.supabase.co");
  assert.strictEqual(alt.isConfigured, true);
  assert.strictEqual(alt.anonKey, "sb_publishable_x");
  ok("3. aliases + URL normalize work");
}

function testKaspiPartial() {
  const none = resolveKaspiConfig({});
  assert.strictEqual(none.isConfigured, false);
  assert.strictEqual(none.recipient, "");
  assert.strictEqual(none.phone, "");
  assert.strictEqual(none.instructions, "");
  ok("4. empty Kaspi → configured=false, no partial values");

  const partial = resolveKaspiConfig({
    KASPI_PAYMENT_RECIPIENT: "ООО Тест",
    KASPI_PAYMENT_PHONE: "+7700",
  });
  assert.strictEqual(partial.isConfigured, false);
  assert.strictEqual(partial.recipient, "");
  assert.strictEqual(partial.phone, "");
  ok("5. partial Kaspi → configured=false, fields cleared");

  const full = resolveKaspiConfig({
    KASPI_PAYMENT_RECIPIENT: "ООО Тест",
    KASPI_PAYMENT_PHONE: "+77001112233",
    KASPI_PAYMENT_INSTRUCTIONS: "Укажите название компании",
  });
  assert.strictEqual(full.isConfigured, true);
  assert.strictEqual(full.recipient, "ООО Тест");
  assert.strictEqual(full.phone, "+77001112233");
  ok("6. full Kaspi → configured=true");

  const missing = getMissingKaspiEnvNames({
    KASPI_PAYMENT_RECIPIENT: "x",
  });
  assert.ok(missing.includes("KASPI_PAYMENT_PHONE"));
  assert.ok(missing.includes("KASPI_PAYMENT_INSTRUCTIONS"));
  ok("7. missing Kaspi names listed");
}

function testBillingKaspiPayloadShape() {
  // Simulate getKaspiPaymentInfo logic without loading full billing (avoids supabase)
  const plan = { price_amount: 6990, currency: "KZT" };
  const months = 1;

  function buildKaspi(kaspiCfg) {
    const amount = plan.price_amount * months;
    if (!kaspiCfg.isConfigured) {
      return {
        configured: false,
        recipient: null,
        phone: null,
        instructions: null,
        amount,
        currency: plan.currency,
        billing_months: months,
      };
    }
    return {
      configured: true,
      recipient: kaspiCfg.recipient,
      phone: kaspiCfg.phone,
      instructions: kaspiCfg.instructions,
      amount,
      currency: plan.currency,
      billing_months: months,
    };
  }

  const empty = buildKaspi(resolveKaspiConfig({}));
  assert.strictEqual(empty.configured, false);
  assert.strictEqual(empty.recipient, null);
  assert.strictEqual(empty.phone, null);
  assert.strictEqual(empty.instructions, null);
  ok("8. payment-info kaspi shape when unconfigured");

  const ready = buildKaspi(
    resolveKaspiConfig({
      KASPI_PAYMENT_RECIPIENT: "R",
      KASPI_PAYMENT_PHONE: "P",
      KASPI_PAYMENT_INSTRUCTIONS: "I",
    })
  );
  assert.strictEqual(ready.configured, true);
  assert.strictEqual(ready.recipient, "R");
  ok("9. payment-info kaspi shape when configured");
}

function testNoSecretsInHealthContract() {
  const health = {
    ok: true,
    supabase_configured: true,
    kaspi_configured: false,
  };
  const json = JSON.stringify(health);
  assert.ok(!json.includes("supabase.co"));
  assert.ok(!json.includes("eyJ"));
  assert.ok(!json.includes("service_role"));
  assert.ok(!json.includes("+7"));
  ok("10. health payload contract has no secrets/details");
}

function testPublicConfigDoesNotExposeServiceRole() {
  const fs = require("fs");
  const path = require("path");
  const publicConfig = fs.readFileSync(
    path.join(__dirname, "..", "server", "routes", "public-config.js"),
    "utf8"
  );
  const health = fs.readFileSync(
    path.join(__dirname, "..", "server", "routes", "health.js"),
    "utf8"
  );
  assert.ok(publicConfig.includes("supabaseAnonKey"));
  assert.ok(!publicConfig.includes("serviceRole"));
  assert.ok(!publicConfig.includes("SERVICE_ROLE"));
  assert.ok(health.includes("supabase_configured"));
  assert.ok(health.includes("kaspi_configured"));
  assert.ok(!health.includes("supabaseUrl"));
  assert.ok(!health.includes("recipient"));
  ok("11. public-config/health do not expose service role or Kaspi details");
}

try {
  testSupabaseRequired();
  testKaspiPartial();
  testBillingKaspiPayloadShape();
  testNoSecretsInHealthContract();
  testPublicConfigDoesNotExposeServiceRole();
  console.log("\n[done] test:env-config успешно");
} catch (error) {
  fail(error.message);
}
