/**
 * Интеграционный тест бронирований
 * Требует миграции 001–005
 */

const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const url = String(process.env.SUPABASE_URL || "").trim();
const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
const email = String(process.env.TEST_EMAIL || "").trim();
const password = String(process.env.TEST_PASSWORD || "").trim();

function fail(msg) {
  console.error("[FAIL]", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[OK]", msg);
}

async function main() {
  if (!url || !anonKey || !email || !password) fail("Задайте SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD");

  const probe = createClient(url, anonKey);
  const { error: probeErr } = await probe.from("bookings").select("id").limit(1);
  if (probeErr?.code === "PGRST205") fail("Таблица bookings не найдена. Выполните 005_bookings.sql");
  ok("Таблица bookings доступна");

  const sb = createClient(url, anonKey);
  const { error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr) fail(authErr.message);

  const { data: membership } = await sb.from("organization_members").select("organization_id").limit(1).maybeSingle();
  if (!membership?.organization_id) fail("Нет организации");
  const orgId = membership.organization_id;

  const { data: service } = await sb
    .from("services")
    .insert({ organization_id: orgId, name: `Услуга тест ${Date.now()}`, price: 1000, duration_minutes: 30, is_active: true })
    .select("id")
    .single();
  if (!service) fail("Не удалось создать услугу");

  const { data: staff } = await sb
    .from("staff")
    .insert({ organization_id: orgId, name: `Мастер ${Date.now()}`, is_active: true })
    .select("id")
    .single();
  if (!staff) fail("Не удалось создать сотрудника");

  await sb.from("staff_services").insert({
    organization_id: orgId,
    staff_id: staff.id,
    service_id: service.id,
  });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().slice(0, 10);

  const { data: booking, error: createErr } = await sb
    .from("bookings")
    .insert({
      organization_id: orgId,
      service_id: service.id,
      staff_id: staff.id,
      client_name: "Тест Клиент",
      client_phone: "+77001234567",
      booking_date: dateStr,
      start_time: "10:00",
      end_time: "10:00",
      status: "confirmed",
      source: "manual",
    })
    .select()
    .single();

  if (createErr) fail(`Создание: ${createErr.message}`);
  if (!String(booking.end_time).startsWith("10:30")) fail(`end_time должен быть 10:30, получено ${booking.end_time}`);
  ok("Создание и расчёт end_time работают");

  const { error: conflictErr } = await sb.from("bookings").insert({
    organization_id: orgId,
    service_id: service.id,
    staff_id: staff.id,
    client_name: "Конфликт",
    client_phone: "+77007654321",
    booking_date: dateStr,
    start_time: "10:15",
    end_time: "10:15",
    status: "confirmed",
    source: "manual",
  });
  if (!conflictErr || !(
    conflictErr.message.includes("BOOKING_TIME_CONFLICT") ||
    conflictErr.message.includes("bookings_no_active_overlap") ||
    conflictErr.message.toLowerCase().includes("exclusion constraint")
  )) {
    fail("Конфликт времени не заблокирован");
  }
  ok("Конфликт двух записей заблокирован");

  await sb.from("bookings").delete().eq("id", booking.id);
  await sb.from("staff").delete().eq("id", staff.id);
  await sb.from("services").delete().eq("id", service.id);

  console.log("\nВсе тесты пройдены.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
