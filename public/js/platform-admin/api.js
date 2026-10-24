/**
 * API глобальной админ-панели Bookly
 */
window.BooklyPlatformAdminApi = (() => {
  const DEFAULT_TIMEOUT_MS = 10000;

  async function getAccessToken() {
    const supabase = await BooklyAuth.getClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error("[platform-admin] получение session", error.message || "unknown");
      throw Object.assign(new Error("Не удалось получить сессию"), {
        code: "SESSION_ERROR",
        status: 401,
      });
    }
    const token = data?.session?.access_token;
    if (!token) {
      throw Object.assign(new Error("Требуется авторизация"), {
        code: "UNAUTHORIZED",
        status: 401,
      });
    }
    return token;
  }

  async function request(path, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const token = options.accessToken || (await getAccessToken());
      const { accessToken: _accessToken, timeoutMs: _timeoutMs, ...fetchOptions } = options;
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(fetchOptions.headers || {}),
      };

      const response = await fetch(booklyApiUrl(path), {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        const error = new Error(payload.message || "Ошибка запроса");
        error.code = payload.code || "REQUEST_FAILED";
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error("Превышено время ожидания ответа сервера");
        timeoutError.code = "TIMEOUT";
        timeoutError.status = 0;
        throw timeoutError;
      }
      if (error?.status || error?.code) throw error;
      const networkError = new Error(error?.message || "Ошибка сети");
      networkError.code = "NETWORK_ERROR";
      networkError.status = 0;
      throw networkError;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    me: (accessToken) => request("/api/admin/me", accessToken ? { accessToken } : {}),
    overview: () => request("/api/admin/overview"),
    organizations: (params = {}) => {
      const query = new URLSearchParams(params).toString();
      return request(`/api/admin/organizations${query ? `?${query}` : ""}`);
    },
    organization: (id) => request(`/api/admin/organizations/${id}`),
    audit: (limit = 100) => request(`/api/admin/audit?limit=${limit}`),
    updateOrganization: (id, body) =>
      request(`/api/admin/organizations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    loginLink: (id) => request(`/api/admin/organizations/${id}/login-link`, { method: "POST", body: "{}" }),
    changeOwnerEmail: (id, email) =>
      request(`/api/admin/organizations/${id}/owner/email`, { method: "POST", body: JSON.stringify({ email }) }),
    ownerPasswordLink: (id) =>
      request(`/api/admin/organizations/${id}/owner/password-link`, { method: "POST", body: "{}" }),
    blockOwner: (id, reason) =>
      request(`/api/admin/organizations/${id}/owner/block`, { method: "POST", body: JSON.stringify({ reason }) }),
    unblockOwner: (id) => request(`/api/admin/organizations/${id}/owner/unblock`, { method: "POST", body: "{}" }),
    revokePro: (id, reason) =>
      request(`/api/admin/organizations/${id}/revoke-pro`, { method: "POST", body: JSON.stringify({ reason }) }),
    deleteOrganization: (id, confirmSlug, deleteOwner) =>
      request(`/api/admin/organizations/${id}/delete`, {
        method: "POST",
        body: JSON.stringify({ confirm_slug: confirmSlug, delete_owner: deleteOwner }),
      }),
    telegram: () => request("/api/admin/telegram"),
    disconnectTelegram: () => request("/api/admin/telegram/disconnect", { method: "POST", body: "{}" }),
    paymentRequests: (params = {}) => {
      const query = new URLSearchParams(params).toString();
      return request(`/api/admin/payment-requests${query ? `?${query}` : ""}`);
    },
    approvePayment: (id, adminNote) =>
      request(`/api/admin/payment-requests/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ admin_note: adminNote || null }),
      }),
    rejectPayment: (id, adminNote) =>
      request(`/api/admin/payment-requests/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ admin_note: adminNote }),
      }),
    extendSubscription: (orgId, days, reason) =>
      request(`/api/admin/organizations/${orgId}/extend`, {
        method: "POST",
        body: JSON.stringify({ days, reason }),
      }),
    suspendOrganization: (orgId, reason) =>
      request(`/api/admin/organizations/${orgId}/suspend`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    unsuspendOrganization: (orgId) =>
      request(`/api/admin/organizations/${orgId}/unsuspend`, {
        method: "POST",
        body: "{}",
      }),
  };
})();
