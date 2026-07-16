/**
 * Серверная проверка доступа по подписке организации.
 *
 * Миграция 010 разделяет две RPC:
 *   - public.get_subscription_access_internal(uuid) — без membership-проверки,
 *     EXECUTE выдан только service_role. Используется здесь, когда явный
 *     `client` не передан: organization_id в этом случае уже безопасно
 *     определён сервером (например по slug в публичной онлайн-записи), а не
 *     получен напрямую из тела запроса пользователя.
 *   - public.get_organization_subscription_access(uuid) — с проверкой
 *     auth.uid() и membership, EXECUTE выдан только authenticated. Используется,
 *     когда передан `client`, полученный из JWT пользователя (авторизованные
 *     маршруты) — тогда БД сама проверяет, что пользователь состоит в этой
 *     организации, и сервер не может прочитать чужую подписку.
 *
 * Важно: service_role НЕ имеет доступа к пользовательской RPC, а authenticated
 * клиент не имеет доступа к внутренней RPC — эти два пути нельзя смешивать.
 */

const { getSupabaseAdmin } = require("./supabase-admin");

function appError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

/**
 * Получить состояние доступа по подписке организации.
 * Возвращает объект { allowed, status, reason, plan_code, trial_ends_at,
 * current_period_end, grace_period_ends_at, days_remaining }.
 */
async function getOrganizationSubscriptionAccess(organizationId, { client } = {}) {
  if (!organizationId) {
    throw appError("organization_id обязателен", "VALIDATION_ERROR", 400);
  }

  const supabase = client || getSupabaseAdmin();
  const rpcName = client
    ? "get_organization_subscription_access"
    : "get_subscription_access_internal";

  const { data, error } = await supabase.rpc(rpcName, {
    p_organization_id: organizationId,
  });

  if (error) {
    const errCode = String(error.code || "");
    const errMessage = String(error.message || "");
    if (errCode === "42501" || errMessage.includes("FORBIDDEN")) {
      throw appError("Нет доступа к этой организации", "FORBIDDEN", 403);
    }
    console.error(`[subscription] ${rpcName} failed:`, errCode || "unknown");
    throw appError("Не удалось проверить подписку. Попробуйте позже", "INTERNAL_ERROR", 500);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    return {
      allowed: false,
      status: null,
      reason: "SUBSCRIPTION_NOT_FOUND",
      plan_code: null,
      trial_ends_at: null,
      current_period_end: null,
      grace_period_ends_at: null,
      days_remaining: null,
    };
  }

  return row;
}

/**
 * Бросает appError, если у организации нет доступа.
 * suspended → 403 ORGANIZATION_SUSPENDED
 * иначе → 402 SUBSCRIPTION_REQUIRED
 */
async function requireOrganizationSubscriptionAccess(organizationId, options = {}) {
  const access = await getOrganizationSubscriptionAccess(organizationId, options);

  if (access.allowed !== true) {
    if (access.reason === "ORGANIZATION_SUSPENDED") {
      throw appError("Организация приостановлена", "ORGANIZATION_SUSPENDED", 403);
    }
    throw appError("Онлайн-запись временно недоступна", "SUBSCRIPTION_REQUIRED", 402);
  }

  return access;
}

/**
 * Сопоставляет ошибки БД (raise exception 'SUBSCRIPTION_REQUIRED' /
 * 'ORGANIZATION_SUSPENDED' из enforce_subscription_access()) с безопасными
 * ответами API. Используется серверными обработчиками, которые пишут в
 * бизнес-таблицы напрямую (например будущими авторизованными маршрутами).
 */
function mapSubscriptionError(error) {
  const text = String(error?.message || "");

  if (text.includes("ORGANIZATION_SUSPENDED")) {
    return appError("Организация приостановлена", "ORGANIZATION_SUSPENDED", 403);
  }
  if (text.includes("SUBSCRIPTION_REQUIRED")) {
    return appError("Требуется активная подписка", "SUBSCRIPTION_REQUIRED", 402);
  }

  return null;
}

module.exports = {
  getOrganizationSubscriptionAccess,
  requireOrganizationSubscriptionAccess,
  mapSubscriptionError,
  appError,
};
