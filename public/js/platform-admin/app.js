/**
 * Точка входа глобальной админ-панели Bookly
 */
(async function initPlatformAdmin() {
  const loader = document.getElementById("admin-loader");
  const denied = document.getElementById("admin-denied");
  const deniedTitle = document.getElementById("admin-denied-title");
  const deniedMessage = document.getElementById("admin-denied-message");
  const deniedLogin = document.getElementById("admin-denied-login");
  const deniedRetry = document.getElementById("admin-denied-retry");
  const app = document.getElementById("admin-app");
  const content = document.getElementById("admin-content");
  const pageTitle = document.getElementById("admin-page-title");
  const userEmail = document.getElementById("admin-user-email");

  let currentView = "overview";
  let bootDone = false;

  function hideLoader() {
    if (loader) loader.hidden = true;
    document.body.classList.remove("is-loading");
  }

  function showGate({ title, message, showLogin = false, showRetry = false }) {
    hideLoader();
    if (app) app.hidden = true;
    if (denied) denied.hidden = false;
    if (deniedTitle) deniedTitle.textContent = title;
    if (deniedMessage) deniedMessage.textContent = message;
    if (deniedLogin) {
      deniedLogin.hidden = !showLogin;
      deniedLogin.href = booklyPath("/login") + `?next=${encodeURIComponent(booklyPath("/admin"))}`;
    }
    if (deniedRetry) deniedRetry.hidden = !showRetry;
  }

  function showApp() {
    hideLoader();
    if (denied) denied.hidden = true;
    if (app) app.hidden = false;
  }

  function handleAdminMeError(error) {
    const status = error?.status;
    const code = error?.code;

    if (status === 401) {
      showGate({
        title: "Сессия истекла",
        message: "Сессия истекла, войдите снова.",
        showLogin: true,
      });
      return;
    }

    if (status === 403) {
      showGate({
        title: "Нет доступа",
        message: "Нет доступа к админ-панели.",
      });
      return;
    }

    if (status === 500) {
      showGate({
        title: "Ошибка проверки доступа",
        message: "Ошибка проверки доступа. Попробуйте позже.",
        showRetry: true,
      });
      return;
    }

    if (code === "TIMEOUT") {
      showGate({
        title: "Сервер не отвечает",
        message: "Превышено время ожидания. Проверьте соединение и повторите.",
        showRetry: true,
      });
      return;
    }

    if (code === "NETWORK_ERROR" || status === 0) {
      showGate({
        title: "Ошибка сети",
        message: error?.message || "Не удалось связаться с сервером.",
        showRetry: true,
      });
      return;
    }

    showGate({
      title: "Ошибка проверки доступа",
      message: error?.message || "Не удалось проверить доступ.",
      showRetry: true,
    });
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
    await BooklyAuth.signOut({ redirect: false });
    window.location.replace(booklyPath("/login"));
  });

  deniedRetry?.addEventListener("click", () => {
    window.location.reload();
  });

  async function boot() {
    if (!window.supabase?.createClient) {
      showGate({
        title: "Ошибка загрузки",
        message: "Supabase SDK не загружен. Обновите страницу.",
        showRetry: true,
      });
      return;
    }

    if (!window.BooklyAuth) {
      showGate({
        title: "Ошибка загрузки",
        message: "Модуль авторизации не загружен.",
        showRetry: true,
      });
      return;
    }

    let session = null;
    try {
      session = await BooklyAuth.waitForSession({ timeoutMs: 10000 });
    } catch (error) {
      console.error("[platform-admin] получение session", error?.message || "unknown");
      showGate({
        title: "Ошибка проверки доступа",
        message: "Не удалось получить сессию.",
        showRetry: true,
        showLogin: true,
      });
      return;
    }

    if (!session) {
      showGate({
        title: "Войдите в аккаунт",
        message: "Чтобы открыть админ-панель, войдите в аккаунт Bookly.",
        showLogin: true,
      });
      return;
    }

    if (userEmail) userEmail.textContent = session.user?.email || "";

    let adminPayload = null;
    try {
      adminPayload = await BooklyPlatformAdminApi.me(session.access_token);
    } catch (error) {
      console.error("[platform-admin] запрос /api/admin/me", error?.code || error?.status || "unknown");
      handleAdminMeError(error);
      return;
    }

    if (!adminPayload?.admin) {
      showGate({
        title: "Нет доступа",
        message: "Нет доступа к админ-панели.",
      });
      return;
    }

    showApp();

    try {
      await loadOverview();
    } catch (error) {
      console.error("[platform-admin] загрузка overview", error?.code || error?.status || "unknown");
      content.innerHTML = `<div class="platform-admin__empty">${BooklyPlatformAdminUI.escapeHtml(
        error?.message || "Не удалось загрузить обзор"
      )}</div>`;
    }
  }

  try {
    await boot();
  } catch (error) {
    console.error("[platform-admin] init", error?.message || "unknown");
    showGate({
      title: "Ошибка проверки доступа",
      message: error?.message || "Не удалось открыть админ-панель.",
      showRetry: true,
    });
  } finally {
    bootDone = true;
    hideLoader();
  }

  // safety: если что-то пошло не так до finally
  setTimeout(() => {
    if (!bootDone) hideLoader();
    if (loader && !loader.hidden && app?.hidden && denied?.hidden) {
      showGate({
        title: "Ошибка проверки доступа",
        message: "Проверка доступа заняла слишком много времени.",
        showRetry: true,
      });
    }
  }, 15000);
})();
