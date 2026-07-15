window.PublicBookingApi = (() => {
  const BASE = "/api/public";

  async function request(path, options = {}) {
    const response = await fetch(`${BASE}${path}`, {
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const error = new Error(PublicBookingErrors.fromResponse(payload));
      error.code = payload?.code || "GENERIC";
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function getSlugFromPath() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const bookIndex = parts.indexOf("book");
    if (bookIndex === -1 || !parts[bookIndex + 1]) return "";
    return decodeURIComponent(parts[bookIndex + 1]);
  }

  return {
    getSlugFromPath,
    getOrganization(slug) {
      return request(`/organizations/${encodeURIComponent(slug)}`);
    },
    getServices(slug) {
      return request(`/organizations/${encodeURIComponent(slug)}/services`);
    },
    getStaff(slug, serviceId) {
      const query = new URLSearchParams({ service_id: serviceId });
      return request(`/organizations/${encodeURIComponent(slug)}/staff?${query}`);
    },
    getSlots(slug, { serviceId, staffId, date }) {
      const query = new URLSearchParams({
        service_id: serviceId,
        staff_id: staffId,
        date,
      });
      return request(`/organizations/${encodeURIComponent(slug)}/slots?${query}`);
    },
    createBooking(slug, body) {
      return request(`/organizations/${encodeURIComponent(slug)}/bookings`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  };
})();
