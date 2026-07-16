/**
 * Bookly — API ручной оплаты (серверные маршруты /api/billing)
 */
window.BooklyBilling = (() => {
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

  function getPaymentInfo() {
    return request("/api/billing/payment-info");
  }

  function listPaymentRequests() {
    return request("/api/billing/payment-requests");
  }

  function createPaymentRequest(body) {
    return request("/api/billing/payment-requests", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  function cancelPaymentRequest(id) {
    return request(`/api/billing/payment-requests/${id}/cancel`, {
      method: "POST",
      body: "{}",
    });
  }

  return {
    getPaymentInfo,
    listPaymentRequests,
    createPaymentRequest,
    cancelPaymentRequest,
  };
})();
