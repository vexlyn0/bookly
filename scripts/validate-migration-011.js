/**
 * Валидация миграции 011 (статика + опционально runtime после применения).
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const databaseUrl = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
const migrationPath = path.join(__dirname, "..", "supabase", "migrations", "011_manual_billing_admin.sql");

function fail(msg) {
  console.error("[FAIL]", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[OK]", msg);
}

function staticValidate(sql) {
  if (sql.includes("payment_method_required")) {
    fail("Миграция 011 не должна содержать payment_method_required");
  }

  const requiredFragments = [
    ["manual_payment_requests", "таблица manual_payment_requests"],
    ["platform_admins", "таблица platform_admins"],
    ["platform_admin_audit_log", "таблица platform_admin_audit_log"],
    ["_require_owner_organization_id", "owner-only billing helper"],
    ["OWNER_REQUIRED", "OWNER_REQUIRED в billing RPC"],
    ["_subscription_period_base", "расчёт базы периода с trial"],
    ["PAYMENT_AMOUNT_MISMATCH", "проверка суммы при approve"],
    ["unique_violation", "обработка гонки pending"],
    ["get stacked diagnostics", "GET STACKED DIAGNOSTICS для constraint"],
    ["PAYMENT_REQUEST_ALREADY_PENDING", "маппинг pending race"],
    ["billing_create_manual_payment_request", "billing_create RPC"],
    ["billing_cancel_manual_payment_request", "billing_cancel RPC"],
    ["admin_approve_manual_payment", "admin_approve RPC"],
    ["admin_reject_manual_payment", "admin_reject RPC"],
    ["admin_extend_subscription", "admin_extend RPC"],
    ["idx_manual_payment_requests_one_pending_per_org", "partial unique index"],
    ["on delete set null", "ON DELETE SET NULL для audit/payment history"],
    ["organization_subscriptions_suspended_by_user_id_fkey", "FK suspended_by_user_id"],
    ["for update", "FOR UPDATE в атомарных функциях"],
    ["current_period_start = v_base", "extend использует v_base как period start"],
  ];

  for (const [fragment, label] of requiredFragments) {
    if (!sql.toLowerCase().includes(fragment.toLowerCase())) fail(`Нет ${label}`);
  }

  if (!/status_before_suspension[\s\S]{0,80}'active'/.test(sql)) {
    fail("approve/extend должны сохранять suspended и status_before_suspension=active");
  }

  if (!/status_before_suspension\s*=\s*'trialing'/.test(sql)) {
    fail("_subscription_period_base должен учитывать suspended+trialing");
  }

  if (!/v_constraint_name\s*=\s*'idx_manual_payment_requests_one_pending_per_org'/.test(sql)) {
    fail("unique_violation должен фильтроваться по имени pending-индекса");
  }

  if (sql.includes("coalesce(v_sub.current_period_start, now())")) {
    fail("admin_extend не должен использовать coalesce(current_period_start, now())");
  }

  if (sql.includes("_get_user_organization_id")) {
    fail("Устаревший _get_user_organization_id не должен использоваться");
  }

  if (!sql.includes("service_role must EXECUTE")) {
    fail("Safety-check должен требовать EXECUTE для service_role");
  }

  if (!sql.includes("anon must not SELECT") && !sql.includes("% must not SELECT")) {
    fail("Safety-check должен запрещать SELECT anon/authenticated");
  }

  ok("Статическая проверка файла миграции 011");
}

function staticValidateJs() {
  const billingPath = path.join(__dirname, "..", "server", "lib", "billing-service.js");
  const adminPath = path.join(__dirname, "..", "server", "lib", "platform-admin-service.js");
  const billing = fs.readFileSync(billingPath, "utf8");
  const adminSvc = fs.readFileSync(adminPath, "utf8");

  const billingChecks = [
    ["requireOwnerOrganizationId", "owner-only guard на сервере"],
    ["OWNER_REQUIRED", "маппинг OWNER_REQUIRED"],
    ["PAYMENT_REQUEST_ALREADY_PENDING", "маппинг pending race"],
    ["idx_manual_payment_requests_one_pending_per_org", "маппинг имени индекса"],
    ["error?.details", "проверка details в mapRpcError"],
    ["error?.hint", "проверка hint в mapRpcError"],
    ["parseBillingMonths", "строгая валидация billing_months"],
    ["unexpected unique_violation", "прочие 23505 → INTERNAL_ERROR"],
  ];
  for (const [fragment, label] of billingChecks) {
    if (!billing.includes(fragment)) fail(`billing-service.js: нет ${label}`);
  }

  if (/code === ["']23505["'][\s\S]{0,120}PAYMENT_REQUEST_ALREADY_PENDING/.test(billing)) {
    fail("billing-service.js не должен маппить любой 23505 в PAYMENT_REQUEST_ALREADY_PENDING");
  }

  const adminChecks = [
    ["function assertSupabaseResult", "assertSupabaseResult helper"],
    ["function sanitizeSubscription", "sanitizeSubscription helper"],
    ["getOverview:organizations", "assert в getOverview"],
    ["getOrganizationStats", "getOrganizationStats"],
    ["getOrganizationDetail", "getOrganizationDetail"],
    ["isPlatformAdminUser", "isPlatformAdminUser с assert"],
    ["PAYMENT_AMOUNT_MISMATCH", "маппинг PAYMENT_AMOUNT_MISMATCH"],
    ["organization_subscriptions!inner", "inner join для фильтра status"],
  ];
  for (const [fragment, label] of adminChecks) {
    if (!adminSvc.includes(fragment)) fail(`platform-admin-service.js: нет ${label}`);
  }

  ok("Статическая проверка billing/admin JS");
}

async function runtimeValidate(client) {
  const tables = ["platform_admins", "manual_payment_requests", "platform_admin_audit_log"];
  for (const table of tables) {
    const { rows } = await client.query(`select to_regclass($1) as reg`, [`public.${table}`]);
    if (!rows[0]?.reg) {
      console.log("[SKIP] Миграция 011 не применена — runtime-проверки пропущены");
      return;
    }
  }

  const { rows: authSelect } = await client.query(`
    select role_name, tablename
    from (
      select role_name, tablename
      from (values ('anon'), ('authenticated')) r(role_name)
      cross join (values
        ('platform_admins'),
        ('manual_payment_requests'),
        ('platform_admin_audit_log')
      ) t(tablename)
    ) x
    where has_table_privilege(role_name, 'public.' || tablename, 'SELECT')
  `);
  if (authSelect.length) {
    fail(
      `anon/authenticated имеют SELECT: ${authSelect
        .map((r) => `${r.role_name}.${r.tablename}`)
        .join(", ")}`
    );
  }
  ok("anon/authenticated не читают admin/billing таблицы");

  const { rows: fkRows } = await client.query(`
    select
      conrelid::regclass::text as table_name,
      a.attname as column_name,
      confdeltype
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and (
        (
          conrelid::regclass::text = 'public.manual_payment_requests'
          and a.attname in ('requested_by_user_id', 'reviewed_by_user_id')
        )
        or (
          conrelid::regclass::text = 'public.platform_admin_audit_log'
          and a.attname = 'admin_user_id'
        )
        or (
          conrelid::regclass::text = 'public.organization_subscriptions'
          and a.attname = 'suspended_by_user_id'
        )
      )
  `);

  const requiredFkPairs = [
    "public.manual_payment_requests.requested_by_user_id",
    "public.manual_payment_requests.reviewed_by_user_id",
    "public.platform_admin_audit_log.admin_user_id",
    "public.organization_subscriptions.suspended_by_user_id",
  ];
  const foundFk = new Set(fkRows.map((row) => `${row.table_name}.${row.column_name}`));
  for (const pair of requiredFkPairs) {
    if (!foundFk.has(pair)) {
      fail(`FK отсутствует: ${pair}`);
    }
  }
  for (const row of fkRows) {
    if (row.confdeltype !== "n") {
      fail(`${row.table_name}.${row.column_name} должен быть ON DELETE SET NULL`);
    }
  }
  ok("FK payment/audit/suspended_by используют ON DELETE SET NULL");

  const adminFns = [
    "billing_create_manual_payment_request(uuid, text, text, text, timestamptz, text, integer)",
    "billing_cancel_manual_payment_request(uuid, uuid)",
    "admin_approve_manual_payment(uuid, uuid, text)",
    "admin_reject_manual_payment(uuid, uuid, text)",
    "admin_extend_subscription(uuid, uuid, integer, text)",
    "admin_suspend_organization(uuid, uuid, text)",
    "admin_unsuspend_organization(uuid, uuid)",
  ];

  for (const fn of adminFns) {
    for (const role of ["public", "anon", "authenticated"]) {
      const { rows } = await client.query(
        `select has_function_privilege($1, $2, 'EXECUTE') as allowed`,
        [role, `public.${fn}`]
      );
      if (rows[0]?.allowed) fail(`${role} не должен EXECUTE ${fn}`);
    }
    const { rows: serviceRows } = await client.query(
      `select has_function_privilege('service_role', $1, 'EXECUTE') as allowed`,
      [`public.${fn}`]
    );
    if (!serviceRows[0]?.allowed) fail(`service_role должен EXECUTE ${fn}`);
  }
  ok("billing/admin RPC: только service_role имеет EXECUTE");

  const { rows: fnSrc } = await client.query(`
    select pg_get_functiondef(p.oid) as src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'billing_create_manual_payment_request'
    limit 1
  `);
  if (!fnSrc.length || !fnSrc[0].src.includes("role = 'owner'")) {
    fail("billing_create_manual_payment_request должен требовать owner role");
  }
  if (!fnSrc[0].src.toLowerCase().includes("get stacked diagnostics")) {
    fail("billing_create должен использовать GET STACKED DIAGNOSTICS");
  }
  if (!fnSrc[0].src.includes("idx_manual_payment_requests_one_pending_per_org")) {
    fail("unique_violation должен проверять имя pending-индекса");
  }
  ok("billing RPC требует owner role и точный pending race mapping");

  const { rows: periodBaseSrc } = await client.query(`
    select pg_get_functiondef(p.oid) as src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_subscription_period_base'
    limit 1
  `);
  if (!periodBaseSrc[0]?.src.includes("status_before_suspension = 'trialing'")) {
    fail("_subscription_period_base должен учитывать suspended+trialing");
  }
  ok("_subscription_period_base сохраняет trial для suspended");

  const { rows: extendSrc } = await client.query(`
    select pg_get_functiondef(p.oid) as src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_extend_subscription'
    limit 1
  `);
  if (!extendSrc[0]?.src.includes("current_period_start = v_base")) {
    fail("admin_extend_subscription должен ставить current_period_start = v_base");
  }
  ok("admin_extend использует v_base как начало периода");

  const { rows: approveSrc } = await client.query(`
    select pg_get_functiondef(p.oid) as src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_approve_manual_payment'
    limit 1
  `);
  const approveBody = approveSrc[0]?.src || "";
  if (!approveBody.includes("PAYMENT_AMOUNT_MISMATCH")) {
    fail("admin_approve_manual_payment должен проверять amount/currency");
  }
  if (!approveBody.includes("v_is_suspended")) {
    fail("admin_approve_manual_payment должен учитывать suspended");
  }
  ok("approve проверяет сумму и не снимает suspended");

  console.log(
    "[skip] Идемпотентность миграции не проверяется обычным валидатором (read-only; без повторного APPLY SQL)"
  );
}

async function main() {
  if (!fs.existsSync(migrationPath)) fail("Файл 011_manual_billing_admin.sql не найден");
  const sql = fs.readFileSync(migrationPath, "utf8");
  staticValidate(sql);
  staticValidateJs();

  if (!databaseUrl) {
    console.log("\n[skip] DATABASE_URL не задан — runtime-проверки пропущены");
    console.log("[done] validate:migration-011 (статика) успешно");
    return;
  }

  const { Client } = require("pg");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await runtimeValidate(client);
    console.log("\n[done] validate:migration-011 успешно");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  fail(error.message);
});
