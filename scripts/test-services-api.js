/**
 * Интеграционный тест CRUD услуг через Supabase API.
 * Использование:
 *   TEST_EMAIL=... TEST_EMAIL_B=... TEST_PASSWORD=... node scripts/test-services-api.js
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

async function main() {
  if (!url || !anonKey) fail("Задайте SUPABASE_URL и SUPABASE_ANON_KEY в .env");
  if (!emailA || !password) fail("Задайте TEST_EMAIL и TEST_PASSWORD в .env");

  const probe = createClient(url, anonKey);
  const { error: probeError } = await probe.from("services").select("id").limit(1);
  if (probeError?.code === "PGRST205") {
    fail("Таблица services не найдена. Выполните supabase/migrations/002_services.sql в Supabase SQL Editor.");
  }
  if (probeError && probeError.code !== "PGRST301") {
    fail(`Проверка таблицы: ${probeError.message}`);
  }
  ok("Таблица services доступна");

  const clientA = await signIn(emailA);
  const orgA = await getOrgId(clientA);

  const testName = `Тест ${Date.now()}`;
  const { data: created, error: createError } = await clientA
    .from("services")
    .insert({
      organization_id: orgA,
      name: testName,
      description: "Описание теста",
      price: 5000,
      duration_minutes: 30,
      category: "Тест",
      is_active: true,
    })
    .select()
    .single();

  if (createError) fail(`Создание: ${createError.message}`);
  ok(`Создана услуга ${created.id}`);

  const updatedName = `${testName} (изм.)`;
  const { data: updated, error: updateError } = await clientA
    .from("services")
    .update({ name: updatedName, price: 6000 })
    .eq("id", created.id)
    .select()
    .single();
  if (updateError) fail(`Редактирование: ${updateError.message}`);
  if (updated.name !== updatedName) fail("Имя не обновилось");
  ok("Редактирование работает");

  const { data: toggled, error: toggleError } = await clientA
    .from("services")
    .update({ is_active: false })
    .eq("id", created.id)
    .select()
    .single();
  if (toggleError) fail(`Toggle: ${toggleError.message}`);
  if (toggled.is_active !== false) fail("is_active не изменился");
  ok("Отключение работает");

  const { data: relisted, error: listError } = await clientA
    .from("services")
    .select("*")
    .eq("organization_id", orgA)
    .eq("id", created.id)
    .maybeSingle();
  if (listError) fail(`Список: ${listError.message}`);
  if (!relisted) fail("Услуга не найдена после F5-симуляции");
  ok("Данные сохраняются в БД");

  if (emailB) {
    const clientB = await signIn(emailB);
    const { data: leaked, error: leakError } = await clientB
      .from("services")
      .select("id")
      .eq("id", created.id)
      .maybeSingle();
    if (leakError) fail(`Изоляция (запрос B): ${leakError.message}`);
    if (leaked) fail("Утечка: пользователь B видит услугу организации A");
    ok("Изоляция между организациями работает");
  } else {
    console.log("[SKIP] TEST_EMAIL_B не задан — тест изоляции пропущен");
  }

  const { error: deleteError } = await clientA.from("services").delete().eq("id", created.id);
  if (deleteError) fail(`Удаление: ${deleteError.message}`);
  ok("Удаление работает");

  console.log("\nВсе тесты пройдены.");
}

main().catch((error) => {
  console.error("[error]", error);
  process.exit(1);
});
