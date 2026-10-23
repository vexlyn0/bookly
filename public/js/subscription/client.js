/**
 * Bookly — API подписки организации (Supabase RPC)
 */
window.BooklySubscription = (() => {
  const log = (...args) => {
    if (window.BooklyAuth?.log) {
      BooklyAuth.log("[Subscription]", ...args);
    } else {
      console.log("[BooklySubscription]", ...args);
    }
  };

  const DB_ERROR_MESSAGES = {
    STAFF_LIMIT_REACHED:
      "На тарифе Free можно держать до 5 активных мастеров. Отключите одного из мастеров или перейдите на Pro.",
    SUBSCRIPTION_REQUIRED:
      "Действие недоступно на текущем тарифе. Подробнее — в разделе «Тариф и оплата».",
    ORGANIZATION_SUSPENDED: "Организация приостановлена. Обратитесь в поддержку.",
    FORBIDDEN: "Нет доступа к этой организации.",
  };

  const FORBIDDEN_ACCESS_FIELDS = [
    "payment_provider",
    "provider_customer_id",
    "provider_subscription_id",
    "provider_payment_method_fingerprint",
    "last_payment_status",
    "trial_started_by_user_id",
  ];

  const STATUS_LABELS = {
    trialing: "Пробный период",
    active: "Активна",
    past_due: "Требуется оплата",
    canceled: "Отменена",
    expired: "Закончилась",
    suspended: "Приостановлена",
  };

  function sanitizeAccess(row) {
    const access =
      row || {
        allowed: false,
        status: null,
        reason: "SUBSCRIPTION_NOT_FOUND",
        plan_code: null,
        trial_ends_at: null,
        current_period_end: null,
        grace_period_ends_at: null,
        days_remaining: null,
      };

    for (const field of FORBIDDEN_ACCESS_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(access, field)) {
        delete access[field];
      }
    }

    return {
      allowed: access.allowed === true,
      status: access.status || null,
      reason: access.reason || null,
      plan_code: access.plan_code || null,
      trial_ends_at: access.trial_ends_at || null,
      current_period_end: access.current_period_end || null,
      grace_period_ends_at: access.grace_period_ends_at || null,
      days_remaining:
        access.days_remaining == null ? null : Number(access.days_remaining),
    };
  }

  /**
   * Получить состояние доступа по подписке своей организации.
   * Только через RPC — прямой SELECT organization_subscriptions запрещён
   * (provider IDs и fingerprint не должны попадать в браузер).
   */
  async function getAccess(organizationId) {
    log("getAccess:", organizationId);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase.rpc("get_organization_subscription_access", {
      p_organization_id: organizationId,
    });

    if (error) {
      log("getAccess: error", error.message, error.code);
      throw error;
    }

    const row = Array.isArray(data) ? data[0] : data;
    return sanitizeAccess(row);
  }

  /**
   * Если ошибка от enforce_subscription_access() в БД (SUBSCRIPTION_REQUIRED /
   * ORGANIZATION_SUSPENDED) — вернуть понятное сообщение. Иначе null.
   */
  function mapDbError(error) {
    const message = String(error?.message || "");
    const code = String(error?.code || "");
    if (code === "42501" || message.includes("FORBIDDEN")) {
      return DB_ERROR_MESSAGES.FORBIDDEN;
    }
    for (const [dbCode, text] of Object.entries(DB_ERROR_MESSAGES)) {
      if (message.includes(dbCode)) return text;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Тариф и лимиты (Free / Pro) — общий снимок для всех разделов кабинета
  // ---------------------------------------------------------------------------

  let entitlements = null;
  let entitlementsPromise = null;
  const listeners = new Set();

  function normalizeEntitlements(row) {
    const isPro = row?.is_pro === true;
    return {
      plan_code: isPro ? "pro" : "free",
      is_pro: isPro,
      is_trial: row?.is_trial === true,
      is_suspended: row?.is_suspended === true,
      status: row?.status || null,
      trial_ends_at: row?.trial_ends_at || null,
      current_period_end: row?.current_period_end || null,
      grace_period_ends_at: row?.grace_period_ends_at || null,
      days_remaining: row?.days_remaining == null ? null : Number(row.days_remaining),
      staff_limit: row?.staff_limit == null ? null : Number(row.staff_limit),
      active_staff_count: Number(row?.active_staff_count) || 0,
      trial_available: row?.trial_available === true,
      show_branding: row?.show_branding !== false,
    };
  }

  async function loadEntitlements(organizationId, { force = false } = {}) {
    if (entitlements && !force) return entitlements;
    if (entitlementsPromise && !force) return entitlementsPromise;

    entitlementsPromise = (async () => {
      const supabase = await BooklyAuth.getClient();
      const { data, error } = await supabase.rpc("get_organization_entitlements", {
        p_organization_id: organizationId,
      });
      if (error) {
        log("loadEntitlements: error", error.message, error.code);
        throw error;
      }
      entitlements = normalizeEntitlements(Array.isArray(data) ? data[0] : data);
      listeners.forEach((listener) => listener(entitlements));
      return entitlements;
    })();

    try {
      return await entitlementsPromise;
    } finally {
      entitlementsPromise = null;
    }
  }

  function getEntitlements() {
    return entitlements;
  }

  function onEntitlementsChange(listener) {
    listeners.add(listener);
    if (entitlements) listener(entitlements);
    return () => listeners.delete(listener);
  }

  /**
   * После окончания Pro ставит на паузу мастеров сверх лимита Free.
   * Возвращает число мастеров, поставленных на паузу.
   */
  async function syncPlanLimits(organizationId) {
    const supabase = await BooklyAuth.getClient();
    const { data, error } = await supabase.rpc("sync_organization_plan_limits", {
      p_organization_id: organizationId,
    });
    if (error) {
      log("syncPlanLimits: error", error.message, error.code);
      return 0;
    }
    return Number(data) || 0;
  }

  function planLabel(value) {
    if (!value) return "—";
    if (value.is_suspended) return "Приостановлен";
    if (value.is_trial) return "Пробный Pro";
    return value.is_pro ? "Pro" : "Free";
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || "—";
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
    } catch {
      return "—";
    }
  }

  function formatPrice(amount, currency = "KZT") {
    const value = Number(amount) || 0;
    const symbol = currency === "KZT" ? "₸" : currency;
    return `${value.toLocaleString("ru-RU")} ${symbol}`;
  }

  /**
   * Человекочитаемое объяснение текущего доступа для раздела «Тариф и оплата».
   */
  function explain(access) {
    if (!access) return "Не удалось определить статус подписки.";

    switch (access.status) {
      case "trialing":
        return access.allowed
          ? `Пробный период — осталось ${access.days_remaining ?? 0} ${pluralDays(access.days_remaining)}`
          : "Пробный период закончился.";
      case "active":
        return access.allowed
          ? `Подписка активна до ${formatDate(access.current_period_end)}`
          : "Подписка закончилась.";
      case "past_due":
        return access.allowed
          ? `Не удалось продлить подписку. Оплатите до ${formatDate(access.grace_period_ends_at)}`
          : "Не удалось продлить подписку. Доступ приостановлен.";
      case "canceled":
        return access.allowed
          ? `Подписка отменена, доступ сохранится до ${formatDate(access.current_period_end)}`
          : "Подписка отменена и закончилась.";
      case "expired":
        return "Подписка закончилась.";
      case "suspended":
        return "Организация приостановлена. Обратитесь в поддержку.";
      default:
        return "Подписка не найдена.";
    }
  }

  function pluralDays(n) {
    const value = Math.abs(Number(n) || 0);
    const mod10 = value % 10;
    const mod100 = value % 100;
    if (mod100 >= 11 && mod100 <= 14) return "дней";
    if (mod10 === 1) return "день";
    if (mod10 >= 2 && mod10 <= 4) return "дня";
    return "дней";
  }

  return {
    getAccess,
    loadEntitlements,
    getEntitlements,
    onEntitlementsChange,
    syncPlanLimits,
    planLabel,
    sanitizeAccess,
    mapDbError,
    statusLabel,
    formatDate,
    formatPrice,
    explain,
    pluralDays,
  };
})();
