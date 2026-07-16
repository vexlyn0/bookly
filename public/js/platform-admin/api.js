/**
 * API глобальной админ-панели Bookly
 */
window.BooklyPlatformAdminApi = (() => {
  async function authHeaders() {
    const supabase = await BooklyAuth.getClient();
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error("Требуется авторизация");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async function request(path, options = {}) {
    const headers = await authHeaders();
    const response = await fetch(booklyApiUrl(path), {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.message || "Ошибка запроса");
      error.code = payload.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  return {
    me: () => request("/api/admin/me"),
    overview: () => request("/api/admin/overview"),
    organizations: (params = {}) => {
      const query = new URLSearchParams(params).toString();
      return request(`/api/admin/organizations${query ? `?${query}` : ""}`);
    },
    organization: (id) => request(`/api/admin/organizations/${id}`),
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
