/**
 * Тесты ручной оплаты Kaspi (миграция 011).
 * Требует: 011 применена, SUPABASE_*, TEST_EMAIL, TEST_PASSWORD
 */

const path = require("path");
const dotenv = require("dotenv");
const request = require("supertest");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });
process.env.BOOKLY_DISABLE_BOOKING_RATE_LIMIT = "1";
process.env.BOOKLY_DISABLE_BILLING_RATE_LIMIT = "1";

const app = require("../server/app");

const url = String(process.env.SUPABASE_URL || "").trim();
const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
const serviceKey = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ""
).trim();
const email = String(process.env.TEST_EMAIL || "").trim();
const password = String(process.env.TEST_PASSWORD || "").trim();

function fail(msg) {
  throw new Error(msg);
}

function ok(msg) {
  console.log("[OK]", msg);
}

function getAdminClient() {
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
  const { data, error } = await client.auth.signInWithPassword({
    email: userEmail,
    password: userPassword,
  });
  if (error) fail(`Вход (${userEmail}): ${error.message}`);
  return data.session.access_token;
}

async function createEphemeralUser(admin, label) {
  const stamp = `${Date.now()}-${label}`;
  const userEmail = `bookly-billing-${label}-${stamp}@example.com`;
  const userPassword = `Test-${stamp}-Pw!`;
  const { data, error } = await admin.auth.admin.createUser({
    email: userEmail,
    password: userPassword,
    email_confirm: true,
  });
  if (error) fail(error.message);
  return { id: data.user.id, email: userEmail, password: userPassword };
}

function daysBetween(a, b) {
  return (new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24);
}

async function assertNoError(result, label) {
  if (result?.error) fail(`Не удалось ${label}: ${result.error.message}`);
  return result;
}

async function readSubscription(admin, organizationId, columns, label) {
  const { data, error } = await admin
    .from("organization_subscriptions")
    .select(columns)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) {
    fail(`Не удалось прочитать подписку ${label}: ${error?.message || "нет строки"}`);
  }
  return data;
}

async function main() {
  if (!url || !anonKey || !serviceKey || !email || !password) {
    fail("Задайте SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, TEST_EMAIL, TEST_PASSWORD");
  }

  const admin = getAdminClient();
  const ownerToken = await signIn(email, password);

  const ownerClient = getAnonClient();
  await ownerClient.auth.signInWithPassword({ email, password });
  const ownerUserId = (await ownerClient.auth.getUser()).data.user.id;

  const { data: ownerMembership } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", ownerUserId)
    .limit(1)
    .maybeSingle();
  if (!ownerMembership?.organization_id) fail("Нет организации у TEST_EMAIL");
  const mainOrgId = ownerMembership.organization_id;

  const ephemeral = await createEphemeralUser(admin, "billing");
  const ephemeralToken = await signIn(ephemeral.email, ephemeral.password);
  const ephemeralClient = getAnonClient();
  await ephemeralClient.auth.signInWithPassword({
    email: ephemeral.email,
    password: ephemeral.password,
  });
  const { data: ephemeralOrg } = await ephemeralClient.rpc("create_organization", {
    p_name: `Billing Test ${Date.now()}`,
    p_business_type: "other",
    p_timezone: "Asia/Almaty",
  });
  const testOrgId = ephemeralOrg.id;

  const cleanup = {
    requestIds: [],
    auditIds: [],
    restoreSub: null,
    staffUserId: null,
  };

  const { data: originalSub } = await admin
    .from("organization_subscriptions")
    .select("*")
    .eq("organization_id", testOrgId)
    .maybeSingle();
  cleanup.restoreSub = originalSub;

  try {
    // 20-22 security basics
    const anonRes = await request(app).get("/api/billing/payment-requests");
    if (anonRes.status !== 401) fail("anon должен получить 401 на billing API");
    ok("22. anon не видит billing API без JWT");

    const adminAnon = await request(app).get("/api/admin/overview");
    if (adminAnon.status !== 401) fail("anon должен получить 401 на admin API");
    ok("1/15. anon не входит в /api/admin");

    const ownerAdmin = await request(app)
      .get("/api/admin/overview")
      .set("Authorization", `Bearer ${ownerToken}`);
    if (ownerAdmin.status !== 403) fail("обычный пользователь должен получить 403 на /api/admin");
    ok("1. обычный пользователь не входит в /api/admin");

    const staffUser = await createEphemeralUser(admin, "staff");
    cleanup.staffUserId = staffUser.id;
    const { error: staffMemberError } = await admin.from("organization_members").insert({
      organization_id: testOrgId,
      user_id: staffUser.id,
      role: "staff",
    });
    if (staffMemberError) fail(`Не удалось добавить staff: ${staffMemberError.message}`);
    const staffToken = await signIn(staffUser.email, staffUser.password);

    const staffInfo = await request(app)
      .get("/api/billing/payment-info")
      .set("Authorization", `Bearer ${staffToken}`);
    if (staffInfo.status !== 403 || staffInfo.body.code !== "OWNER_REQUIRED") {
      fail("staff не должен получать payment-info");
    }
    ok("1a. member не получает payment info");

    const staffCreate = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ payer_name: "Staff Hack", billing_months: 1 });
    if (staffCreate.status !== 403 || staffCreate.body.code !== "OWNER_REQUIRED") {
      fail("staff не должен создавать заявку");
    }
    ok("1b. member не создаёт заявку");

    // 3-7 owner billing flow on ephemeral org
    const createRes = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({
        payer_name: "Тест Отправитель",
        payer_phone: "+77001112233",
        payment_reference: "TEST-REF-001",
        payment_date: new Date().toISOString(),
        customer_note: "Тестовый перевод",
        billing_months: 1,
        organization_id: mainOrgId,
        amount: 1,
        status: "approved",
      });

    if (createRes.status !== 201) fail(`создание заявки: ${createRes.status} ${createRes.body?.message}`);
    cleanup.requestIds.push(createRes.body.request.id);
    if (createRes.body.request.amount !== 6990) fail(`amount должен быть 6990, получено ${createRes.body.request.amount}`);
    ok("4. organization_id из body игнорируется (заявка для своей org)");

    const dupRes = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ payer_name: "Дубликат", billing_months: 1 });
    if (dupRes.status !== 409 || dupRes.body.code !== "PAYMENT_REQUEST_ALREADY_PENDING") {
      fail("должен быть 409 PAYMENT_REQUEST_ALREADY_PENDING");
    }
    ok("6. нельзя создать две pending-заявки");

    await assertNoError(
      await admin.from("manual_payment_requests").delete().eq("organization_id", testOrgId),
      "очистить заявки перед race"
    );
    const [raceA, raceB] = await Promise.all([
      request(app)
        .post("/api/billing/payment-requests")
        .set("Authorization", `Bearer ${ephemeralToken}`)
        .send({ payer_name: "Race A", billing_months: 1 }),
      request(app)
        .post("/api/billing/payment-requests")
        .set("Authorization", `Bearer ${ephemeralToken}`)
        .send({ payer_name: "Race B", billing_months: 1 }),
    ]);
    const raceStatuses = [raceA.status, raceB.status].sort();
    if (!(raceStatuses.includes(201) && raceStatuses.includes(409))) {
      fail(`parallel race: ожидались 201 и 409, получено ${raceA.status}/${raceB.status}`);
    }
    const raceCreated = raceA.status === 201 ? raceA.body.request : raceB.body.request;
    cleanup.requestIds.push(raceCreated.id);
    const { data: racePending, error: racePendingError } = await admin
      .from("manual_payment_requests")
      .select("id")
      .eq("organization_id", testOrgId)
      .eq("status", "pending");
    if (racePendingError) fail(`Не удалось прочитать pending после race: ${racePendingError.message}`);
    if ((racePending || []).length !== 1) fail("parallel race: должна остаться одна pending");
    ok("4-5. parallel POST → одна pending, второй 409");

    const recreatePending = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({
        payer_name: "Тест Отправитель",
        payer_phone: "+77001112233",
        payment_reference: "TEST-REF-001",
        payment_date: new Date().toISOString(),
        customer_note: "Тестовый перевод",
        billing_months: 1,
      });
    if (recreatePending.status === 409) {
      // pending from race still active
    } else if (recreatePending.status === 201) {
      cleanup.requestIds.push(recreatePending.body.request.id);
    }
    const { data: pendingNow, error: pendingNowError } = await admin
      .from("manual_payment_requests")
      .select("id")
      .eq("organization_id", testOrgId)
      .eq("status", "pending")
      .maybeSingle();
    if (pendingNowError || !pendingNow?.id) {
      fail(`Нет pending заявки для дальнейших тестов: ${pendingNowError?.message || "нет строки"}`);
    }
    let created = { id: pendingNow.id, amount: 6990 };
    ok("3. owner может создавать заявку");
    ok("5. amount определяется сервером (6990)");

    const ownerList = await request(app)
      .get("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`);
    if (ownerList.status !== 200) fail("owner list failed");
    const onlyOwn = (ownerList.body.requests || []).every((r) => r.id === created.id);
    if (!onlyOwn || ownerList.body.requests.length < 1) fail("owner должен видеть свои заявки");
    ok("7. owner видит только свои заявки");

    // Grant ephemeral user as platform admin temporarily for approve tests
    await assertNoError(
      await admin.from("platform_admins").upsert({ user_id: ephemeral.id, role: "admin" }),
      "выдать platform admin"
    );

    const adminList = await request(app)
      .get("/api/admin/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`);
    if (adminList.status !== 200) fail("admin list failed");
    ok("2/8. platform admin входит и видит заявки");

    await assertNoError(
      await admin.from("manual_payment_requests").delete().eq("organization_id", testOrgId),
      "очистить заявки перед mismatch"
    );

    const mismatchReq = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ payer_name: "Mismatch", billing_months: 1 });
    if (mismatchReq.status !== 201) fail("mismatch setup failed");
    cleanup.requestIds.push(mismatchReq.body.request.id);
    await assertNoError(
      await admin
        .from("manual_payment_requests")
        .update({ amount: 1 })
        .eq("id", mismatchReq.body.request.id),
      "подменить amount заявки"
    );
    const mismatchApprove = await request(app)
      .post(`/api/admin/payment-requests/${mismatchReq.body.request.id}/approve`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({});
    if (mismatchApprove.status !== 409 || mismatchApprove.body.code !== "PAYMENT_AMOUNT_MISMATCH") {
      fail("tampered amount должен дать PAYMENT_AMOUNT_MISMATCH");
    }
    ok("6. изменённая сумма даёт PAYMENT_AMOUNT_MISMATCH");

    const trialEnds = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    await assertNoError(
      await admin
        .from("organization_subscriptions")
        .update({ status: "trialing", trial_ends_at: trialEnds, current_period_end: null })
        .eq("organization_id", testOrgId),
      "подготовить trialing"
    );
    await assertNoError(
      await admin.from("manual_payment_requests").delete().eq("organization_id", testOrgId),
      "очистить заявки перед trial pay"
    );
    const trialReq = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ payer_name: "Trial Pay", billing_months: 1 });
    if (trialReq.status !== 201) fail("trial payment request failed");
    cleanup.requestIds.push(trialReq.body.request.id);
    const trialApprove = await request(app)
      .post(`/api/admin/payment-requests/${trialReq.body.request.id}/approve`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({});
    if (trialApprove.status !== 200) fail("trial approve failed");
    const trialSub = await readSubscription(
      admin,
      testOrgId,
      "current_period_start, current_period_end",
      "после trial approve"
    );
    const expectedTrialEnd = new Date(trialEnds).getTime() + 30 * 24 * 60 * 60 * 1000;
    const actualEnd = new Date(trialSub.current_period_end).getTime();
    if (Math.abs(actualEnd - expectedTrialEnd) > 5000) {
      fail("ранняя оплата должна сохранять остаток trial (+30 дней от trial_ends_at)");
    }
    ok("10. ранняя оплата сохраняет остаток trial");

    // suspended + status_before_suspension=trialing: оплата/extend не сжигают trial
    const suspendedTrialEnds = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    await assertNoError(
      await admin
        .from("organization_subscriptions")
        .update({
          status: "suspended",
          status_before_suspension: "trialing",
          trial_ends_at: suspendedTrialEnds,
          current_period_end: null,
          suspended_at: new Date().toISOString(),
          suspension_reason: "test suspended trialing",
        })
        .eq("organization_id", testOrgId),
      "подготовить suspended+trialing"
    );
    await assertNoError(
      await admin.from("manual_payment_requests").delete().eq("organization_id", testOrgId),
      "очистить заявки перед suspended-trialing"
    );
    const suspendedTrialReq = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ payer_name: "Suspended Trial Pay", billing_months: 1 });
    if (suspendedTrialReq.status !== 201) fail("suspended-trialing payment request failed");
    cleanup.requestIds.push(suspendedTrialReq.body.request.id);
    const suspendedTrialApprove = await request(app)
      .post(`/api/admin/payment-requests/${suspendedTrialReq.body.request.id}/approve`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({});
    if (suspendedTrialApprove.status !== 200) fail("suspended-trialing approve failed");
    const suspendedTrialSub = await readSubscription(
      admin,
      testOrgId,
      "status, current_period_start, current_period_end",
      "после suspended-trialing approve"
    );
    if (suspendedTrialSub.status !== "suspended") {
      fail("approve suspended-trialing не должен разблокировать");
    }
    const expectedSuspendedTrialEnd =
      new Date(suspendedTrialEnds).getTime() + 30 * 24 * 60 * 60 * 1000;
    const actualSuspendedTrialEnd = new Date(suspendedTrialSub.current_period_end).getTime();
    if (Math.abs(actualSuspendedTrialEnd - expectedSuspendedTrialEnd) > 5000) {
      fail("оплата suspended+trialing должна давать period_end ≈ trial_ends_at + 30 дней");
    }
    const startDiffSuspendedTrial = Math.abs(
      new Date(suspendedTrialSub.current_period_start).getTime() -
        new Date(suspendedTrialEnds).getTime()
    );
    if (startDiffSuspendedTrial > 5000) {
      fail("оплата suspended+trialing должна ставить period_start ≈ trial_ends_at");
    }
    ok("10b. оплата suspended+trialing сохраняет остаток trial");

    const beforeSuspendedTrialExtend = suspendedTrialSub.current_period_end;
    const suspendedTrialExtend = await request(app)
      .post(`/api/admin/organizations/${testOrgId}/extend`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ days: 7, reason: "Suspended trialing extend" });
    if (suspendedTrialExtend.status !== 200) fail("suspended-trialing extend failed");
    if (suspendedTrialExtend.body.subscription?.status !== "suspended") {
      fail("extend suspended-trialing не должен разблокировать");
    }
    const afterSuspendedTrialExtend = await readSubscription(
      admin,
      testOrgId,
      "current_period_start, current_period_end, status",
      "после suspended-trialing extend"
    );
    const extendStartDiff = Math.abs(
      new Date(afterSuspendedTrialExtend.current_period_start).getTime() -
        new Date(beforeSuspendedTrialExtend).getTime()
    );
    if (extendStartDiff > 5000) {
      fail("extend должен ставить current_period_start = базе периода (v_base)");
    }
    const expectedExtendEnd =
      new Date(beforeSuspendedTrialExtend).getTime() + 7 * 24 * 60 * 60 * 1000;
    if (
      Math.abs(new Date(afterSuspendedTrialExtend.current_period_end).getTime() - expectedExtendEnd) >
      5000
    ) {
      fail("extend должен продлить от текущего period_end");
    }
    ok("10c. extend ставит current_period_start = v_base");

    await assertNoError(
      await admin.from("manual_payment_requests").delete().eq("organization_id", testOrgId),
      "очистить заявки перед expired flow"
    );
    const { data: pendingNow2, error: pendingNow2Error } = await admin
      .from("manual_payment_requests")
      .select("id")
      .eq("organization_id", testOrgId)
      .eq("status", "pending")
      .maybeSingle();
    if (pendingNow2Error) fail(`Не удалось проверить pending: ${pendingNow2Error.message}`);
    if (!pendingNow2?.id) {
      const freshPending = await request(app)
        .post("/api/billing/payment-requests")
        .set("Authorization", `Bearer ${ephemeralToken}`)
        .send({ payer_name: "Expired flow", billing_months: 1 });
      if (freshPending.status !== 201) fail("fresh pending failed");
      created = { id: freshPending.body.request.id };
      cleanup.requestIds.push(created.id);
    } else {
      created = { id: pendingNow2.id };
    }

    await assertNoError(
      await admin
        .from("organization_subscriptions")
        .update({
          status: "expired",
          current_period_start: null,
          current_period_end: null,
          status_before_suspension: null,
          suspended_at: null,
          suspended_by_user_id: null,
          suspension_reason: null,
        })
        .eq("organization_id", testOrgId),
      "подготовить expired"
    );

    const approveRes = await request(app)
      .post(`/api/admin/payment-requests/${created.id}/approve`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ admin_note: "Тест подтверждения" });
    if (approveRes.status !== 200) fail(`approve: ${approveRes.status} ${approveRes.body?.message}`);

    const afterApprove = await readSubscription(
      admin,
      testOrgId,
      "status, current_period_start, current_period_end, payment_provider, last_payment_status",
      "после approve"
    );

    if (afterApprove.status !== "active") fail("после approve status должен быть active");
    if (afterApprove.payment_provider !== "manual_kaspi") fail("payment_provider должен быть manual_kaspi");
    ok("9. approve переводит подписку в active");

    const periodDays = daysBetween(afterApprove.current_period_end, afterApprove.current_period_start);
    if (periodDays < 29.5 || periodDays > 30.5) fail(`ожидалось ~30 дней, получено ${periodDays}`);
    ok("10. approve продлевает на 30 дней");
    ok("12. expired подписка продлевается от now()");

    const periodEndBeforeSecond = afterApprove.current_period_end;

    const secondApprove = await request(app)
      .post(`/api/admin/payment-requests/${created.id}/approve`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({});
    if (secondApprove.status !== 409) fail("повторный approve должен вернуть 409");
    ok("13. повторный approve не продлевает второй раз");

    const afterSecond = await readSubscription(
      admin,
      testOrgId,
      "current_period_end",
      "после повторного approve"
    );
    if (String(afterSecond.current_period_end) !== String(periodEndBeforeSecond)) {
      fail("повторный approve изменил current_period_end");
    }

    // active extension from current_period_end
    await assertNoError(
      await admin.from("manual_payment_requests").delete().eq("organization_id", testOrgId),
      "очистить заявки перед active extend"
    );
    const activeReqRes = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ payer_name: "Активное продление", billing_months: 1 });
    if (activeReqRes.status !== 201) fail("не удалось создать вторую заявку");
    const activeReqId = activeReqRes.body.request.id;
    cleanup.requestIds.push(activeReqId);

    const beforeActiveExtend = await readSubscription(
      admin,
      testOrgId,
      "current_period_end",
      "перед active extend"
    );

    const approveActive = await request(app)
      .post(`/api/admin/payment-requests/${activeReqId}/approve`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({});
    if (approveActive.status !== 200) fail("approve active extend failed");

    const afterActiveExtend = await readSubscription(
      admin,
      testOrgId,
      "current_period_start, current_period_end",
      "после active extend"
    );

    const startDiff = Math.abs(
      new Date(afterActiveExtend.current_period_start).getTime() -
        new Date(beforeActiveExtend.current_period_end).getTime()
    );
    if (startDiff > 5000) fail("active подписка должна продлеваться от current_period_end");
    ok("11. active подписка продлевается от current_period_end");

    // reject flow
    await assertNoError(
      await admin.from("manual_payment_requests").delete().eq("organization_id", testOrgId),
      "очистить заявки перед reject"
    );
    const rejectReqRes = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ payer_name: "На отклонение", billing_months: 1 });
    if (rejectReqRes.status !== 201) fail("reject request create failed");
    const rejectReqId = rejectReqRes.body.request.id;
    cleanup.requestIds.push(rejectReqId);
    const subBeforeReject = await readSubscription(
      admin,
      testOrgId,
      "status, current_period_end",
      "перед reject"
    );

    const rejectRes = await request(app)
      .post(`/api/admin/payment-requests/${rejectReqId}/reject`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ admin_note: "Тестовый отказ" });
    if (rejectRes.status !== 200) fail("reject failed");

    const subAfterReject = await readSubscription(
      admin,
      testOrgId,
      "status, current_period_end",
      "после reject"
    );
    if (
      subAfterReject.status !== subBeforeReject.status ||
      String(subAfterReject.current_period_end) !== String(subBeforeReject.current_period_end)
    ) {
      fail("reject изменил подписку");
    }
    ok("14. reject не изменяет подписку");

    const ownerRejectAttempt = await request(app)
      .post(`/api/admin/payment-requests/${rejectReqId}/reject`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ admin_note: "hack" });
    if (ownerRejectAttempt.status !== 403) fail("не-admin не должен reject");
    ok("15. не-admin не может approve/reject");

    const { data: auditRows, error: auditRowsError } = await admin
      .from("platform_admin_audit_log")
      .select("action")
      .eq("organization_id", testOrgId);
    if (auditRowsError) fail(`Не удалось прочитать audit: ${auditRowsError.message}`);
    const actions = new Set((auditRows || []).map((r) => r.action));
    if (!actions.has("PAYMENT_APPROVED") || !actions.has("SUBSCRIPTION_EXTENDED") || !actions.has("PAYMENT_REJECTED")) {
      fail("audit log неполный");
    }
    ok("16. audit log создаётся");

    // extend / suspend / unsuspend
    const extendRes = await request(app)
      .post(`/api/admin/organizations/${testOrgId}/extend`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ days: 7, reason: "Подарочные дни" });
    if (extendRes.status !== 200) fail("extend failed");
    ok("17. extend работает");

    const suspendRes = await request(app)
      .post(`/api/admin/organizations/${testOrgId}/suspend`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ reason: "Тест suspend" });
    if (suspendRes.status !== 200 || suspendRes.body.subscription?.status !== "suspended") {
      fail("suspend failed");
    }

    const suspendedSub = await readSubscription(admin, testOrgId, "status", "после suspend");
    if (suspendedSub.status !== "suspended") fail("suspend не установил статус");

    // Try insert service while suspended via admin direct update trigger path - use RPC access
    const { data: suspendedAccess, error: suspendedAccessError } = await admin.rpc(
      "get_subscription_access_internal",
      {
        p_organization_id: testOrgId,
      }
    );
    if (suspendedAccessError) {
      fail(`Не удалось проверить доступ suspended: ${suspendedAccessError.message}`);
    }
    const accessRow = Array.isArray(suspendedAccess) ? suspendedAccess[0] : suspendedAccess;
    if (accessRow?.allowed) fail("suspend должен блокировать доступ");
    ok("18. suspend блокирует бизнес-операции");

    await assertNoError(
      await admin.from("manual_payment_requests").delete().eq("organization_id", testOrgId),
      "очистить заявки перед suspended approve"
    );
    const suspendedPending = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ payer_name: "Suspended Pay", billing_months: 1 });
    if (suspendedPending.status !== 201) fail("suspended pending failed");
    cleanup.requestIds.push(suspendedPending.body.request.id);
    const periodBeforeSuspendedApprove = await readSubscription(
      admin,
      testOrgId,
      "current_period_end, suspended_at, suspension_reason",
      "перед suspended approve"
    );

    const suspendedApprove = await request(app)
      .post(`/api/admin/payment-requests/${suspendedPending.body.request.id}/approve`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({});
    if (suspendedApprove.status !== 200) fail("suspended approve failed");

    const afterSuspendedApprove = await readSubscription(
      admin,
      testOrgId,
      "status, status_before_suspension, current_period_end, suspended_at, suspension_reason",
      "после suspended approve"
    );
    if (afterSuspendedApprove.status !== "suspended") fail("approve suspended не должен разблокировать");
    if (afterSuspendedApprove.status_before_suspension !== "active") {
      fail("status_before_suspension должен быть active после оплаты");
    }
    if (
      new Date(afterSuspendedApprove.current_period_end) <=
      new Date(periodBeforeSuspendedApprove.current_period_end)
    ) {
      fail("approve suspended должен продлить период");
    }
    ok("7. approve suspended не разблокирует, но продлевает период");

    const suspendedExtend = await request(app)
      .post(`/api/admin/organizations/${testOrgId}/extend`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ days: 3, reason: "Suspended extend" });
    if (suspendedExtend.status !== 200) fail("suspended extend failed");
    if (suspendedExtend.body.subscription?.status !== "suspended") {
      fail("extend suspended не должен разблокировать");
    }
    ok("8. extend suspended не разблокирует");

    const unsuspendRes = await request(app)
      .post(`/api/admin/organizations/${testOrgId}/unsuspend`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({});
    if (unsuspendRes.status !== 200) fail("unsuspend failed");
    const afterUnsuspend = await readSubscription(admin, testOrgId, "status", "после unsuspend");
    if (afterUnsuspend.status !== "active") fail("unsuspend после оплаты должен восстановить active");
    ok("9. unsuspend после оплаты восстанавливает active");
    ok("19. unsuspend восстанавливает корректный статус");

    // client cannot update request status directly
    const { error: directUpdateError } = await ephemeralClient
      .from("manual_payment_requests")
      .update({ status: "approved" })
      .eq("id", rejectReqId);
    if (!directUpdateError) fail("client не должен обновлять manual_payment_requests");
    ok("20. client не может сам изменить payment request status");

    const { data: directRequests, error: directSelectError } = await ephemeralClient
      .from("manual_payment_requests")
      .select("id");
    if (!directSelectError && (directRequests || []).length > 0) {
      fail("client не должен читать manual_payment_requests напрямую");
    }
    ok("22. client/anon не видит заявки напрямую");

    const paymentInfo = await request(app)
      .get("/api/billing/payment-info")
      .set("Authorization", `Bearer ${ephemeralToken}`);
    if (paymentInfo.status !== 200) fail("payment-info failed");
    if (!paymentInfo.body.kaspi) fail("payment-info должен возвращать kaspi");
    ok("3. owner может создать заявку для своей организации (flow OK)");

    // 21. amount по billing_months
    await assertNoError(
      await admin.from("manual_payment_requests").delete().eq("organization_id", testOrgId),
      "очистить заявки перед multi-month"
    );
    const multiMonthRes = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ payer_name: "Два месяца", billing_months: 2, amount: 100 });
    if (multiMonthRes.status !== 201) fail("multi-month create failed");
    if (multiMonthRes.body.request.amount !== 13980) {
      fail(`billing_months=2 должен дать 13980, получено ${multiMonthRes.body.request.amount}`);
    }
    cleanup.requestIds.push(multiMonthRes.body.request.id);
    ok("21. client не может подменить amount (сервер считает price × months)");

    const cancelRes = await request(app)
      .post(`/api/billing/payment-requests/${multiMonthRes.body.request.id}/cancel`)
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({});
    if (cancelRes.status !== 200 || cancelRes.body.request?.status !== "canceled") {
      fail("cancel pending failed");
    }
    ok("owner может отменить pending-заявку");

    const staffCancel = await request(app)
      .post(`/api/billing/payment-requests/${multiMonthRes.body.request.id}/cancel`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({});
    if (staffCancel.status !== 403 || staffCancel.body.code !== "OWNER_REQUIRED") {
      fail("staff не должен отменять заявку");
    }
    ok("1c. member не отменяет заявку");

    for (const [label, payload] of [
      ["0", { payer_name: "Bad Months", billing_months: 0 }],
      ["abc", { payer_name: "Bad Months", billing_months: "abc" }],
      ["1.5", { payer_name: "Bad Months", billing_months: 1.5 }],
      ["13", { payer_name: "Bad Months", billing_months: 13 }],
    ]) {
      const badMonths = await request(app)
        .post("/api/billing/payment-requests")
        .set("Authorization", `Bearer ${ephemeralToken}`)
        .send(payload);
      if (badMonths.status !== 400 || badMonths.body.code !== "VALIDATION_ERROR") {
        fail(`billing_months=${label} должен дать 400 VALIDATION_ERROR`);
      }
    }
    ok("billing_months: 0/abc/1.5/13 → VALIDATION_ERROR");

    await assertNoError(
      await admin.from("manual_payment_requests").delete().eq("organization_id", testOrgId),
      "очистить заявки перед default months"
    );
    const defaultMonths = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ payer_name: "Default Months" });
    if (defaultMonths.status !== 201) fail("отсутствие billing_months должно default=1");
    if (defaultMonths.body.request?.billing_months !== 1) {
      fail("без billing_months сервер должен поставить 1");
    }
    cleanup.requestIds.push(defaultMonths.body.request.id);
    ok("billing_months: отсутствует → default 1");

    const historyReq = await request(app)
      .post("/api/billing/payment-requests")
      .set("Authorization", `Bearer ${ephemeralToken}`)
      .send({ payer_name: "History", billing_months: 1 });
    if (historyReq.status === 409) {
      // pending уже есть после defaultMonths
    } else if (historyReq.status === 201) {
      cleanup.requestIds.push(historyReq.body.request.id);
    } else {
      fail(`history request failed: ${historyReq.status}`);
    }

    const { data: auditBeforeDelete, error: auditBeforeError } = await admin
      .from("platform_admin_audit_log")
      .select("id, admin_user_id")
      .eq("admin_user_id", ephemeral.id);
    if (auditBeforeError) fail(`audit lookup failed: ${auditBeforeError.code || auditBeforeError.message}`);
    if (!auditBeforeDelete?.length) fail("ожидались audit-записи тестового platform admin");
    for (const row of auditBeforeDelete) {
      cleanup.auditIds.push(row.id);
    }
    const sampleAuditId = auditBeforeDelete[0].id;

    await assertNoError(
      await admin.from("platform_admins").delete().eq("user_id", ephemeral.id),
      "удалить platform admin перед deleteUser"
    );
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(ephemeral.id);
    if (deleteUserError) fail(`deleteUser failed: ${deleteUserError.message}`);

    const { data: historyRow, error: historyError } = await admin
      .from("manual_payment_requests")
      .select("id, requested_by_user_id")
      .eq("organization_id", testOrgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (historyError || !historyRow) fail("payment history должна сохраниться после удаления user");
    if (historyRow.requested_by_user_id !== null) {
      fail("requested_by_user_id должен стать NULL после удаления user");
    }
    ok("13. удаление user не удаляет payment history");

    const { data: auditAfterDelete, error: auditAfterError } = await admin
      .from("platform_admin_audit_log")
      .select("id, admin_user_id")
      .eq("id", sampleAuditId)
      .maybeSingle();
    if (auditAfterError || !auditAfterDelete) {
      fail("audit-запись должна сохраниться после удаления platform admin user");
    }
    if (auditAfterDelete.admin_user_id !== null) {
      fail("admin_user_id должен стать NULL после удаления user");
    }
    ok("13b. удаление user не удаляет audit, admin_user_id = null");
    ephemeral.id = null;

    const anonClient = getAnonClient();
    const { data: auditDirect, error: auditDirectError } = await anonClient
      .from("platform_admin_audit_log")
      .select("id")
      .limit(1);
    if (!auditDirectError && auditDirect?.length > 0) {
      fail("anon не должен читать platform_admin_audit_log");
    }
    ok("22. anon не видит audit log напрямую");

    console.log("\n[done] test:manual-billing — все проверки пройдены");
  } finally {
    const cleanupErrors = [];

    async function cleanupStep(label, promise) {
      const { error } = await promise;
      if (error) cleanupErrors.push(`${label}:${error.code || error.message}`);
    }

    if (cleanup.requestIds.length) {
      await cleanupStep(
        "requests-by-id",
        admin.from("manual_payment_requests").delete().in("id", cleanup.requestIds)
      );
    }
    await cleanupStep(
      "requests-by-org",
      admin.from("manual_payment_requests").delete().eq("organization_id", testOrgId)
    );

    if (cleanup.auditIds.length) {
      await cleanupStep(
        "audit-by-id",
        admin.from("platform_admin_audit_log").delete().in("id", cleanup.auditIds)
      );
    }
    await cleanupStep(
      "audit-by-org",
      admin.from("platform_admin_audit_log").delete().eq("organization_id", testOrgId)
    );

    if (ephemeral?.id) {
      await cleanupStep(
        "platform-admins",
        admin.from("platform_admins").delete().eq("user_id", ephemeral.id)
      );
    }

    if (cleanup.staffUserId) {
      await cleanupStep(
        "staff-membership",
        admin.from("organization_members").delete().eq("user_id", cleanup.staffUserId)
      );
      try {
        await admin.auth.admin.deleteUser(cleanup.staffUserId);
      } catch {
        /* user may already be deleted */
      }
    }

    await cleanupStep(
      "subscriptions",
      admin.from("organization_subscriptions").delete().eq("organization_id", testOrgId)
    );
    await cleanupStep(
      "members",
      admin.from("organization_members").delete().eq("organization_id", testOrgId)
    );
    await cleanupStep("organizations", admin.from("organizations").delete().eq("id", testOrgId));

    if (ephemeral?.id) {
      try {
        await admin.auth.admin.deleteUser(ephemeral.id);
      } catch {
        /* user may already be deleted in FK test */
      }
    }

    if (cleanupErrors.length) {
      console.error("[cleanup]", cleanupErrors.join("; "));
    }
  }
}

main().catch((error) => {
  console.error("[FAIL]", error.message);
  process.exitCode = 1;
});
