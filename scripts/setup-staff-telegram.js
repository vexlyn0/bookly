/**
 * Применяет миграции Telegram для сотрудников (012–014) через DATABASE_URL
 * Использование: npm run db:staff-telegram
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env"), override: true });

const databaseUrl = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();

if (!databaseUrl) {
  console.error("[error] Задайте DATABASE_URL в .env (Supabase → Database → Connection string)");
  process.exit(1);
}

const MIGRATIONS = [
  "012_staff_telegram.sql",
  "013_staff_telegram_token.sql",
  "014_staff_telegram_finalize.sql",
];

async function main() {
  const { Client } = require("pg");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    for (const file of MIGRATIONS) {
      const sql = fs.readFileSync(path.join(ROOT, "supabase", "migrations", file), "utf8");
      await client.query(sql);
      console.log(`[ok] Миграция ${file} применена`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
