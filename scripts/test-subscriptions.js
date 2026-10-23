/**
 * Тесты системы подписок (миграции 010 + 015 freemium).
 * Модель 015: новая организация стартует на Free (status expired), пробный Pro —
 * по кнопке (billing_start_pro_trial), работу блокирует только suspended.
 * Требует: миграция 010 применена, SUPABASE_URL, SUPABASE_ANON_KEY,
 *          SUPABASE_SERVICE_ROLE_KEY, TEST_EMAIL, TEST_PASSWORD
 * Опционально: DATABASE_URL — для проверки идемпотентности повторного запуска миграции.
 *
 * Скрипт не оставляет организацию TEST_EMAIL в expired/suspended: все временные
 * изменения статуса выполняются только для отдельных эфемерных тестовых организаций
 * и восстанавливаются в finally перед очисткой.
 *
 * SQL-проверки миграции: npm run validate:migration-010
 * После этого теста рекомендуется прогнать: npm run test:public-booking
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const request = require("supertest");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });
process.env.BOOKLY_DISABLE_BOOKING_RATE_LIMIT = "1";

const app = require("../server/app");

const url = String(process.env.SUPABASE_URL || "").trim();
const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
const serviceKey = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ""
).trim();
const email = String(process.env.TEST_EMAIL || "").trim();
const password = String(process.env.TEST_PASSWORD || "").trim();
const databaseUrl = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();

function fail(msg) {
  console.error("[FAIL]", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[OK]", msg);
}

function skip(msg) {
  console.log("[SKIP]", msg);
}

function getAdminClient() {
  if (!serviceKey) fail("Задайте SUPABASE_SERVICE_ROLE_KEY для тестов");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getAnonClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(userEmail, userPassword) {
  const client = getAnonClient();
  const { error } = await client.auth.signInWithPassword({
    email: userEmail,
    password: userPassword,
  });
  if (error) fail(`Вход (${userEmail}): ${error.message}`);
  return client;
}

let ephemeralCounter = 0;

async function createEphemeralUser(admin, label) {
  ephemeralCounter += 1;
  const stamp = `${Date.now()}-${ephemeralCounter}`;
  const userEmail = `bookly-sub-test-${stamp}@example.com`;
  const userPassword = `Test-${stamp}-Pw!`;

  const { data, error } = await admin.auth.admin.createUser({
    email: userEmail,
    password: userPassword,
    email_confirm: true,
  });
  if (error) fail(`Не удалось создать эфемерного пользователя (${label}): ${error.message}`);

  return { id: data.user.id, email: userEmail, password: userPassword };
}

function daysBetween(a, b) {
  return (new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24);
}

async function main() {
  if (!url || !anonKey || !email || !password) {
    fail("Задайте SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD");
  }

  const admin = getAdminClient();

  // ---------------------------------------------------------------------
  // Фикстура: организация TEST_EMAIL
  // ---------------------------------------------------------------------
  const sb = await signIn(email, password);
  const { data: membership } = await sb
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();
  if (!membership?.organization_id) fail("Нет организации у TEST_EMAIL");
  const mainOrgId = membership.organization_id;

  const cleanup = {
    ephemeralUserIds: [],
    orgIds: [],
    serviceIds: [],
    staffIds: [],
    bookingIds: [],
  };

  try {
    // 1-2. Тариф pro создан один раз, цена 6990 KZT
    const { data: plans, error: plansError } = await admin
      .from("subscription_plans")
      .select("code, price_amount, currency, trial_days, is_active")
      .eq("code", "pro");
    if (plansError) fail(plansError.message);
    if (!plans || plans.length !== 1) fail(`Тариф pro должен существовать один раз, найдено ${plans?.length}`);
    if (Number(plans[0].price_amount) !== 6990 || plans[0].currency !== "KZT") {
      fail("Тариф pro должен стоить 6990 KZT");
    }
    ok("1-2. Тариф pro создан один раз, цена 6990 KZT");

    // 6. Существующая организация (TEST_EMAIL) получила подписку
    const { data: mainSub, error: mainSubError } = await admin
      .from("organization_subscriptions")
      .select("*")
      .eq("organization_id", mainOrgId)
      .maybeSingle();
    if (mainSubError) fail(mainSubError.message);
    if (!mainSub) fail("У существующей организации TEST_EMAIL нет подписки");
    ok("6. Существующая организация получила подписку");

    // 7. Повторный запуск миграции не продлевает и не сбрасывает даты
    if (!databaseUrl) {
      skip("7. Идемпотентность повторного запуска — задайте DATABASE_URL");
    } else {
      const { Client } = require("pg");
      const pgClient = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
      await pgClient.connect();
      try {
        const migrationSql = fs.readFileSync(
          path.join(__dirname, "..", "supabase", "migrations", "010_subscriptions.sql"),
          "utf8"
        );
        await pgClient.query(migrationSql);

        const { data: mainSubAfter } = await admin
          .from("organization_subscriptions")
          .select("status, trial_started_at, trial_ends_at, current_period_end")
          .eq("organization_id", mainOrgId)
          .maybeSingle();

        if (
          mainSubAfter.status !== mainSub.status ||
          String(mainSubAfter.trial_started_at) !== String(mainSub.trial_started_at) ||
          String(mainSubAfter.trial_ends_at) !== String(mainSub.trial_ends_at) ||
          String(mainSubAfter.current_period_end) !== String(mainSub.current_period_end)
        ) {
          fail("Повторный запуск миграции изменил существующую подписку");
        }
        ok("7. Повторный запуск миграции не меняет существующие подписки/даты");
      } finally {
        await pgClient.end();
      }
    }

    // -------------------------------------------------------------------
    // 3-5. Trial при создании организации, 14 дней, один trial на user_id
    // -------------------------------------------------------------------
    const trialUser = await createEphemeralUser(admin, "trial");
    cleanup.ephemeralUserIds.push(trialUser.id);
    const trialClient = await signIn(trialUser.email, trialUser.password);

    const { data: org1, error: org1Error } = await trialClient.rpc("create_organization", {
      p_name: "Trial Test Org 1",
      p_business_type: "other",
      p_timezone: "Asia/Almaty",
    });
    if (org1Error) fail(`create_organization (org1): ${org1Error.message}`);
    cleanup.orgIds.push(org1.id);

    if (!org1.subscription || org1.subscription.status !== "expired" || org1.subscription.plan_code !== "free") {
      fail(`Новая организация должна стартовать на Free, получено: ${org1.subscription?.status}`);
    }
    ok("3. Новая организация стартует на Free без автоматического trial");

    const { error: trialStartError } = await admin.rpc("billing_start_pro_trial", {
      p_user_id: trialUser.id,
    });
    if (trialStartError) fail(`billing_start_pro_trial: ${trialStartError.message}`);

    const { data: trialSub, error: trialSubError } = await admin
      .from("organization_subscriptions")
      .select("status, trial_ends_at")
      .eq("organization_id", org1.id)
      .single();
    if (trialSubError) fail(trialSubError.message);
    if (trialSub.status !== "trialing") {
      fail(`4. Пробный Pro по кнопке должен дать trialing, получено: ${trialSub.status}`);
    }
    const tDays = daysBetween(trialSub.trial_ends_at, new Date().toISOString());
    if (tDays < 13.9 || tDays > 14.1) {
      fail(`Пробный Pro должен длиться 14 дней, получено ~${tDays.toFixed(2)}`);
    }
    ok("4. Пробный Pro по кнопке длится 14 дней");

    // Освобождаем membership/subscription org1, чтобы создать вторую организацию
    // тем же user_id (trial claim при этом остаётся).
    await admin.from("organization_subscriptions").delete().eq("organization_id", org1.id);
    await admin.from("organization_members").delete().eq("organization_id", org1.id);

    const { data: org2, error: org2Error } = await trialClient.rpc("create_organization", {
      p_name: "Trial Test Org 2",
      p_business_type: "other",
      p_timezone: "Asia/Almaty",
    });
    if (org2Error) fail(`create_organization (org2): ${org2Error.message}`);
    cleanup.orgIds.push(org2.id);

    const { error: secondTrialError } = await admin.rpc("billing_start_pro_trial", {
      p_user_id: trialUser.id,
    });
    if (!secondTrialError || !String(secondTrialError.message).includes("TRIAL_ALREADY_USED")) {
      fail("5. Второй пробный Pro для того же user_id должен отклоняться (TRIAL_ALREADY_USED)");
    }
    ok("5. Один user_id получает пробный Pro только один раз (TRIAL_ALREADY_USED)");
    ok("5b. Повторный create_organization тем же user_id работает");

    // -------------------------------------------------------------------
    // 8-14, 21. Доступ по статусам подписки (эфемерная тестовая организация)
    // -------------------------------------------------------------------
    const accessUser = await createEphemeralUser(admin, "access");
    cleanup.ephemeralUserIds.push(accessUser.id);
    const accessClient = await signIn(accessUser.email, accessUser.password);

    const { data: accessOrg, error: accessOrgError } = await accessClient.rpc("create_organization", {
      p_name: "Access Test Org",
      p_business_type: "other",
      p_timezone: "Asia/Almaty",
    });
    if (accessOrgError) fail(`create_organization (accessOrg): ${accessOrgError.message}`);
    const accessOrgId = accessOrg.id;
    cleanup.orgIds.push(accessOrgId);

    const accessSlug = `sub-test-access-${Date.now()}`;
    await admin
      .from("organizations")
      .update({ slug: accessSlug, public_booking_enabled: true, booking_confirmation_mode: "auto" })
      .eq("id", accessOrgId);

    // Фикстуры: на Free (без Pro) запись в бизнес-таблицы разрешена.
    const { data: accessService, error: accessServiceError } = await admin
      .from("services")
      .insert({
        organization_id: accessOrgId,
        name: "Access Test Service",
        price: 1000,
        duration_minutes: 30,
        is_active: true,
      })
      .select("id")
      .single();
    if (accessServiceError) fail(accessServiceError.message);
    cleanup.serviceIds.push(accessService.id);

    const { data: accessStaff, error: accessStaffError } = await admin
      .from("staff")
      .insert({ organization_id: accessOrgId, name: "Access Test Staff", is_active: true })
      .select("id")
      .single();
    if (accessStaffError) fail(accessStaffError.message);
    cleanup.staffIds.push(accessStaff.id);

    await admin
      .from("staff_services")
      .insert({ organization_id: accessOrgId, staff_id: accessStaff.id, service_id: accessService.id });

    async function setAccessSubscription(patch) {
      const { error } = await admin
        .from("organization_subscriptions")
        .update(patch)
        .eq("organization_id", accessOrgId);
      if (error) fail(`Не удалось обновить тестовую подписку: ${error.message}`);
    }

    async function getAccess() {
      // service_role больше не имеет EXECUTE на пользовательской RPC (только на
      // get_subscription_access_internal) — это ровно то разделение, которое
      // проверяет данный тест-сьют (см. пункт 2 финального аудита).
      const { data, error } = await admin.rpc("get_subscription_access_internal", {
        p_organization_id: accessOrgId,
      });
      if (error) fail(`get_subscription_access_internal: ${error.message}`);
      return Array.isArray(data) ? data[0] : data;
    }

    // 8. trialing имеет доступ
    await setAccessSubscription({
      status: "trialing",
      trial_started_at: new Date().toISOString(),
      trial_ends_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
    let access = await getAccess();
    if (access.allowed !== true || access.reason !== "TRIAL_ACTIVE") fail("8. trialing должен давать доступ");
    ok("8. trialing имеет доступ (TRIAL_ACTIVE)");

    // 9. active имеет доступ
    await setAccessSubscription({
      status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
    });
    access = await getAccess();
    if (access.allowed !== true || access.reason !== "SUBSCRIPTION_ACTIVE") fail("9. active должен давать доступ");
    ok("9. active имеет доступ (SUBSCRIPTION_ACTIVE)");

    // 10. past_due — доступ только в grace period
    await setAccessSubscription({
      status: "past_due",
      grace_period_ends_at: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
    });
    access = await getAccess();
    if (access.allowed !== true || access.reason !== "GRACE_PERIOD") fail("10a. past_due в grace должен давать доступ");
    await setAccessSubscription({
      grace_period_ends_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    });
    access = await getAccess();
    if (access.allowed !== false || access.reason !== "PAYMENT_PAST_DUE") {
      fail("10b. past_due после grace не должен давать доступ");
    }
    ok("10. past_due: доступ только в grace period");

    // 13. canceled — доступ до current_period_end
    await setAccessSubscription({
      status: "canceled",
      cancel_at_period_end: true,
      canceled_at: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
    });
    access = await getAccess();
    if (access.allowed !== true) fail("13a. canceled до current_period_end должен давать доступ");
    await setAccessSubscription({ current_period_end: new Date(Date.now() - 24 * 3600 * 1000).toISOString() });
    access = await getAccess();
    if (access.allowed !== false) fail("13b. canceled после current_period_end не должен давать доступ");
    ok("13. canceled: доступ до current_period_end, потом закрывается");

    // 12. suspended — доступа нет независимо от дат
    await setAccessSubscription({
      status: "suspended",
      current_period_end: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
    access = await getAccess();
    if (access.allowed !== false || access.reason !== "ORGANIZATION_SUSPENDED") {
      fail("12. suspended не должен давать доступ независимо от дат");
    }
    ok("12. suspended не имеет доступа независимо от дат");

    // 11. expired — доступа нет
    await setAccessSubscription({ status: "expired" });
    access = await getAccess();
    if (access.allowed !== false || access.reason !== "SUBSCRIPTION_EXPIRED") fail("11. expired не должен давать доступ");
    ok("11. expired не имеет доступа");

    // 14. Данные после окончания подписки читаются
    const { data: readableServices, error: readError } = await admin
      .from("services")
      .select("id")
      .eq("organization_id", accessOrgId);
    if (readError) fail(`14. Чтение данных при expired не должно блокироваться: ${readError.message}`);
    if (!readableServices?.some((s) => s.id === accessService.id)) fail("14. Данные организации должны читаться при expired");
    ok("14. Данные организации читаются даже при отсутствии доступа");

    // 15-17. Free (expired, без Pro): работа разрешена — блокирует только suspended (015)
    const { data: freeInsert, error: freeInsertError } = await accessClient
      .from("services")
      .insert({ organization_id: accessOrgId, name: "Allowed On Free", price: 0, duration_minutes: 30 })
      .select("id")
      .single();
    if (freeInsertError) fail(`15. INSERT service на Free должен быть разрешён: ${freeInsertError.message}`);
    cleanup.serviceIds.push(freeInsert.id);
    ok("15. Free: INSERT service разрешён");

    const { error: freeUpdateError } = await accessClient
      .from("staff")
      .update({ position: "Allowed On Free" })
      .eq("id", accessStaff.id);
    if (freeUpdateError) fail(`16. UPDATE staff на Free должен быть разрешён: ${freeUpdateError.message}`);
    ok("16. Free: UPDATE staff разрешён");

    const { data: adminFreeInsert, error: adminFreeInsertError } = await admin
      .from("services")
      .insert({ organization_id: accessOrgId, name: "Allowed On Free (service_role)", price: 0, duration_minutes: 30 })
      .select("id")
      .single();
    if (adminFreeInsertError) fail(`17. INSERT через service_role на Free должен быть разрешён: ${adminFreeInsertError.message}`);
    cleanup.serviceIds.push(adminFreeInsert.id);
    ok("17. Free: INSERT через service_role разрешён");

    // 17c. suspended блокирует UPDATE через service_role.
    await setAccessSubscription({ status: "suspended" });
    const { error: adminUpdateBlockedError } = await admin
      .from("staff")
      .update({ position: "Should Fail (service_role update)" })
      .eq("id", accessStaff.id);
    if (!adminUpdateBlockedError || !String(adminUpdateBlockedError.message).includes("ORGANIZATION_SUSPENDED")) {
      fail("17c. UPDATE staff при suspended должен быть запрещён даже для service_role (ORGANIZATION_SUSPENDED)");
    }
    ok("17c. suspended блокирует UPDATE через service_role (нет bypass)");

    // 17d. UPDATE с подменой organization_id запрещён (перенос строки между
    // организациями через один UPDATE не должен обходить проверку доступа).
    // Выполняется через service_role, который в остальном не ограничен RLS.
    const { error: orgIdSwapError } = await admin
      .from("services")
      .update({ organization_id: mainOrgId })
      .eq("id", accessService.id);
    if (!orgIdSwapError || !String(orgIdSwapError.message).includes("ORGANIZATION_ID_IMMUTABLE")) {
      fail("17d. UPDATE, меняющий organization_id, должен быть запрещён (ORGANIZATION_ID_IMMUTABLE)");
    }
    ok("17d. UPDATE с подменой organization_id запрещён (ORGANIZATION_ID_IMMUTABLE)");

    // 17e. trialing/active разрешают операции даже для обычного authenticated
    // клиента — восстанавливаем доступ и проверяем позитивный сценарий.
    await setAccessSubscription({
      status: "trialing",
      trial_started_at: new Date().toISOString(),
      trial_ends_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
    const { data: trialingInsert, error: trialingInsertError } = await accessClient
      .from("services")
      .insert({ organization_id: accessOrgId, name: "Allowed While Trialing", price: 500, duration_minutes: 15 })
      .select("id")
      .single();
    if (trialingInsertError) fail(`17e. INSERT при trialing должен быть разрешён: ${trialingInsertError.message}`);
    cleanup.serviceIds.push(trialingInsert.id);
    ok("17e. trialing разрешает операции (INSERT service через authenticated)");

    await setAccessSubscription({
      status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
    });
    const { data: activeInsert, error: activeInsertError } = await admin
      .from("services")
      .insert({ organization_id: accessOrgId, name: "Allowed While Active", price: 500, duration_minutes: 15 })
      .select("id")
      .single();
    if (activeInsertError) fail(`17f. INSERT при active должен быть разрешён (service_role): ${activeInsertError.message}`);
    cleanup.serviceIds.push(activeInsert.id);
    ok("17f. active разрешает операции (INSERT service через service_role)");

    // Возвращаем в expired для последующих проверок публичного API (18-19).
    await setAccessSubscription({ status: "expired" });

    // 18. Публичная запись на Free работает (не 402), с подписью Bookly
    const publicFreeRes = await request(app).get(`/api/public/organizations/${accessSlug}`);
    if (publicFreeRes.status !== 200) {
      fail(`18. Публичная запись на Free должна работать, получено ${publicFreeRes.status} ${publicFreeRes.body.code}`);
    }
    if (publicFreeRes.body.organization?.show_branding !== true) {
      fail("18. На Free страница записи должна показывать подпись Bookly");
    }
    ok("18. Публичная запись на Free работает, show_branding = true");

    // 19. Публичная запись при suspended → 403 ORGANIZATION_SUSPENDED
    await setAccessSubscription({ status: "suspended" });
    const publicSuspendedRes = await request(app).get(`/api/public/organizations/${accessSlug}/services`);
    if (publicSuspendedRes.status !== 403 || publicSuspendedRes.body.code !== "ORGANIZATION_SUSPENDED") {
      fail(
        `19. Публичная запись при suspended должна вернуть 403 ORGANIZATION_SUSPENDED, получено ${publicSuspendedRes.status} ${publicSuspendedRes.body.code}`
      );
    }
    ok("19. Публичная запись при suspended → 403 ORGANIZATION_SUSPENDED");

    // Восстанавливаем доступ ДО очистки фикстур — иначе DB-триггер заблокирует
    // и наши собственные DELETE через service role.
    await setAccessSubscription({
      status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });

    // 20. Владелец не может самостоятельно изменить status/даты своей подписки
    const { data: selfUpdateData } = await accessClient
      .from("organization_subscriptions")
      .update({ status: "active", current_period_end: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString() })
      .eq("organization_id", accessOrgId)
      .select();
    if (selfUpdateData && selfUpdateData.length > 0) {
      fail("20. Владелец не должен иметь возможность изменить свою подписку напрямую");
    }
    ok("20. Владелец не может самостоятельно изменить status/даты подписки");

    // 20b. authenticated не может читать organization_subscriptions напрямую
    // (provider IDs и fingerprint не должны попадать в браузер).
    const { data: selfSelectData } = await accessClient
      .from("organization_subscriptions")
      .select("*")
      .eq("organization_id", accessOrgId);
    if (selfSelectData && selfSelectData.length > 0) {
      fail("20b. authenticated не должен иметь прямой SELECT organization_subscriptions");
    }
    ok("20b. authenticated не может SELECT organization_subscriptions напрямую");

    // 20c. Владелец получает безопасные данные только через RPC.
    const { data: safeRpcData, error: safeRpcError } = await accessClient.rpc(
      "get_organization_subscription_access",
      { p_organization_id: accessOrgId }
    );
    if (safeRpcError) {
      fail(`20c. RPC должна работать для своей организации: ${safeRpcError.message}`);
    }
    const safeRow = Array.isArray(safeRpcData) ? safeRpcData[0] : safeRpcData;
    const forbiddenFields = [
      "payment_provider",
      "provider_customer_id",
      "provider_subscription_id",
      "provider_payment_method_fingerprint",
      "last_payment_status",
      "trial_started_by_user_id",
    ];
    for (const field of forbiddenFields) {
      if (safeRow && Object.prototype.hasOwnProperty.call(safeRow, field)) {
        fail(`20c. RPC не должна возвращать поле ${field}`);
      }
    }
    if (!safeRow || typeof safeRow.allowed !== "boolean") {
      fail("20c. RPC должна возвращать безопасный набор полей (allowed, status, ...)");
    }
    ok("20c. authenticated получает безопасный результат только через RPC");

    // 21. Пользователь другой организации не видит чужую подписку
    const { data: foreignSelect } = await trialClient
      .from("organization_subscriptions")
      .select("*")
      .eq("organization_id", accessOrgId);
    if (foreignSelect && foreignSelect.length > 0) {
      fail("21. Пользователь другой организации не должен видеть чужую подписку (SELECT)");
    }
    const { error: foreignRpcError } = await trialClient.rpc("get_organization_subscription_access", {
      p_organization_id: accessOrgId,
    });
    if (!foreignRpcError) {
      fail("21. Пользователь другой организации не должен получать доступ через RPC");
    }
    ok("21. Пользователь другой организации не видит чужую подписку (SELECT и RPC)");

    // 22. anon не видит подписки и trial_claims; не имеет доступа ни к
    // пользовательской, ни к внутренней RPC.
    const anon = getAnonClient();
    const { data: anonSelect } = await anon.from("organization_subscriptions").select("*").limit(5);
    if (anonSelect && anonSelect.length > 0) {
      fail("22. anon не должен видеть строки organization_subscriptions");
    }
    const { data: anonClaimsSelect } = await anon.from("subscription_trial_claims").select("*").limit(5);
    if (anonClaimsSelect && anonClaimsSelect.length > 0) {
      fail("22. anon не должен видеть строки subscription_trial_claims");
    }
    const { error: anonRpcError } = await anon.rpc("get_organization_subscription_access", {
      p_organization_id: accessOrgId,
    });
    if (!anonRpcError) {
      fail("22. anon не должен иметь доступ к RPC get_organization_subscription_access");
    }
    const { error: anonInternalRpcError } = await anon.rpc("get_subscription_access_internal", {
      p_organization_id: accessOrgId,
    });
    if (!anonInternalRpcError) {
      fail("22. anon не должен иметь доступ к RPC get_subscription_access_internal");
    }
    ok("22. anon не видит subscriptions/trial_claims, RPC (публичная и внутренняя) запрещены");

    // -------------------------------------------------------------------
    // 23-25. subscription_trial_claims при удалении организации:
    // claim сохраняется с organization_id = null, удаление организации не
    // блокируется, повторный create_organization для того же user_id не
    // выдаёт второй trial.
    // -------------------------------------------------------------------
    const deletionUser = await createEphemeralUser(admin, "deletion");
    // Не добавляем в cleanup.ephemeralUserIds заранее: сама организация будет
    // удалена в теле теста, а claim-строку явно проверяем и чистим отдельно.
    const deletionClient = await signIn(deletionUser.email, deletionUser.password);

    const { data: deletionOrg, error: deletionOrgError } = await deletionClient.rpc("create_organization", {
      p_name: "Deletion Test Org",
      p_business_type: "other",
      p_timezone: "Asia/Almaty",
    });
    if (deletionOrgError) fail(`create_organization (deletionOrg): ${deletionOrgError.message}`);
    const { error: deletionTrialError } = await admin.rpc("billing_start_pro_trial", {
      p_user_id: deletionUser.id,
    });
    if (deletionTrialError) fail(`23. billing_start_pro_trial: ${deletionTrialError.message}`);

    const { data: claimBefore, error: claimBeforeError } = await admin
      .from("subscription_trial_claims")
      .select("id, organization_id")
      .eq("user_id", deletionUser.id)
      .maybeSingle();
    if (claimBeforeError) fail(claimBeforeError.message);
    if (!claimBefore || claimBefore.organization_id !== deletionOrg.id) {
      fail("23. trial claim должен ссылаться на созданную организацию до её удаления");
    }

    // 23. Удаление организации не блокируется claim-строкой в subscription_trial_claims.
    const { error: deleteOrgError } = await admin.from("organizations").delete().eq("id", deletionOrg.id);
    if (deleteOrgError) {
      fail(`23. Удаление организации не должно блокироваться subscription_trial_claims: ${deleteOrgError.message}`);
    }
    ok("23. Удаление организации не блокируется trial_claim (ON DELETE SET NULL)");

    // 24. После удаления организации claim остаётся, organization_id = null.
    const { data: claimAfter, error: claimAfterError } = await admin
      .from("subscription_trial_claims")
      .select("id, organization_id")
      .eq("user_id", deletionUser.id)
      .maybeSingle();
    if (claimAfterError) fail(claimAfterError.message);
    if (!claimAfter) fail("24. Claim должен сохраниться после удаления организации");
    if (claimAfter.organization_id !== null) {
      fail("24. organization_id в claim должен стать null после удаления организации");
    }
    ok("24. После удаления организации claim сохраняется с organization_id = null");

    // 25. Тот же user_id после удаления организации не получает второй trial.
    const { data: deletionOrg2, error: deletionOrg2Error } = await deletionClient.rpc("create_organization", {
      p_name: "Deletion Test Org 2",
      p_business_type: "other",
      p_timezone: "Asia/Almaty",
    });
    if (deletionOrg2Error) fail(`create_organization (deletionOrg2): ${deletionOrg2Error.message}`);
    cleanup.orgIds.push(deletionOrg2.id);
    cleanup.ephemeralUserIds.push(deletionUser.id);
    const { error: deletionSecondTrialError } = await admin.rpc("billing_start_pro_trial", {
      p_user_id: deletionUser.id,
    });
    if (!deletionSecondTrialError || !String(deletionSecondTrialError.message).includes("TRIAL_ALREADY_USED")) {
      fail("25. После удаления организации тот же user_id не должен получать второй пробный Pro");
    }
    ok("25. Тот же user_id после удаления организации не получает второй trial");

    // -------------------------------------------------------------------
    // 26. Неактивный план pro: create_organization отклоняется, org не создаётся.
    // -------------------------------------------------------------------
    const inactivePlanUser = await createEphemeralUser(admin, "inactive-plan");
    cleanup.ephemeralUserIds.push(inactivePlanUser.id);
    const inactivePlanClient = await signIn(inactivePlanUser.email, inactivePlanUser.password);

    const { error: deactivatePlanError } = await admin
      .from("subscription_plans")
      .update({ is_active: false })
      .eq("code", "pro");
    if (deactivatePlanError) fail(`Не удалось деактивировать план pro: ${deactivatePlanError.message}`);

    try {
      const { data: rejectedOrg, error: rejectedOrgError } = await inactivePlanClient.rpc("create_organization", {
        p_name: "Inactive Plan Test Org",
        p_business_type: "other",
        p_timezone: "Asia/Almaty",
      });
      if (!rejectedOrgError) {
        fail("26. create_organization должна отклоняться при неактивном плане pro");
      }
      if (!String(rejectedOrgError.message).includes("SUBSCRIPTION_PLAN_NOT_FOUND")) {
        fail(`26. Ожидалась SUBSCRIPTION_PLAN_NOT_FOUND, получено: ${rejectedOrgError.message}`);
      }
      if (rejectedOrg) {
        fail("26. При SUBSCRIPTION_PLAN_NOT_FOUND не должен возвращаться JSON организации");
      }

      const { data: rejectedMember } = await admin
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", inactivePlanUser.id)
        .maybeSingle();
      if (rejectedMember?.organization_id) {
        fail("26. membership не должен создаваться при отсутствии активного плана pro");
      }

      const { data: rejectedOrgs } = await admin
        .from("organizations")
        .select("id")
        .eq("name", "Inactive Plan Test Org");
      if (rejectedOrgs && rejectedOrgs.length > 0) {
        fail("26. Организация не должна сохраняться при отсутствии активного плана pro");
      }
      ok("26. Неактивный план pro: create_organization отклоняется, org/membership не создаются");
    } finally {
      const { error: restorePlanError } = await admin
        .from("subscription_plans")
        .update({ is_active: true })
        .eq("code", "pro");
      if (restorePlanError) fail(`Не удалось восстановить is_active плана pro: ${restorePlanError.message}`);
    }

    console.log("\nВсе тесты подписок пройдены.");
    console.log("27. Рекомендуется дополнительно прогнать: npm run test:public-booking");
  } finally {
    // -------------------------------------------------------------------
    // Очистка: организация TEST_EMAIL не остаётся в expired/suspended —
    // мы никогда не меняли её подписку, поэтому восстанавливать нечего.
    // -------------------------------------------------------------------
    if (cleanup.bookingIds.length) {
      await admin.from("bookings").delete().in("id", cleanup.bookingIds);
    }
    if (cleanup.staffIds.length || cleanup.serviceIds.length) {
      // На случай, если доступ тестовой организации остался заблокированным —
      // восстанавливаем его перед удалением фикстур.
      for (const orgId of cleanup.orgIds) {
        await admin
          .from("organization_subscriptions")
          .update({ status: "active", current_period_end: new Date(Date.now() + 24 * 3600 * 1000).toISOString() })
          .eq("organization_id", orgId);
      }
    }
    if (cleanup.staffIds.length) {
      await admin.from("staff_services").delete().in("staff_id", cleanup.staffIds);
      await admin.from("staff").delete().in("id", cleanup.staffIds);
    }
    if (cleanup.serviceIds.length) {
      await admin.from("services").delete().in("id", cleanup.serviceIds);
    }
    if (cleanup.orgIds.length) {
      await admin.from("organization_subscriptions").delete().in("organization_id", cleanup.orgIds);
      await admin.from("organization_members").delete().in("organization_id", cleanup.orgIds);
    }
    if (cleanup.ephemeralUserIds.length) {
      await admin.from("subscription_trial_claims").delete().in("user_id", cleanup.ephemeralUserIds);
    }
    if (cleanup.orgIds.length) {
      await admin.from("organizations").delete().in("id", cleanup.orgIds);
    }
    for (const userId of cleanup.ephemeralUserIds) {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
