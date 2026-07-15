/**
 * Интеграционный тест рабочих графиков через Supabase API.
 * Требует: 003_staff.sql, 004_work_schedules.sql
 */

const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env"), override: true });

const url = String(process.env.SUPABASE_URL || "").trim();
const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
const email = String(process.env.TEST_EMAIL || "").trim();
const password = String(process.env.TEST_PASSWORD || "").trim();

function fail(message) {
  console.error("[FAIL]", message);
  process.exit(1);
}

function ok(message) {
  console.log("[OK]", message);
}

async function main() {
  if (!url || !anonKey) fail("Задайте SUPABASE_URL и SUPABASE_ANON_KEY");
  if (!email || !password) fail("Задайте TEST_EMAIL и TEST_PASSWORD");

  const probe = createClient(url, anonKey);
  const { error: probeError } = await probe.from("staff_schedules").select("id").limit(1);
  if (probeError?.code === "PGRST205") {
    fail("Таблица staff_schedules не найдена. Выполните 004_work_schedules.sql");
  }
  if (probeError && probeError.code !== "PGRST301") {
    fail(`Проверка таблицы: ${probeError.message}`);
  }
  ok("Таблица staff_schedules доступна");

  const supabase = createClient(url, anonKey);
  const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) fail(`Вход: ${authError.message}`);

  const { data: membership, error: memberError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();
  if (memberError) fail(memberError.message);
  if (!membership?.organization_id) fail("Нет организации");

  const orgId = membership.organization_id;
  const staffName = `График тест ${Date.now()}`;

  const { data: staff, error: staffError } = await supabase
    .from("staff")
    .insert({ organization_id: orgId, name: staffName, is_active: true })
    .select("id")
    .single();
  if (staffError) fail(`Создание сотрудника: ${staffError.message}`);
  ok("Сотрудник создан, триггер должен создать график");

  const { data: schedule, error: scheduleError } = await supabase
    .from("staff_schedules")
    .select("*")
    .eq("staff_id", staff.id)
    .order("day_of_week");
  if (scheduleError) fail(`Чтение графика: ${scheduleError.message}`);
  if (schedule?.length !== 7) fail(`Ожидалось 7 дней, получено ${schedule?.length}`);
  ok("График по умолчанию: 7 дней");

  const monday = schedule.find((row) => row.day_of_week === 0);
  const sunday = schedule.find((row) => row.day_of_week === 6);
  if (!monday?.is_working || !String(monday.start_time).startsWith("09:00")) {
    fail("Понедельник должен быть 09:00–18:00");
  }
  if (sunday?.is_working !== false) fail("Воскресенье должно быть выходным");
  ok("Значения по умолчанию корректны");

  const mondayId = monday.id;
  const { error: updateError } = await supabase
    .from("staff_schedules")
    .update({ start_time: "10:00", end_time: "19:00" })
    .eq("id", mondayId);
  if (updateError) fail(`Редактирование: ${updateError.message}`);
  ok("Редактирование работает");

  const { data: reloaded } = await supabase
    .from("staff_schedules")
    .select("start_time")
    .eq("id", mondayId)
    .single();
  if (!String(reloaded?.start_time).startsWith("10:00")) fail("Изменения не сохранились");
  ok("Сохранение после перезагрузки (симуляция F5)");

  await supabase.from("staff").delete().eq("id", staff.id);
  ok("Очистка тестовых данных");

  console.log("\nВсе тесты пройдены.");
}

main().catch((error) => {
  console.error("[error]", error);
  process.exit(1);
});
