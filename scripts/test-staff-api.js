/**
 * Интеграционный тест CRUD сотрудников через Supabase API.
 * Требует: 002_services.sql, 003_staff.sql
 * Использование: TEST_EMAIL=... TEST_PASSWORD=... node scripts/test-staff-api.js
 */

const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env"), override: true });

const url = String(process.env.SUPABASE_URL || "").trim();
const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
const emailA = String(process.env.TEST_EMAIL || "").trim();
const emailB = String(process.env.TEST_EMAIL_B || "").trim();
const password = String(process.env.TEST_PASSWORD || "").trim();

function fail(message) {
  console.error("[FAIL]", message);
  process.exit(1);
}

function ok(message) {
  console.log("[OK]", message);
}

async function signIn(email) {
  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) fail(`Вход ${email}: ${error.message}`);
  return supabase;
}

async function getOrgId(supabase) {
  const { data, error } = await supabase.from("organization_members").select("organization_id").limit(1).maybeSingle();
  if (error) fail(`organization_members: ${error.message}`);
  if (!data?.organization_id) fail("У пользователя нет организации");
  return data.organization_id;
}

async function ensureService(supabase, orgId) {
  const { data: existing } = await supabase
    .from("services")
    .select("id")
    .eq("organization_id", orgId)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data, error } = await supabase
    .from("services")
    .insert({
      organization_id: orgId,
      name: "Тестовая услуга",
      price: 1000,
      duration_minutes: 30,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) fail(`Создание услуги: ${error.message}`);
  return data.id;
}

async function main() {
  if (!url || !anonKey) fail("Задайте SUPABASE_URL и SUPABASE_ANON_KEY в .env");
  if (!emailA || !password) fail("Задайте TEST_EMAIL и TEST_PASSWORD в .env");

  const probe = createClient(url, anonKey);
  const { error: probeError } = await probe.from("staff").select("id").limit(1);
  if (probeError?.code === "PGRST205") {
    fail("Таблица staff не найдена. Выполните supabase/migrations/003_staff.sql в Supabase SQL Editor.");
  }
  if (probeError && probeError.code !== "PGRST301") {
    fail(`Проверка таблицы: ${probeError.message}`);
  }
  ok("Таблица staff доступна");

  const clientA = await signIn(emailA);
  const orgA = await getOrgId(clientA);
  const serviceId = await ensureService(clientA, orgA);

  const testName = `Сотрудник ${Date.now()}`;
  const { data: created, error: createError } = await clientA
    .from("staff")
    .insert({
      organization_id: orgA,
      name: testName,
      position: "Мастер",
      is_active: true,
    })
    .select()
    .single();

  if (createError) fail(`Создание: ${createError.message}`);
  ok(`Создан сотрудник ${created.id}`);

  const { error: linkError } = await clientA.from("staff_services").insert({
    staff_id: created.id,
    service_id: serviceId,
    organization_id: orgA,
  });
  if (linkError) fail(`Привязка услуги: ${linkError.message}`);
  ok("Привязка услуги работает");

  const { data: links } = await clientA
    .from("staff_services")
    .select("service_id")
    .eq("staff_id", created.id);
  if (!links?.length) fail("Связь не сохранилась");
  ok("Связь сохранена в БД");

  const { data: updated, error: updateError } = await clientA
    .from("staff")
    .update({ name: `${testName} (изм.)`, is_active: false })
    .eq("id", created.id)
    .select()
    .single();
  if (updateError) fail(`Редактирование: ${updateError.message}`);
  if (updated.is_active !== false) fail("is_active не изменился");
  ok("Редактирование и отключение работают");

  if (emailB) {
    const clientB = await signIn(emailB);
    const { data: leaked } = await clientB.from("staff").select("id").eq("id", created.id).maybeSingle();
    if (leaked) fail("Утечка: пользователь B видит сотрудника организации A");

    const { data: leakedLink } = await clientB
      .from("staff_services")
      .select("staff_id")
      .eq("staff_id", created.id)
      .maybeSingle();
    if (leakedLink) fail("Утечка: пользователь B видит связь staff_services организации A");
    ok("Изоляция между организациями работает");
  } else {
    console.log("[SKIP] TEST_EMAIL_B не задан — тест изоляции пропущен");
  }

  const { error: deleteError } = await clientA.from("staff").delete().eq("id", created.id);
  if (deleteError) fail(`Удаление: ${deleteError.message}`);
  ok("Удаление работает");

  console.log("\nВсе тесты пройдены.");
}

main().catch((error) => {
  console.error("[error]", error);
  process.exit(1);
});
