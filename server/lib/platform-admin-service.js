/**
 * Сервис глобальной панели platform admin.
 */

const { getSupabaseAdmin } = require("./supabase-admin");
const { appError } = require("./subscription-service");
const stats = require("./platform-admin-stats");

// -----------------------------------------------------------------------------
// Снимок платформы (кеш 30 секунд, сбрасывается после действий админа)
// -----------------------------------------------------------------------------

const SNAPSHOT_TTL_MS = 30 * 1000;
const PAGE = 1000;
let snapshotCache = null;

/** Все строки запроса постранично: PostgREST отдаёт не больше 1000 за раз. */
async function fetchAll(makeQuery, context) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) {
      console.error(`[platform-admin] ${context}`, error.code || "unknown");
      throw appError("Не удалось выполнить запрос", "INTERNAL_ERROR", 500);
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function fetchAllUsers(admin) {
  const users = [];
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) {
      console.error("[platform-admin] listUsers", error.code || "unknown");
      throw appError("Не удалось выполнить запрос", "INTERNAL_ERROR", 500);
    }
    const batch = data?.users || [];
    users.push(...batch.map((u) => ({ id: u.id, email: u.email || null, last_sign_in_at: u.last_sign_in_at || null })));
    if (batch.length < PAGE) break;
  }
  return users;
}

async function loadSnapshot({ force = false } = {}) {
  if (!force && snapshotCache && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) return snapshotCache;

  const admin = getSupabaseAdmin();
  const [organizations, subscriptions, owners, staff, services, bookings, payments, users] = await Promise.all([
    fetchAll(
      () =>
        admin
          .from("organizations")
          .select("id, name, public_name, slug, business_type, phone, address, created_at, public_booking_enabled")
          .order("created_at", { ascending: true }),
      "snapshot:organizations"
    ),
    fetchAll(
      () =>
        admin
          .from("organization_subscriptions")
          .select("organization_id, status, trial_ends_at, current_period_end, grace_period_ends_at")
          .order("organization_id"),
      "snapshot:subscriptions"
    ),
    fetchAll(
      () => admin.from("organization_members").select("organization_id, user_id").eq("role", "owner").order("organization_id"),
      "snapshot:owners"
    ),
    fetchAll(
      () => admin.from("staff").select("organization_id, is_active, telegram_chat_id").order("id"),
      "snapshot:staff"
    ),
    fetchAll(() => admin.from("services").select("organization_id, is_active").order("id"), "snapshot:services"),
    fetchAll(
      () => admin.from("bookings").select("organization_id, created_at, source, status").order("created_at"),
      "snapshot:bookings"
    ),
    fetchAll(
      () =>
        admin
          .from("manual_payment_requests")
          .select("id, organization_id, amount, billing_months, status, created_at, reviewed_at")
          .order("created_at"),
      "snapshot:payments"
    ),
    fetchAllUsers(admin),
  ]);

  const raw = { organizations, subscriptions, owners, staff, services, bookings, payments, users };
  const orgs = stats.buildOrganizations(raw);
  snapshotCache = { at: Date.now(), raw, orgs };
  return snapshotCache;
}

function invalidateSnapshot() {
  snapshotCache = null;
}

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
  const { raw, orgs } = await loadSnapshot();
  return stats.buildOverview(raw, orgs);
}

async function listOrganizations({ search = "", segment = "all", page = 1, limit = 50 } = {}) {
  const { orgs } = await loadSnapshot();
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const safePage = Math.max(1, Number(page) || 1);
  const filtered = stats.filterOrganizations(orgs, { segment, search });

  return {
    items: filtered.slice((safePage - 1) * safeLimit, safePage * safeLimit),
    counts: stats.segmentCounts(orgs),
    page: safePage,
    limit: safeLimit,
    total: filtered.length,
  };
}

/** Журнал действий админов по всей платформе. */
async function listAuditLog({ limit = 100 } = {}) {
  const admin = getSupabaseAdmin();
  const safeLimit = Math.max(1, Math.min(300, Number(limit) || 100));
  const result = assertSupabaseResult(
    await admin
      .from("platform_admin_audit_log")
      .select("id, action, metadata, created_at, admin_user_id, organization_id, organizations(name, public_name)")
      .order("created_at", { ascending: false })
      .limit(safeLimit),
    "listAuditLog"
  );

  const { raw } = await loadSnapshot();
  const emails = new Map(raw.users.map((u) => [u.id, u.email]));

  return (result.data || []).map((row) => {
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    return {
      id: row.id,
      action: row.action,
      metadata: row.metadata || {},
      created_at: row.created_at,
      admin_email: emails.get(row.admin_user_id) || null,
      organization_id: row.organization_id,
      organization_name: org?.public_name || org?.name || null,
    };
  });
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

  const { orgs } = await loadSnapshot();
  const recentResult = assertSupabaseResult(
    await admin
      .from("bookings")
      .select("id, booking_date, start_time, status, source, client_name, created_at, services(name), staff(name)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(10),
    "getOrganizationDetail:bookings"
  );

  return {
    stats: orgs.find((o) => o.id === organizationId) || null,
    recent_bookings: recentResult.data || [],
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
  invalidateSnapshot();
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
  invalidateSnapshot();
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
  invalidateSnapshot();
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
  invalidateSnapshot();
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
  invalidateSnapshot();
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
  listAuditLog,
  loadSnapshot,
  invalidateSnapshot,
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
