/**
 * Валидация миграции 010 после ручного применения в Supabase.
 * Требует: DATABASE_URL (или SUPABASE_DB_URL)
 *
 * Ограничение: не применяет миграцию, только проверяет состояние БД.
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const databaseUrl = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
const migrationPath = path.join(__dirname, "..", "supabase", "migrations", "010_subscriptions.sql");

function fail(msg) {
  console.error("[FAIL]", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[OK]", msg);
}

async function main() {
  if (!databaseUrl) {
    fail("Задайте DATABASE_URL для проверки миграции 010");
  }

  if (!fs.existsSync(migrationPath)) {
    fail("Файл миграции 010 не найден");
  }

  const { Client } = require("pg");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const { rows: planRows } = await client.query(`
      select code, name, price_amount, currency, billing_interval, trial_days, is_active
      from public.subscription_plans
      where code = 'pro'
    `);
    if (planRows.length !== 1) {
      fail(`Тариф "pro" должен существовать ровно один раз, найдено: ${planRows.length}`);
    }
    const plan = planRows[0];
    if (Number(plan.price_amount) !== 6990) fail(`price_amount ожидался 6990, получено ${plan.price_amount}`);
    if (plan.currency !== "KZT") fail(`currency ожидался KZT, получено ${plan.currency}`);
    if (plan.billing_interval !== "month") fail(`billing_interval ожидался month, получено ${plan.billing_interval}`);
    if (Number(plan.trial_days) !== 14) fail(`trial_days ожидался 14, получено ${plan.trial_days}`);
    if (plan.is_active !== true) fail("Тариф pro должен быть is_active = true");
    ok('Тариф "pro" создан один раз: 6990 KZT / month, trial 14 дней, is_active');

    const { rows: orgsWithoutSub } = await client.query(`
      select o.id
      from public.organizations o
      left join public.organization_subscriptions os on os.organization_id = o.id
      where os.id is null
      limit 5
    `);
    if (orgsWithoutSub.length) {
      fail(`Есть организации без подписки: ${orgsWithoutSub.map((r) => r.id).join(", ")}`);
    }
    ok("Все организации имеют подписку (backfill применён)");

    const { rows: dupSub } = await client.query(`
      select organization_id, count(*)::int as cnt
      from public.organization_subscriptions
      group by organization_id
      having count(*) > 1
    `);
    if (dupSub.length) {
      fail(`Дубли подписок для организаций: ${dupSub.map((r) => r.organization_id).join(", ")}`);
    }
    ok("Не более одной подписки на организацию");

    const { rows: statusRows } = await client.query(`
      select distinct status from public.organization_subscriptions
    `);
    const allowedStatuses = new Set(["trialing", "active", "past_due", "canceled", "expired", "suspended"]);
    const badStatuses = statusRows.map((r) => r.status).filter((s) => !allowedStatuses.has(s));
    if (badStatuses.length) {
      fail(`Недопустимые статусы подписки: ${badStatuses.join(", ")}`);
    }
    ok("Все статусы подписок в допустимом множестве");

    const { rows: anonPolicies } = await client.query(`
      select tablename, policyname
      from pg_policies
      where schemaname = 'public'
        and tablename in ('organization_subscriptions', 'subscription_trial_claims', 'subscription_plans')
        and ('anon' = any (roles) or 'public' = any (roles))
    `);
    if (anonPolicies.length) {
      fail(`Найдены anon/public-политики: ${anonPolicies.map((r) => `${r.tablename}.${r.policyname}`).join(", ")}`);
    }
    ok("Нет anon/public-политик на таблицах подписок");

    const { rows: orgSubSelect } = await client.query(`
      select has_table_privilege('authenticated', 'public.organization_subscriptions', 'SELECT') as auth_select
    `);
    if (orgSubSelect[0]?.auth_select) {
      fail("authenticated не должен иметь прямой SELECT на organization_subscriptions");
    }
    ok("authenticated не имеет прямого SELECT organization_subscriptions");

    const { rows: orgSubPolicies } = await client.query(`
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'organization_subscriptions'
    `);
    if (orgSubPolicies.length > 0) {
      fail(
        `organization_subscriptions не должна иметь RLS-политик (браузер читает только через RPC): ${orgSubPolicies
          .map((r) => r.policyname)
          .join(", ")}`
      );
    }
    ok("organization_subscriptions без RLS-политик (доступ только через RPC)");

    const { rows: createOrgGrants } = await client.query(`
      select
        has_function_privilege('anon', 'public.create_organization(text, public.organization_business_type, text)', 'EXECUTE') as anon_exec,
        has_function_privilege('public', 'public.create_organization(text, public.organization_business_type, text)', 'EXECUTE') as public_exec,
        has_function_privilege('authenticated', 'public.create_organization(text, public.organization_business_type, text)', 'EXECUTE') as auth_exec
    `);
    const cog = createOrgGrants[0];
    if (cog.anon_exec || cog.public_exec) {
      fail("create_organization не должна быть доступна anon/public");
    }
    if (!cog.auth_exec) {
      fail("authenticated должен иметь EXECUTE на create_organization");
    }
    ok("create_organization доступна только authenticated");

    const { rows: createOrgDef } = await client.query(`
      select pg_get_functiondef('public.create_organization(text, public.organization_business_type, text)'::regprocedure) as def
    `);
    const createOrgSrc = String(createOrgDef[0]?.def || "");
    // После 015 (freemium) create_organization не выдаёт trial: claim создаётся только
    // в billing_start_pro_trial. Если claim в функции есть — он обязан быть атомарным.
    if (/subscription_trial_claims/i.test(createOrgSrc) && !/on conflict \(user_id\) do nothing/i.test(createOrgSrc)) {
      fail("create_organization должна использовать атомарный INSERT claim ON CONFLICT (user_id) DO NOTHING");
    }
    if (!/SUBSCRIPTION_PLAN_NOT_FOUND/i.test(createOrgSrc)) {
      fail("create_organization должна отклонять создание при отсутствии активного плана pro");
    }
    ok("create_organization: атомарный claim ON CONFLICT и проверка SUBSCRIPTION_PLAN_NOT_FOUND");

    const { rows: grants } = await client.query(`
      select
        has_function_privilege('anon', 'public.get_organization_subscription_access(uuid)', 'EXECUTE') as anon_access,
        has_function_privilege('authenticated', 'public.get_organization_subscription_access(uuid)', 'EXECUTE') as auth_access,
        has_function_privilege('service_role', 'public.get_organization_subscription_access(uuid)', 'EXECUTE') as service_access,
        has_function_privilege('anon', 'public.organization_has_subscription_access(uuid)', 'EXECUTE') as anon_bool,
        has_function_privilege('authenticated', 'public.organization_has_subscription_access(uuid)', 'EXECUTE') as auth_bool,
        has_function_privilege('service_role', 'public.organization_has_subscription_access(uuid)', 'EXECUTE') as service_bool
    `);
    const g = grants[0];
    if (g.anon_access || g.anon_bool) {
      fail("anon не должен иметь EXECUTE на функциях доступа к подписке");
    }
    if (!g.auth_access || !g.auth_bool) {
      fail("authenticated должен иметь EXECUTE на пользовательских функциях доступа к подписке");
    }
    // Пользовательская RPC — только для браузера (authenticated). service_role должен
    // использовать get_subscription_access_internal, а не эту функцию — иначе легко
    // перепутать membership-проверяемый и внутренний пути.
    if (g.service_access || g.service_bool) {
      fail("service_role НЕ должен иметь EXECUTE на пользовательской RPC (get_organization_subscription_access/organization_has_subscription_access)");
    }
    ok("Права на пользовательские функции доступа к подписке корректны (anon запрещён, service_role не смешан с authenticated)");

    const { rows: internalGrants } = await client.query(`
      select
        has_function_privilege('anon', 'public.get_subscription_access_internal(uuid)', 'EXECUTE') as anon_access,
        has_function_privilege('authenticated', 'public.get_subscription_access_internal(uuid)', 'EXECUTE') as auth_access,
        has_function_privilege('service_role', 'public.get_subscription_access_internal(uuid)', 'EXECUTE') as service_access
    `);
    const ig = internalGrants[0];
    if (ig.anon_access || ig.auth_access) {
      fail("get_subscription_access_internal должна быть закрыта от anon и authenticated (используется только внутренне/service_role)");
    }
    if (!ig.service_access) {
      fail("service_role должен иметь EXECUTE на get_subscription_access_internal (сервер использует её для публичной записи)");
    }
    ok("get_subscription_access_internal закрыта от anon/authenticated, доступна только service_role");

    const { rows: internalDef } = await client.query(`
      select pg_get_functiondef('public.get_subscription_access_internal(uuid)'::regprocedure) as def
    `);
    const internalSrc = String(internalDef[0]?.def || "");
    if (/auth\.role\(\)/.test(internalSrc) || /'service_role'/.test(internalSrc)) {
      fail("get_subscription_access_internal не должна содержать ветвление по auth.role()/service_role — она должна быть одинаковой для всех вызывающих");
    }
    ok("get_subscription_access_internal не содержит bypass по роли (service_role не привилегирован)");

    const { rows: publicDef } = await client.query(`
      select pg_get_functiondef('public.get_organization_subscription_access(uuid)'::regprocedure) as def
    `);
    const publicSrc = String(publicDef[0]?.def || "");
    if (!/organization_members/.test(publicSrc) || !/auth\.uid\(\)/.test(publicSrc)) {
      fail("get_organization_subscription_access должна проверять auth.uid() и membership через organization_members");
    }
    ok("get_organization_subscription_access выполняет проверку auth.uid() и membership перед вызовом внутренней функции");

    const providerFieldPattern =
      /provider_customer_id|provider_subscription_id|provider_payment_method_fingerprint|payment_provider|last_payment_status|trial_started_by_user_id/i;
    if (providerFieldPattern.test(publicSrc)) {
      fail("get_organization_subscription_access не должна раскрывать provider/internal поля в определении функции");
    }
    ok("Пользовательская RPC не содержит provider/internal полей в возвращаемом наборе");

    const { rows: triggerDef } = await client.query(`
      select pg_get_functiondef('public.enforce_subscription_access()'::regprocedure) as def
    `);
    const triggerSrc = String(triggerDef[0]?.def || "");
    if (/auth\.role\(\)/.test(triggerSrc) || /'service_role'/.test(triggerSrc)) {
      fail("enforce_subscription_access() не должна содержать bypass по service_role — триггер обязан блокировать любую роль");
    }
    // 015 (freemium): триггер блокирует только приостановленные организации.
    if (!/ORGANIZATION_SUSPENDED/.test(triggerSrc)) {
      fail("enforce_subscription_access() должна блокировать приостановленные организации (ORGANIZATION_SUSPENDED)");
    }
    if (!/ORGANIZATION_ID_IMMUTABLE/.test(triggerSrc)) {
      fail("enforce_subscription_access() должна запрещать изменение organization_id при UPDATE");
    }
    ok("enforce_subscription_access(): нет bypass по service_role, блокирует suspended, organization_id неизменяем");

    const { rows: triggerRows } = await client.query(`
      select c.relname as table_name, t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and not t.tgisinternal
        and t.tgname like '%_enforce_subscription'
        and c.relname in ('services', 'staff', 'staff_services', 'staff_schedules', 'bookings')
    `);
    const expectedTables = ["services", "staff", "staff_services", "staff_schedules", "bookings"];
    const foundTables = new Set(triggerRows.map((r) => r.table_name));
    const missingTables = expectedTables.filter((t) => !foundTables.has(t));
    if (missingTables.length) {
      fail(`Триггер enforce_subscription отсутствует на таблицах: ${missingTables.join(", ")}`);
    }
    ok("Триггеры enforce_subscription установлены на services/staff/staff_services/staff_schedules/bookings");

    const { rows: trialClaimUserUnique } = await client.query(`
      select conname
      from pg_constraint
      where conrelid = 'public.subscription_trial_claims'::regclass
        and contype = 'u'
    `);
    if (trialClaimUserUnique.length < 1) {
      fail("Ожидался unique-constraint на user_id в subscription_trial_claims");
    }
    ok("subscription_trial_claims: unique(user_id) существует");

    const { rows: orgIdNullable } = await client.query(`
      select is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'subscription_trial_claims'
        and column_name = 'organization_id'
    `);
    if (!orgIdNullable.length || orgIdNullable[0].is_nullable !== "YES") {
      fail("subscription_trial_claims.organization_id должен быть nullable");
    }
    ok("subscription_trial_claims.organization_id nullable");

    const { rows: orgFk } = await client.query(`
      select confdeltype
      from pg_constraint
      where conrelid = 'public.subscription_trial_claims'::regclass
        and contype = 'f'
        and confrelid = 'public.organizations'::regclass
    `);
    if (!orgFk.length || orgFk[0].confdeltype !== "n") {
      fail("subscription_trial_claims.organization_id FK должен использовать ON DELETE SET NULL");
    }
    ok("subscription_trial_claims.organization_id FK: ON DELETE SET NULL");

    const { rows: orgPartialIndex } = await client.query(`
      select indexdef
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'subscription_trial_claims'
        and indexname = 'idx_trial_claims_org_unique'
    `);
    if (!orgPartialIndex.length || !/where \(organization_id is not null\)/i.test(orgPartialIndex[0].indexdef)) {
      fail("Partial unique index на organization_id (WHERE organization_id IS NOT NULL) не найден");
    }
    ok("Partial unique index organization_id (WHERE organization_id IS NOT NULL) существует");

    const { rows: fingerprintIndex } = await client.query(`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'subscription_trial_claims'
        and indexname = 'idx_trial_claims_fingerprint_unique'
    `);
    if (!fingerprintIndex.length) {
      fail("Partial unique index на payment_method_fingerprint не найден");
    }
    ok("Partial unique index payment_method_fingerprint существует");

    const { rows: unsafePolicies } = await client.query(`
      select tablename, policyname, qual, roles
      from pg_policies
      where schemaname = 'public'
        and tablename in ('organization_subscriptions', 'subscription_trial_claims', 'subscription_plans')
    `);
    const dangerous = unsafePolicies.filter((p) => {
      const roles = Array.isArray(p.roles) ? p.roles : [];
      const isBroadPolicy = roles.includes("authenticated") || roles.includes("public");
      const qualIsTrivialTrue = String(p.qual || "").trim() === "true";
      return isBroadPolicy && qualIsTrivialTrue;
    });
    if (dangerous.length) {
      fail(
        `Найдены небезопасные policy вида authenticated/public USING (true): ${dangerous
          .map((p) => `${p.tablename}.${p.policyname}`)
          .join(", ")}`
      );
    }
    if (unsafePolicies.some((p) => p.tablename === "subscription_trial_claims")) {
      fail("subscription_trial_claims не должна иметь ни одной policy (таблица полностью закрыта для anon/authenticated)");
    }
    if (unsafePolicies.some((p) => p.tablename === "organization_subscriptions")) {
      fail("organization_subscriptions не должна иметь RLS-политик (браузер читает только через RPC)");
    }
    ok("Нет policy вида authenticated/public USING (true); trial_claims и org_subscriptions без политик");

    console.log("\nВалидация миграции 010 завершена успешно.");
    console.log("Файл для применения (если ещё не применён): supabase/migrations/010_subscriptions.sql");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
