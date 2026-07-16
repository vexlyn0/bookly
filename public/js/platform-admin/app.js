/**
 * Точка входа глобальной админ-панели Bookly
 */
(async function initPlatformAdmin() {
  const loader = document.getElementById("admin-loader");
  const denied = document.getElementById("admin-denied");
  const app = document.getElementById("admin-app");
  const content = document.getElementById("admin-content");
  const pageTitle = document.getElementById("admin-page-title");
  const userEmail = document.getElementById("admin-user-email");

  let currentView = "overview";

  function showDenied() {
    loader.hidden = true;
    denied.hidden = false;
    app.hidden = true;
    document.body.classList.remove("is-loading");
  }

  function showApp() {
    loader.hidden = true;
    denied.hidden = true;
    app.hidden = false;
    document.body.classList.remove("is-loading");
  }

  async function ensureAuth() {
    const user = await BooklyAuth.getUser();
    if (!user) {
      window.location.replace(booklyPath("/login"));
      return null;
    }
    if (userEmail) userEmail.textContent = user.email || "";
    return user;
  }

  async function ensureAdmin() {
    try {
      const payload = await BooklyPlatformAdminApi.me();
      return payload.admin;
    } catch (error) {
      if (error.status === 403 || error.status === 401) return null;
      throw error;
    }
  }

  async function loadOverview() {
    pageTitle.textContent = "Главная";
    const [overviewPayload, pendingPayload, orgsPayload] = await Promise.all([
      BooklyPlatformAdminApi.overview(),
      BooklyPlatformAdminApi.paymentRequests({ status: "pending", limit: 10 }),
      BooklyPlatformAdminApi.organizations({ limit: 8 }),
    ]);
    content.innerHTML = BooklyPlatformAdminUI.renderOverview({
      overview: overviewPayload.overview,
      pendingPayments: pendingPayload,
      recentOrgs: orgsPayload,
    });
    bindPaymentActions();
    bindOrgOpenActions();
  }

  async function loadOrganizations() {
    pageTitle.textContent = "Организации";
    content.innerHTML = BooklyPlatformAdminUI.renderOrganizationsView();
    const search = document.getElementById("org-search");
    const status = document.getElementById("org-status-filter");
    const refresh = async () => {
      const payload = await BooklyPlatformAdminApi.organizations({
        search: search?.value || "",
        subscription_status: status?.value || "",
        limit: 50,
      });
      const wrap = document.getElementById("organizations-table-wrap");
      if (wrap) {
        wrap.innerHTML = BooklyPlatformAdminUI.renderOrganizationsTable(payload.items || []);
        bindOrgOpenActions();
      }
    };
    document.getElementById("org-refresh")?.addEventListener("click", refresh);
    search?.addEventListener("change", refresh);
    status?.addEventListener("change", refresh);
    await refresh();
  }

  async function loadPayments() {
    pageTitle.textContent = "Платежи";
    content.innerHTML = BooklyPlatformAdminUI.renderPaymentsView();
    const status = document.getElementById("payments-status-filter");
    const refresh = async () => {
      const payload = await BooklyPlatformAdminApi.paymentRequests({
        status: status?.value || "",
        limit: 100,
      });
      const wrap = document.getElementById("payments-table-wrap");
      if (wrap) {
        wrap.innerHTML = BooklyPlatformAdminUI.renderPaymentsTable(payload.items || [], {
          actions: true,
        });
        bindPaymentActions();
      }
    };
    document.getElementById("payments-refresh")?.addEventListener("click", refresh);
    status?.addEventListener("change", refresh);
    await refresh();
  }

  async function loadOrganizationDetail(orgId) {
    pageTitle.textContent = "Организация";
    const detail = await BooklyPlatformAdminApi.organization(orgId);
    content.innerHTML = BooklyPlatformAdminUI.renderOrganizationDetail(detail);
    bindOrgAdminActions();
  }

  function bindPaymentActions() {
    content.querySelectorAll("[data-payment-approve]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.getAttribute("data-payment-approve");
        const note = await BooklyPlatformAdminUI.confirmModal({
          title: "Подтвердить оплату?",
          body: "Подписка будет продлена на указанное в заявке количество месяцев.",
          confirmLabel: "Подтвердить",
        });
        if (!note) return;
        try {
          await BooklyPlatformAdminApi.approvePayment(id, typeof note === "string" ? note : null);
          await reloadCurrentView();
        } catch (error) {
          alert(error.message || "Не удалось подтвердить оплату");
        }
      });
    });

    content.querySelectorAll("[data-payment-reject]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.getAttribute("data-payment-reject");
        const reason = await BooklyPlatformAdminUI.confirmModal({
          title: "Отклонить заявку?",
          body: "Подписка не изменится. Укажите причину отказа для клиента.",
          confirmLabel: "Отклонить",
          requireInput: true,
          inputLabel: "Причина отказа",
        });
        if (!reason) return;
        try {
          await BooklyPlatformAdminApi.rejectPayment(id, reason);
          await reloadCurrentView();
        } catch (error) {
          alert(error.message || "Не удалось отклонить заявку");
        }
      });
    });
  }

  function bindOrgOpenActions() {
    content.querySelectorAll("[data-org-open]").forEach((button) => {
      button.addEventListener("click", () => {
        const orgId = button.getAttribute("data-org-open");
        currentView = "organization-detail";
        loadOrganizationDetail(orgId).catch((error) => alert(error.message));
      });
    });
  }

  function bindOrgAdminActions() {
    content.querySelectorAll("[data-org-extend]").forEach((button) => {
      button.addEventListener("click", async () => {
        const orgId = button.getAttribute("data-org-extend");
        const daysRaw = prompt("На сколько дней продлить? (1–365)", "30");
        const days = Number(daysRaw);
        if (!Number.isInteger(days) || days < 1 || days > 365) return;
        const reason = prompt("Причина продления");
        if (!reason?.trim()) return;
        await BooklyPlatformAdminApi.extendSubscription(orgId, days, reason.trim());
        await loadOrganizationDetail(orgId);
      });
    });

    content.querySelectorAll("[data-org-suspend]").forEach((button) => {
      button.addEventListener("click", async () => {
        const orgId = button.getAttribute("data-org-suspend");
        const reason = await BooklyPlatformAdminUI.confirmModal({
          title: "Приостановить организацию?",
          body: "Бизнес-операции будут заблокированы до снятия приостановки.",
          confirmLabel: "Приостановить",
          requireInput: true,
          inputLabel: "Причина",
        });
        if (!reason) return;
        await BooklyPlatformAdminApi.suspendOrganization(orgId, reason);
        await loadOrganizationDetail(orgId);
      });
    });

    content.querySelectorAll("[data-org-unsuspend]").forEach((button) => {
      button.addEventListener("click", async () => {
        const orgId = button.getAttribute("data-org-unsuspend");
        const ok = await BooklyPlatformAdminUI.confirmModal({
          title: "Снять приостановку?",
          body: "Статус подписки будет восстановлен по правилам unsuspend.",
        });
        if (!ok) return;
        await BooklyPlatformAdminApi.unsuspendOrganization(orgId);
        await loadOrganizationDetail(orgId);
      });
    });
  }

  async function reloadCurrentView() {
    if (currentView === "organizations") return loadOrganizations();
    if (currentView === "payments") return loadPayments();
    return loadOverview();
  }

  document.querySelectorAll(".platform-admin__nav button").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelectorAll(".platform-admin__nav button").forEach((el) => {
        el.classList.toggle("is-active", el === button);
      });
      currentView = button.getAttribute("data-view") || "overview";
      try {
        if (currentView === "overview") await loadOverview();
        else if (currentView === "organizations") await loadOrganizations();
        else if (currentView === "payments") await loadPayments();
      } catch (error) {
        content.innerHTML = `<div class="platform-admin__empty">${BooklyPlatformAdminUI.escapeHtml(error.message)}</div>`;
      }
    });
  });

  document.getElementById("admin-logout")?.addEventListener("click", async () => {
    await BooklyAuth.signOut();
    window.location.replace(booklyPath("/login"));
  });

  try {
    const user = await ensureAuth();
    if (!user) return;

    const admin = await ensureAdmin();
    if (!admin) {
      showDenied();
      return;
    }

    showApp();
    await loadOverview();
  } catch (error) {
    console.error(error);
    showDenied();
  }
})();
