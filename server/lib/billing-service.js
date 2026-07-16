/**
 * Ручная оплата подписки (Kaspi) — только для owner организации.
 */

const { getSupabaseAdmin } = require("./supabase-admin");
const { getOrganizationSubscriptionAccess, appError } = require("./subscription-service");
const config = require("../config");

const OWNER_REQUIRED_MESSAGE = "Управлять оплатой может только владелец организации";

function mapRpcError(error) {
  const message = String(error?.message || "");
  const details = String(error?.details || "");
  const hint = String(error?.hint || "");
  const code = String(error?.code || "");
  const combined = `${message}\n${details}\n${hint}`;

  if (
    combined.includes("PAYMENT_REQUEST_ALREADY_PENDING") ||
    combined.includes("idx_manual_payment_requests_one_pending_per_org")
  ) {
    return appError("Уже есть заявка на проверке", "PAYMENT_REQUEST_ALREADY_PENDING", 409);
  }

  if (code === "23505") {
    console.error("[billing] unexpected unique_violation", code);
    return appError("Не удалось выполнить запрос", "INTERNAL_ERROR", 500);
  }

  if (message.includes("OWNER_REQUIRED")) {
    return appError(OWNER_REQUIRED_MESSAGE, "OWNER_REQUIRED", 403);
  }
  if (message.includes("ORGANIZATION_NOT_FOUND")) {
    return appError("Организация не найдена", "ORGANIZATION_NOT_FOUND", 404);
  }
  if (message.includes("NOT_FOUND")) {
    return appError("Заявка не найдена", "NOT_FOUND", 404);
  }
  if (message.includes("INVALID_STATUS")) {
    return appError("Заявку нельзя изменить в текущем статусе", "INVALID_STATUS", 400);
  }
  if (message.includes("VALIDATION_ERROR") || message.includes("PLAN_NOT_FOUND")) {
    return appError("Проверьте данные заявки", "VALIDATION_ERROR", 400);
  }
  return null;
}

function validationError(message = "Проверьте данные заявки") {
  return appError(message, "VALIDATION_ERROR", 400);
}

function validateTextField(value, { min = 0, max, label }) {
  const text = value == null ? "" : String(value).trim();
  if (text.length < min || (max != null && text.length > max)) {
    throw validationError(`${label} некорректно`);
  }
  return text || null;
}

function validatePaymentDate(raw) {
  if (raw == null || raw === "") return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw validationError("Дата перевода некорректна");
  }
  const maxFuture = Date.now() + 24 * 60 * 60 * 1000;
  if (date.getTime() > maxFuture) {
    throw validationError("Дата перевода не может быть более чем на 24 часа в будущем");
  }
  return date.toISOString();
}

function parseBillingMonths(raw) {
  if (raw === undefined || raw === null) return 1;
  if (typeof raw === "string" && raw.trim() === "") return 1;

  const asNumber = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(asNumber) || asNumber < 1 || asNumber > 12) {
    throw validationError("Количество месяцев должно быть целым числом от 1 до 12");
  }
  return asNumber;
}

function validateCreateBody(body) {
  const payerName = validateTextField(body.payer_name, { min: 2, max: 100, label: "Имя отправителя" });
  const payerPhone = body.payer_phone ? validateTextField(body.payer_phone, { max: 30, label: "Телефон" }) : null;
  const paymentReference = body.payment_reference
    ? validateTextField(body.payment_reference, { max: 150, label: "Комментарий платежа" })
    : null;
  const customerNote = body.customer_note
    ? validateTextField(body.customer_note, { max: 500, label: "Комментарий" })
    : null;
  const billingMonths = parseBillingMonths(body.billing_months);
  const paymentDate = validatePaymentDate(body.payment_date);

  return {
    payer_name: payerName,
    payer_phone: payerPhone,
    payment_reference: paymentReference,
    customer_note: customerNote,
    billing_months: billingMonths,
    payment_date: paymentDate,
  };
}

async function requireOwnerOrganizationId(userId) {
  const admin = getSupabaseAdmin();

  const { data: ownerRow, error: ownerError } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (ownerError) {
    console.error("[billing] owner lookup failed", ownerError.code || "unknown");
    throw appError("Не удалось определить организацию", "INTERNAL_ERROR", 500);
  }

  if (ownerRow?.organization_id) {
    return ownerRow.organization_id;
  }

  const { data: memberRow, error: memberError } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (memberError) {
    console.error("[billing] membership lookup failed", memberError.code || "unknown");
    throw appError("Не удалось определить организацию", "INTERNAL_ERROR", 500);
  }

  if (memberRow?.organization_id) {
    throw appError(OWNER_REQUIRED_MESSAGE, "OWNER_REQUIRED", 403);
  }

  throw appError("Организация не найдена", "ORGANIZATION_NOT_FOUND", 404);
}

async function getActiveProPlan() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("subscription_plans")
    .select("id, code, name, price_amount, currency, billing_interval, trial_days")
    .eq("code", "pro")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[billing] plan lookup failed", error.code || "unknown");
    throw appError("Тариф не найден", "INTERNAL_ERROR", 500);
  }
  if (!data) {
    throw appError("Тариф не найден", "PLAN_NOT_FOUND", 500);
  }

  return data;
}

function getKaspiPaymentInfo(plan, billingMonths = 1) {
  const months = Math.max(1, Math.min(12, Number(billingMonths) || 1));
  return {
    recipient: config.kaspi.recipient,
    phone: config.kaspi.phone,
    instructions: config.kaspi.instructions,
    amount: plan.price_amount * months,
    currency: plan.currency,
    billing_months: months,
  };
}

async function getLatestRelevantRequest(organizationId) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("manual_payment_requests")
    .select(
      "id, organization_id, amount, currency, billing_months, payer_name, payer_phone, payment_reference, payment_date, customer_note, status, admin_note, approved_period_start, approved_period_end, reviewed_at, created_at, updated_at"
    )
    .eq("organization_id", organizationId)
    .in("status", ["pending", "approved", "rejected"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[billing] latest request lookup failed", error.code || "unknown");
    throw appError("Не удалось загрузить заявки", "INTERNAL_ERROR", 500);
  }

  return data;
}

async function getPaymentInfo(userId) {
  const organizationId = await requireOwnerOrganizationId(userId);
  const plan = await getActiveProPlan();
  const subscription = await getOrganizationSubscriptionAccess(organizationId);
  const latestRequest = await getLatestRelevantRequest(organizationId);

  return {
    plan: {
      code: plan.code,
      name: plan.name,
      price_amount: plan.price_amount,
      currency: plan.currency,
      billing_interval: plan.billing_interval,
    },
    kaspi: getKaspiPaymentInfo(plan, 1),
    subscription,
    latest_request: latestRequest,
  };
}

async function listPaymentRequests(userId) {
  const organizationId = await requireOwnerOrganizationId(userId);
  const admin = getSupabaseAdmin();

  const { data, error } = await admin
    .from("manual_payment_requests")
    .select(
      "id, amount, currency, billing_months, payer_name, payer_phone, payment_reference, payment_date, customer_note, status, admin_note, approved_period_start, approved_period_end, reviewed_at, created_at, updated_at"
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[billing] list requests failed", error.code || "unknown");
    throw appError("Не удалось загрузить заявки", "INTERNAL_ERROR", 500);
  }

  return data || [];
}

async function createPaymentRequest(userId, body) {
  await requireOwnerOrganizationId(userId);
  const validated = validateCreateBody(body || {});
  const admin = getSupabaseAdmin();

  const { data, error } = await admin.rpc("billing_create_manual_payment_request", {
    p_user_id: userId,
    p_payer_name: validated.payer_name,
    p_payer_phone: validated.payer_phone,
    p_payment_reference: validated.payment_reference,
    p_payment_date: validated.payment_date,
    p_customer_note: validated.customer_note,
    p_billing_months: validated.billing_months,
  });

  if (error) {
    const mapped = mapRpcError(error);
    if (mapped) throw mapped;
    console.error("[billing] create request failed", error.code || "unknown");
    throw appError("Не удалось создать заявку", "INTERNAL_ERROR", 500);
  }

  return sanitizeRequest(data);
}

async function cancelPaymentRequest(userId, requestId) {
  await requireOwnerOrganizationId(userId);
  const admin = getSupabaseAdmin();

  const { data, error } = await admin.rpc("billing_cancel_manual_payment_request", {
    p_user_id: userId,
    p_request_id: requestId,
  });

  if (error) {
    const mapped = mapRpcError(error);
    if (mapped) throw mapped;
    console.error("[billing] cancel request failed", error.code || "unknown");
    throw appError("Не удалось отменить заявку", "INTERNAL_ERROR", 500);
  }

  return sanitizeRequest(data);
}

function sanitizeRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
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
    approved_period_start: row.approved_period_start,
    approved_period_end: row.approved_period_end,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = {
  getPaymentInfo,
  listPaymentRequests,
  createPaymentRequest,
  cancelPaymentRequest,
  getKaspiPaymentInfo,
  getActiveProPlan,
  requireOwnerOrganizationId,
  sanitizeRequest,
  mapRpcError,
  validateCreateBody,
};
