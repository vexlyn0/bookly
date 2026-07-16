/**
 * Выдаёт platform admin по email.
 * Использование: npm run admin:grant -- user@example.com
 */

const path = require("path");
const dotenv = require("dotenv");

const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env"), override: true });

const { createClient } = require("@supabase/supabase-js");

const url = String(process.env.SUPABASE_URL || "").trim();
const serviceKey = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ""
).trim();
const targetEmail = String(process.argv[2] || "").trim().toLowerCase();

if (!url || !serviceKey) {
  console.error("[error] Задайте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env");
  process.exit(1);
}

if (!targetEmail || !targetEmail.includes("@")) {
  console.error("[error] Укажите email: npm run admin:grant -- user@example.com");
  process.exit(1);
}

async function findUserIdByEmail(admin, email) {
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data?.users || [];
    const match = users.find((user) => String(user.email || "").toLowerCase() === email);
    if (match) return match.id;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

async function main() {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userId = await findUserIdByEmail(admin, targetEmail);
  if (!userId) {
    console.error(`[error] Пользователь не найден: ${targetEmail}`);
    process.exit(1);
  }

  const { data: existing } = await admin
    .from("platform_admins")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    console.log(`[ok] Уже platform admin (${existing.role}): ${targetEmail}`);
    return;
  }

  const { error } = await admin.from("platform_admins").insert({
    user_id: userId,
    role: "admin",
  });

  if (error) {
    console.error("[error]", error.message);
    process.exit(1);
  }

  console.log(`[ok] Platform admin выдан: ${targetEmail}`);
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
