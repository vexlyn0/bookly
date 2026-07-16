/**
 * Печатает шаблон Render Environment Variables без значений.
 * Не читает и не подставляет .env.
 *
 * Usage: node scripts/print-render-env-template.js
 */

const lines = [
  "# REQUIRED — Bookly production (Render Environment)",
  "SUPABASE_URL=",
  "SUPABASE_ANON_KEY=",
  "SUPABASE_SERVICE_ROLE_KEY=",
  "",
  "# OPTIONAL — Kaspi manual billing (all three required together)",
  "KASPI_PAYMENT_RECIPIENT=",
  "KASPI_PAYMENT_PHONE=",
  "KASPI_PAYMENT_INSTRUCTIONS=",
  "",
  "# OPTIONAL — runtime",
  "NODE_ENV=production",
  "",
  "# NOTE: Render sets PORT automatically — do not hardcode unless needed.",
  "# Do NOT put TEST_EMAIL / TEST_PASSWORD / DATABASE_URL in production.",
];

console.log(lines.join("\n"));
