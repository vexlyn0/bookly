/**
 * Сервис глобальной панели platform admin.
 */

const { getSupabaseAdmin } = require("./supabase-admin");
const { appError } = require("./subscription-service");

function assertSupabaseResult(result, context) {
  if (result?.error) {
    console.error(`[platform-admin] ${context}`, result.error.code || "unknown");
    throw appError("Не удалось выполнить запрос", "INTERNAL_ERROR", 500);
  }
  return result;
}

function mapAdminRpcError(error) {
  const message = String(error?.message || "");
  if (message.includes("ADMIN_REQUIRED")) {
    return appError("Нет прав администратора", "FORBIDDEN", 403);
  }
  if (message.includes("PAYMENT_AMOUNT_MISMATCH")) {
    return appError("Сумма заявки не соответствует тарифу", "PAYMENT_AMOUNT_MISMATCH", 409);
  }
  if (message.includes("NOT_FOUND")) {
    return appError("Не найдено", "NOT_FOUND", 404);
  }
  if (message.includes("INVALID_STATUS")) {
    return appError("Операция недоступна для текущего статуса", "INVALID_STATUS", 400);
  }
  if (message.includes("VALIDATION_ERROR") || message.includes("SUBSCRIPTION_NOT_FOUND")) {
    return appError("Проверьте параметры запроса", "VALIDATION_ERROR", 400);
  }
  return null;
}

async function isPlatformAdminUser(userId) {
  const admin = getSupabaseAdmin();
  const result = assertSupabaseResult(
    await admin.from("platform_admins").select("role").eq("user_id", userId).maybeSingle(),
    "isPlatformAdminUser"
  );
  return Boolean(result.data);
}

async function getOverview() {
  const admin = getSupabaseAdmin();

  const orgCount = assertSupabaseResult(
    await admin.from("organizations").select("id", { count: "exact", head: true }),
    "getOverview:organizations"
  );
  const statusResult = assertSupabaseResult(
    await admin.from("organization_subscriptions").select("status"),
    "getOverview:subscriptions"
  );
  const pendingResult = assertSupabaseResult(
    await admin
      .from("manual_payment_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    "getOverview:pending"
  );
  const approvedResult = assertSupabaseResult(
    await admin.from("manual_payment_requests").select("amount").eq("status", "approved"),
    "getOverview:approved"
  );

  const counts = { trialing: 0, active: 0, expired: 0, suspended: 0 };
  for (const row of statusResult.data || []) {
    if (row.status === "trialing") counts.trialing += 1;
    else if (row.status === "active") counts.active += 1;
    else if (row.status === "expired") counts.expired += 1;
    else if (row.status === "suspended") counts.suspended += 1;
  }

  const approvedPaymentsTotal = (approvedResult.data || []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );

  return {
    organizations_total: orgCount.count || 0,
    subscriptions: counts,
    pending_payment_requests: pendingResult.count || 0,
    approved_payments_total_amount: approvedPaymentsTotal,
    approved_payments_currency: "KZT",
  };
}

async function listOrganizations({ search = "", subscriptionStatus = "", page = 1, limit = 20 } = {}) {
  const admin = getSupabaseAdmin();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safePage = Math.max(1, Number(page) || 1);
  const from = (safePage - 1) * safeLimit;
  const to = from + safeLimit - 1;

  const subEmbed = subscriptionStatus
    ? "organization_subscriptions!inner(status, trial_ends_at, current_period_end)"
    : "organization_subscriptions(status, trial_ends_at, current_period_end)";

  let query = admin
    .from("organizations")
    .select(
      `
      id,
      name,
      public_name,
      slug,
      created_at,
      ${subEmbed},
      organization_members!inner (
        role,
        user_id
      )
    `,
      { count: "exact" }
    )
    .eq("organization_members.role", "owner")
    .order("created_at", { ascending: false })
    .range(from, to);

  const term = String(search || "").trim();
  if (term) {
    const pattern = `%${term}%`;
    query = query.or(`name.ilike.${pattern},public_name.ilike.${pattern},slug.ilike.${pattern}`);
  }

  if (subscriptionStatus) {
    query = query.eq("organization_subscriptions.status", subscriptionStatus);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("[platform-admin] list organizations failed", error.code || "unknown");
    throw appError("Не удалось загрузить организации", "INTERNAL_ERROR", 500);
  }

  const seen = new Set();
  const uniqueRows = (data || []).filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });

  const orgIds = uniqueRows.map((row) => row.id);
  const statsByOrg = await getOrganizationStats(orgIds);

  const items = await Promise.all(
    uniqueRows.map(async (row) => {
      const sub = Array.isArray(row.organization_subscriptions)
        ? row.organization_subscriptions[0]
        : row.organization_subscriptions;
      const ownerMember = Array.isArray(row.organization_members)
        ? row.organization_members.find((m) => m.role === "owner") || row.organization_members[0]
        : row.organization_members;
      const ownerEmail = await getUserEmail(ownerMember?.user_id);

      return {
        id: row.id,
        name: row.name,
        public_name: row.public_name,
        slug: row.slug,
        owner_email: ownerEmail,
        subscription_status: sub?.status || null,
        trial_ends_at: sub?.trial_ends_at || null,
        current_period_end: sub?.current_period_end || null,
        created_at: row.created_at,
        services_count: statsByOrg[row.id]?.services || 0,
        staff_count: statsByOrg[row.id]?.staff || 0,
        bookings_count: statsByOrg[row.id]?.bookings || 0,
      };
    })
  );

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total: count || 0,
  };
}

async function getOrganizationStats(orgIds) {
  const result = {};
  if (!orgIds.length) return result;

  const admin = getSupabaseAdmin();
  const servicesResult = assertSupabaseResult(
    await admin.from("services").select("organization_id").in("organization_id", orgIds),
    "getOrganizationStats:services"
  );
  const staffResult = assertSupabaseResult(
    await admin.from("staff").select("organization_id").in("organization_id", orgIds),
    "getOrganizationStats:staff"
  );
  const bookingsResult = assertSupabaseResult(
    await admin.from("bookings").select("organization_id").in("organization_id", orgIds),
    "getOrganizationStats:bookings"
  );

  for (const id of orgIds) {
    result[id] = { services: 0, staff: 0, bookings: 0 };
  }
  for (const row of servicesResult.data || []) {
    if (result[row.organization_id]) result[row.organization_id].services += 1;
  }
  for (const row of staffResult.data || []) {
    if (result[row.organization_id]) result[row.organization_id].staff += 1;
  }
  for (const row of bookingsResult.data || []) {
    if (result[row.organization_id]) result[row.organization_id].bookings += 1;
  }

  return result;
}

async function getUserEmail(userId) {
  if (!userId) return null;
  const admin = getSupabaseAdmin();
  const result = await admin.auth.admin.getUserById(userId);
  if (result.error) {
    console.error("[platform-admin] getUserEmail", result.error.code || "unknown");
    throw appError("Не удалось выполнить запрос", "INTERNAL_ERROR", 500);
  }
  if (!result.data?.user) return null;
  return result.data.user.email || null;
}

async function getOrganizationDetail(organizationId) {
  const admin = getSupabaseAdmin();

  const orgResult = assertSupabaseResult(
    await admin
      .from("organizations")
      .select("id, name, public_name, slug, phone, address, created_at, updated_at")
      .eq("id", organizationId)
      .maybeSingle(),
    "getOrganizationDetail:org"
  );

  if (!orgResult.data) {
    throw appError("Организация не найдена", "NOT_FOUND", 404);
  }

  const subResult = assertSupabaseResult(
    await admin
      .from("organization_subscriptions")
      .select(
        "status, trial_started_at, trial_ends_at, current_period_start, current_period_end, grace_period_ends_at, cancel_at_period_end, canceled_at, payment_provider, last_payment_status, suspended_at, suspension_reason, status_before_suspension"
      )
      .eq("organization_id", organizationId)
      .maybeSingle(),
    "getOrganizationDetail:subscription"
  );

  const ownerResult = assertSupabaseResult(
    await admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .eq("role", "owner")
      .limit(1)
      .maybeSingle(),
    "getOrganizationDetail:owner"
  );

  const paymentResult = assertSupabaseResult(
    await admin
      .from("manual_payment_requests")
      .select(
        "id, amount, currency, billing_months, payer_name, status, payment_reference, payment_date, customer_note, admin_note, reviewed_at, created_at"
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(10),
    "getOrganizationDetail:payments"
  );

  const auditResult = assertSupabaseResult(
    await admin
      .from("platform_admin_audit_log")
      .select("id, action, metadata, created_at, admin_user_id")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(20),
    "getOrganizationDetail:audit"
  );

  return {
    organization: orgResult.data,
    subscription: subResult.data,
    owner: {
      user_id: ownerResult.data?.user_id || null,
      email: await getUserEmail(ownerResult.data?.user_id),
      role: ownerResult.data?.role || null,
    },
    payment_requests: paymentResult.data || [],
    audit_log: auditResult.data || [],
  };
}

async function listPaymentRequests({
  status = "",
  organizationId = "",
  dateFrom = "",
  dateTo = "",
  page = 1,
  limit = 50,
} = {}) {
  const admin = getSupabaseAdmin();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const safePage = Math.max(1, Number(page) || 1);
  const from = (safePage - 1) * safeLimit;
  const to = from + safeLimit - 1;

  let query = admin
    .from("manual_payment_requests")
    .select(
      `
      id,
      organization_id,
      amount,
      currency,
      billing_months,
      payer_name,
      payer_phone,
      payment_reference,
      payment_date,
      customer_note,
      status,
      admin_note,
      reviewed_at,
      created_at,
      organizations ( id, name, slug )
    `,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status) query = query.eq("status", status);
  if (organizationId) query = query.eq("organization_id", organizationId);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo);

  const { data, error, count } = await query;
  if (error) {
    console.error("[platform-admin] list payment requests failed", error.code || "unknown");
    throw appError("Не удалось загрузить заявки", "INTERNAL_ERROR", 500);
  }

  const items = await Promise.all(
    (data || []).map(async (row) => {
      const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      const ownerResult = assertSupabaseResult(
        await admin
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", row.organization_id)
          .eq("role", "owner")
          .limit(1)
          .maybeSingle(),
        "listPaymentRequests:owner"
      );

      return {
        id: row.id,
        organization_id: row.organization_id,
        organization_name: org?.name || null,
        organization_slug: org?.slug || null,
        owner_email: await getUserEmail(ownerResult.data?.user_id),
        amount: row.amount,
        currency: row.currency,
        billing_months: row.billing_months,
        payer_name: row.payer_name,
        payer_phone: row.payer_phone,
        payment_reference: row.payment_reference,
        payment_date: row.payment_date,
        customer_note: row.customer_note,
        status: row.status,
        admin_note: row.admin_note,
        reviewed_at: row.reviewed_at,
        created_at: row.created_at,
      };
    })
  );

  return { items, page: safePage, limit: safeLimit, total: count || 0 };
}

async function approvePaymentRequest(requestId, adminUserId, adminNote) {
  if (adminNote != null && String(adminNote).trim().length > 500) {
    throw appError("Проверьте параметры запроса", "VALIDATION_ERROR", 400);
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("admin_approve_manual_payment", {
    p_request_id: requestId,
    p_admin_user_id: adminUserId,
    p_admin_note: adminNote || null,
  });

  if (error) {
    const mapped = mapAdminRpcError(error);
    if (mapped) throw mapped;
    console.error("[platform-admin] approve failed", error.code || "unknown");
    throw appError("Не удалось подтвердить оплату", "INTERNAL_ERROR", 500);
  }

  if (data?.already_processed) {
    throw appError("Заявка уже обработана", "PAYMENT_ALREADY_PROCESSED", 409);
  }

  return data;
}

async function rejectPaymentRequest(requestId, adminUserId, adminNote) {
  const note = String(adminNote || "").trim();
  if (!note || note.length > 500) {
    throw appError("Проверьте параметры запроса", "VALIDATION_ERROR", 400);
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("admin_reject_manual_payment", {
    p_request_id: requestId,
    p_admin_user_id: adminUserId,
    p_admin_note: note,
  });

  if (error) {
    const mapped = mapAdminRpcError(error);
    if (mapped) throw mapped;
    console.error("[platform-admin] reject failed", error.code || "unknown");
    throw appError("Не удалось отклонить заявку", "INTERNAL_ERROR", 500);
  }

  return data;
}

function sanitizeSubscription(row) {
  if (!row) return null;
  return {
    organization_id: row.organization_id,
    status: row.status,
    trial_started_at: row.trial_started_at,
    trial_ends_at: row.trial_ends_at,
    current_period_start: row.current_period_start,
    current_period_end: row.current_period_end,
    grace_period_ends_at: row.grace_period_ends_at,
    cancel_at_period_end: row.cancel_at_period_end,
    canceled_at: row.canceled_at,
    payment_provider: row.payment_provider,
    last_payment_status: row.last_payment_status,
    status_before_suspension: row.status_before_suspension,
    suspended_at: row.suspended_at,
    suspension_reason: row.suspension_reason,
    updated_at: row.updated_at,
  };
}

async function extendSubscription(organizationId, adminUserId, days, reason) {
  const trimmedReason = String(reason || "").trim();
  if (!trimmedReason || trimmedReason.length > 500) {
    throw appError("Проверьте параметры запроса", "VALIDATION_ERROR", 400);
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("admin_extend_subscription", {
    p_organization_id: organizationId,
    p_admin_user_id: adminUserId,
    p_days: Number(days),
    p_reason: trimmedReason,
  });

  if (error) {
    const mapped = mapAdminRpcError(error);
    if (mapped) throw mapped;
    console.error("[platform-admin] extend failed", error.code || "unknown");
    throw appError("Не удалось продлить подписку", "INTERNAL_ERROR", 500);
  }

  return sanitizeSubscription(data);
}

async function suspendOrganization(organizationId, adminUserId, reason) {
  const trimmedReason = String(reason || "").trim();
  if (!trimmedReason || trimmedReason.length > 500) {
    throw appError("Проверьте параметры запроса", "VALIDATION_ERROR", 400);
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("admin_suspend_organization", {
    p_organization_id: organizationId,
    p_admin_user_id: adminUserId,
    p_reason: trimmedReason,
  });

  if (error) {
    const mapped = mapAdminRpcError(error);
    if (mapped) throw mapped;
    console.error("[platform-admin] suspend failed", error.code || "unknown");
    throw appError("Не удалось приостановить организацию", "INTERNAL_ERROR", 500);
  }

  return sanitizeSubscription(data);
}

async function unsuspendOrganization(organizationId, adminUserId) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("admin_unsuspend_organization", {
    p_organization_id: organizationId,
    p_admin_user_id: adminUserId,
  });

  if (error) {
    const mapped = mapAdminRpcError(error);
    if (mapped) throw mapped;
    console.error("[platform-admin] unsuspend failed", error.code || "unknown");
    throw appError("Не удалось снять приостановку", "INTERNAL_ERROR", 500);
  }

  return sanitizeSubscription(data);
}

module.exports = {
  isPlatformAdminUser,
  getOverview,
  listOrganizations,
  getOrganizationDetail,
  listPaymentRequests,
  approvePaymentRequest,
  rejectPaymentRequest,
  extendSubscription,
  suspendOrganization,
  unsuspendOrganization,
  assertSupabaseResult,
  sanitizeSubscription,
};
