/**
 * Тесты platform admin API.
 * Требует: 011 применена, SUPABASE_*, TEST_EMAIL, TEST_PASSWORD
 */

const dotenv = require("dotenv");
const request = require("supertest");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: require("path").join(__dirname, "..", ".env"), override: true });

const app = require("../server/app");

const url = String(process.env.SUPABASE_URL || "").trim();
const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
const serviceKey = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ""
).trim();
const email = String(process.env.TEST_EMAIL || "").trim();
const password = String(process.env.TEST_PASSWORD || "").trim();

function fail(msg) {
  console.error("[FAIL]", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[OK]", msg);
}

async function signIn(userEmail, userPassword) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: userEmail,
    password: userPassword,
  });
  if (error) fail(error.message);
  return data.session.access_token;
}

async function main() {
  if (!url || !anonKey || !serviceKey || !email || !password) {
    fail("Задайте SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, TEST_EMAIL, TEST_PASSWORD");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ownerClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await ownerClient.auth.signInWithPassword({ email, password });
  const ownerUserId = (await ownerClient.auth.getUser()).data.user.id;

  let granted = false;
  let filterOrgId = null;
  let filterOrgRestore = null;

  try {
    const before = await request(app)
      .get("/api/admin/me")
      .set("Authorization", `Bearer ${await signIn(email, password)}`);
    if (before.status !== 403) fail("без grant owner не должен быть admin");

    await admin.from("platform_admins").upsert({ user_id: ownerUserId, role: "owner" });
    granted = true;

    const token = await signIn(email, password);
    const me = await request(app).get("/api/admin/me").set("Authorization", `Bearer ${token}`);
    if (me.status !== 200 || me.body.admin?.role !== "owner") fail("/api/admin/me failed");
    ok("platform admin /me");

    const overview = await request(app)
      .get("/api/admin/overview")
      .set("Authorization", `Bearer ${token}`);
    if (overview.status !== 200 || !overview.body.overview) fail("/api/admin/overview failed");
    if (typeof overview.body.overview.organizations_total !== "number") {
      fail("overview должен возвращать числовую статистику");
    }
    ok("11. overview возвращает статистику (не пустой объект без ошибки)");

    const orgs = await request(app)
      .get("/api/admin/organizations?limit=5")
      .set("Authorization", `Bearer ${token}`);
    if (orgs.status !== 200 || !Array.isArray(orgs.body.items)) fail("/api/admin/organizations failed");
    ok("platform admin organizations list");

    const activeOnly = await request(app)
      .get("/api/admin/organizations?subscription_status=active&limit=100")
      .set("Authorization", `Bearer ${token}`);
    if (activeOnly.status !== 200) fail("filter active failed");
    for (const item of activeOnly.body.items || []) {
      if (item.subscription_status !== "active") {
        fail(`filter active вернул ${item.subscription_status} для org ${item.id}`);
      }
    }
    ok("11a. фильтр active возвращает только active");

    const expiredOnly = await request(app)
      .get("/api/admin/organizations?subscription_status=expired&limit=100")
      .set("Authorization", `Bearer ${token}`);
    if (expiredOnly.status !== 200) fail("filter expired failed");
    for (const item of expiredOnly.body.items || []) {
      if (item.subscription_status !== "expired") {
        fail(`filter expired вернул ${item.subscription_status} для org ${item.id}`);
      }
    }
    ok("11b. фильтр expired возвращает только expired");

    const stamp = Date.now();
    const filterUserEmail = `bookly-admin-filter-${stamp}@example.com`;
    const { data: filterUserData, error: filterUserError } = await admin.auth.admin.createUser({
      email: filterUserEmail,
      password: `Test-${stamp}-Pw!`,
      email_confirm: true,
    });
    if (filterUserError) fail(filterUserError.message);
    const filterClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await filterClient.auth.signInWithPassword({
      email: filterUserEmail,
      password: `Test-${stamp}-Pw!`,
    });
    const { data: filterOrg } = await filterClient.rpc("create_organization", {
      p_name: `Filter Org ${stamp}`,
      p_business_type: "other",
      p_timezone: "Asia/Almaty",
    });
    filterOrgId = filterOrg.id;
    const { data: filterSub } = await admin
      .from("organization_subscriptions")
      .select("*")
      .eq("organization_id", filterOrgId)
      .maybeSingle();
    filterOrgRestore = filterSub;
    await admin
      .from("organization_subscriptions")
      .update({ status: "expired", current_period_end: null })
      .eq("organization_id", filterOrgId);

    const expiredFilter = await request(app)
      .get("/api/admin/organizations?subscription_status=expired&search=Filter Org")
      .set("Authorization", `Bearer ${token}`);
    const foundExpired = (expiredFilter.body.items || []).some((item) => item.id === filterOrgId);
    if (!foundExpired) fail("созданная expired org должна попадать в фильтр expired");

    const activeFilter = await request(app)
      .get("/api/admin/organizations?subscription_status=active&search=Filter Org")
      .set("Authorization", `Bearer ${token}`);
    const foundActive = (activeFilter.body.items || []).some((item) => item.id === filterOrgId);
    if (foundActive) fail("expired org не должна попадать в фильтр active");
    ok("11c. фильтр subscription_status точный на тестовой org");

    if (orgs.body.items.length) {
      const detail = await request(app)
        .get(`/api/admin/organizations/${orgs.body.items[0].id}`)
        .set("Authorization", `Bearer ${token}`);
      if (detail.status !== 200 || !detail.body.organization) fail("/api/admin/organizations/:id failed");
      ok("platform admin organization detail");
    }

    const payments = await request(app)
      .get("/api/admin/payment-requests?limit=5")
      .set("Authorization", `Bearer ${token}`);
    if (payments.status !== 200 || !Array.isArray(payments.body.items)) fail("/api/admin/payment-requests failed");
    ok("platform admin payment requests");

    console.log("\n[done] test:platform-admin успешно");
  } finally {
    if (granted) {
      await admin.from("platform_admins").delete().eq("user_id", ownerUserId);
    }
    if (filterOrgId) {
      await admin.from("manual_payment_requests").delete().eq("organization_id", filterOrgId);
      if (filterOrgRestore) {
        await admin.from("organization_subscriptions").delete().eq("organization_id", filterOrgId);
      } else {
        await admin.from("organization_subscriptions").delete().eq("organization_id", filterOrgId);
      }
      await admin.from("organization_members").delete().eq("organization_id", filterOrgId);
      await admin.from("organizations").delete().eq("id", filterOrgId);
    }
  }
}

main().catch((error) => fail(error.message));
