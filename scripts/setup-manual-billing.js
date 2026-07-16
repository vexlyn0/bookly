/**
 * Применяет миграцию ручной оплаты и admin-панели через DATABASE_URL
 * Использование: npm run db:manual-billing
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env"), override: true });

const databaseUrl = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();

if (!databaseUrl) {
  console.error("[error] Задайте DATABASE_URL в .env");
  process.exit(1);
}

const sqlPath = path.join(ROOT, "supabase", "migrations", "011_manual_billing_admin.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

async function main() {
  const { Client } = require("pg");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  await client.query(sql);
  await client.end();
  console.log("[ok] Миграция 011_manual_billing_admin.sql применена");
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
