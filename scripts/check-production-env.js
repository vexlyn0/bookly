/**
 * Безопасная проверка production/local env.
 * Выводит только наличие переменных — никогда не печатает значения.
 *
 * Usage: node scripts/check-production-env.js
 */

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const {
  getMissingRequiredEnvNames,
  getMissingKaspiEnvNames,
  REQUIRED_ENV_NAMES,
  OPTIONAL_KASPI_ENV_NAMES,
  OPTIONAL_TELEGRAM_ENV_NAMES,
} = require("../server/lib/env-resolve");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

function isPresent(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function hasAnonKey() {
  return isPresent("SUPABASE_ANON_KEY") || isPresent("SUPABASE_PUBLISHABLE_KEY");
}

function hasServiceKey() {
  return isPresent("SUPABASE_SERVICE_ROLE_KEY") || isPresent("SUPABASE_SECRET_KEY");
}

function reportRequired(name, ok) {
  if (ok) {
    console.log(`[OK] ${name} configured`);
  } else {
    console.log(`[MISSING] ${name}`);
  }
}

function reportOptional(name, ok) {
  if (ok) {
    console.log(`[OK] ${name} configured`);
  } else {
    console.log(`[WARN] ${name} missing`);
  }
}

console.log("Bookly env check (values hidden)\n");

reportRequired("SUPABASE_URL", isPresent("SUPABASE_URL"));
reportRequired("SUPABASE_ANON_KEY", hasAnonKey());
reportRequired("SUPABASE_SERVICE_ROLE_KEY", hasServiceKey());

for (const name of OPTIONAL_KASPI_ENV_NAMES) {
  reportOptional(name, isPresent(name));
}

for (const name of OPTIONAL_TELEGRAM_ENV_NAMES) {
  reportOptional(name, isPresent(name));
}

const testOnly = ["TEST_EMAIL", "TEST_PASSWORD", "DATABASE_URL"];
console.log("");
for (const name of testOnly) {
  if (isPresent(name)) {
    console.log(`[OK] ${name} configured (test/local only)`);
  } else {
    console.log(`[SKIP] ${name} not set (ok for production)`);
  }
}

const missingRequired = getMissingRequiredEnvNames(process.env);
const missingKaspi = getMissingKaspiEnvNames(process.env);

console.log("");
if (missingRequired.length) {
  console.error("[FAIL] Missing required env:");
  for (const name of missingRequired) {
    console.error(`  - ${name}`);
  }
  // Required list for clarity (canonical names only)
  void REQUIRED_ENV_NAMES;
  process.exitCode = 1;
} else {
  console.log("[done] Required Supabase env present");
  if (missingKaspi.length) {
    console.log("[note] Kaspi optional env incomplete — billing stays disabled safely");
  }
  process.exitCode = 0;
}
