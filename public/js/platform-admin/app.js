/**
 * Точка входа глобальной админ-панели Jazyl
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
  const side = document.getElementById("pa-side");
  const overlay = document.getElementById("pa-overlay");

  const UI = BooklyPlatformAdminUI;
  const Api = BooklyPlatformAdminApi;
  const TITLES = { overview: "Главная", organizations: "Салоны", payments: "Платежи", audit: "Журнал", organization: "Салон" };

  const state = {
    view: "overview",
    segment: "all",
    search: "",
    payStatus: "pending",
    orgId: null,
    detail: null,
  };
  let bootDone = false;

  // ---------------------------------------------------------------------------
  // Доступ
  // ---------------------------------------------------------------------------

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

  function handleAdminMeError(error) {
    const status = error?.status;
    if (status === 401) return showGate({ title: "Сессия истекла", message: "Войдите снова.", showLogin: true });
    if (status === 403) {
      return showGate({
        title: "Нет доступа",
        message: "Этот аккаунт не администратор платформы. Войдите под аккаунтом администратора.",
        showLogin: true,
      });
    }
    if (error?.code === "TIMEOUT") {
      return showGate({ title: "Сервер не отвечает", message: "Проверьте соединение и повторите.", showRetry: true });
    }
    return showGate({
      title: "Ошибка проверки доступа",
      message: error?.message || "Не удалось проверить доступ.",
      showRetry: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Окно подтверждения / ввода
  // ---------------------------------------------------------------------------

  const modal = {
    root: document.getElementById("pa-modal"),
    title: document.getElementById("pa-modal-title"),
    body: document.getElementById("pa-modal-body"),
    error: document.getElementById("pa-modal-error"),
    ok: document.getElementById("pa-modal-ok"),
  };
  let modalSubmit = null;

  function openModal({ title, bodyHtml, okLabel = "Подтвердить", danger = false, onSubmit }) {
    modal.title.textContent = title;
    modal.body.innerHTML = bodyHtml;
    modal.error.hidden = true;
    modal.ok.textContent = okLabel;
    modal.ok.disabled = false;
    modal.ok.classList.toggle("pa-btn-danger", danger);
    modalSubmit = onSubmit;
    modal.root.hidden = false;
    modal.body.querySelector("input, textarea")?.focus();
  }

  function closeModal() {
    modal.root.hidden = true;
    modalSubmit = null;
  }

  modal.root.addEventListener("click", (event) => {
    if (event.target === modal.root || event.target.closest("[data-modal-cancel]")) closeModal();
    const preset = event.target.closest("[data-days]");
    if (preset) {
      modal.body.querySelector("#pa-days").value = preset.dataset.days;
      modal.body.querySelectorAll("[data-days]").forEach((b) => b.classList.toggle("is-active", b === preset));
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.root.hidden) closeModal();
  });

  modal.ok.addEventListener("click", async () => {
    if (!modalSubmit) return;
    modal.error.hidden = true;
    modal.ok.disabled = true;
    try {
      await modalSubmit(modal.body);
      closeModal();
    } catch (error) {
      modal.error.textContent = error.message || "Не удалось выполнить действие";
      modal.error.hidden = false;
      modal.ok.disabled = false;
    }
  });

  function fieldValue(root, selector) {
    return String(root.querySelector(selector)?.value || "").trim();
  }

  function requireText(value, message) {
    if (!value) throw new Error(message);
    return value;
  }

  // ---------------------------------------------------------------------------
  // Разделы
  // ---------------------------------------------------------------------------

  function setView(view) {
    state.view = view;
    pageTitle.textContent = TITLES[view] || "";
    const navView = view === "organization" ? "organizations" : view;
    document.querySelectorAll(".pa-nav__link").forEach((el) => el.classList.toggle("is-active", el.dataset.view === navView));
    side.classList.remove("is-open");
    overlay.hidden = true;
    window.scrollTo({ top: 0 });
  }

  function loading() {
    content.innerHTML = `<p class="pa-empty">Загрузка…</p>`;
  }

  function showError(error) {
    content.innerHTML = `<section class="pa-card"><p class="pa-empty">${UI.escapeHtml(error?.message || "Не удалось загрузить данные")}</p></section>`;
  }

  function updateNavCounts(overview) {
    const orgs = document.getElementById("pa-count-orgs");
    const pay = document.getElementById("pa-count-payments");
    if (orgs) orgs.textContent = overview.organizations.total || "";
    if (pay) {
      pay.textContent = overview.payments.pending || "";
      pay.hidden = !overview.payments.pending;
    }
  }

  async function loadOverview() {
    setView("overview");
    loading();
    const { overview } = await Api.overview();
    updateNavCounts(overview);
    content.innerHTML = UI.renderOverview(overview);
  }

  async function loadOrganizations() {
    setView("organizations");
    const first = await Api.organizations({ segment: state.segment, search: state.search, limit: 200 });
    content.innerHTML = UI.renderOrganizationsView({ counts: first.counts, segment: state.segment, search: state.search });
    document.getElementById("pa-org-table").innerHTML = UI.renderOrganizationsTable(first.items || []);

    const search = document.getElementById("pa-org-search");
    let timer = null;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        state.search = search.value;
        const payload = await Api.organizations({ segment: state.segment, search: state.search, limit: 200 });
        document.getElementById("pa-org-table").innerHTML = UI.renderOrganizationsTable(payload.items || []);
      }, 250);
    });
    document.getElementById("pa-segments").addEventListener("click", (event) => {
      const button = event.target.closest("[data-segment]");
      if (!button) return;
      state.segment = button.dataset.segment;
      loadOrganizations().catch(showError);
    });
  }

  async function loadOrganization(orgId) {
    state.orgId = orgId;
    setView("organization");
    loading();
    const detail = await Api.organization(orgId);
    state.detail = detail;
    pageTitle.textContent = detail.organization?.public_name || detail.organization?.name || "Салон";
    content.innerHTML = UI.renderOrganizationDetail(detail);
  }

  async function loadPayments() {
    setView("payments");
    content.innerHTML = UI.renderPaymentsView(state.payStatus);
    const payload = await Api.paymentRequests({ status: state.payStatus, limit: 100 });
    document.getElementById("pa-pay-table").innerHTML = UI.renderPaymentsTable(payload.items || []);
    document.getElementById("pa-pay-status").addEventListener("click", (event) => {
      const button = event.target.closest("[data-pay-status]");
      if (!button) return;
      state.payStatus = button.dataset.payStatus;
      loadPayments().catch(showError);
    });
  }

  async function loadAudit() {
    setView("audit");
    loading();
    const { items } = await Api.audit(150);
    content.innerHTML = UI.renderAuditView(items || []);
  }

  function reload() {
    const loaders = {
      overview: loadOverview,
      organizations: loadOrganizations,
      payments: loadPayments,
      audit: loadAudit,
      organization: () => loadOrganization(state.orgId),
    };
    return (loaders[state.view] || loadOverview)().catch(showError);
  }

  // ---------------------------------------------------------------------------
  // Действия
  // ---------------------------------------------------------------------------

  function extendPro(orgId) {
    openModal({
      title: "Выдать Pro",
      okLabel: "Выдать",
      bodyHtml: `
        <p class="pa-muted">Pro включится сразу (или продлится, если уже есть). Действие попадёт в журнал.</p>
        <div class="pa-presets">
          ${[14, 30, 90, 365].map((d) => `<button type="button" class="pa-seg__item ${d === 30 ? "is-active" : ""}" data-days="${d}">${d} дн.</button>`).join("")}
        </div>
        <label class="field"><span class="field__label">Дней (1–365)</span><input class="field__input" id="pa-days" type="number" min="1" max="365" value="30"></label>
        <label class="field"><span class="field__label">Причина</span><input class="field__input" id="pa-reason" maxlength="500" placeholder="Например: тестовый салон, подарок, компенсация"></label>`,
      onSubmit: async (root) => {
        const days = Number(fieldValue(root, "#pa-days"));
        if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Укажите от 1 до 365 дней.");
        const reason = requireText(fieldValue(root, "#pa-reason"), "Укажите причину — она попадёт в журнал.");
        await Api.extendSubscription(orgId, days, reason);
        await reload();
      },
    });
  }

  function suspendOrg(orgId) {
    openModal({
      title: "Приостановить салон?",
      okLabel: "Приостановить",
      danger: true,
      bodyHtml: `
        <p class="pa-muted">Салон не сможет создавать и менять записи, онлайн-запись перестанет работать. Данные сохранятся, вернуть можно в любой момент.</p>
        <label class="field"><span class="field__label">Причина</span><input class="field__input" id="pa-reason" maxlength="500" placeholder="Например: жалобы, мошенничество"></label>`,
      onSubmit: async (root) => {
        await Api.suspendOrganization(orgId, requireText(fieldValue(root, "#pa-reason"), "Укажите причину."));
        await reload();
      },
    });
  }

  function unsuspendOrg(orgId) {
    openModal({
      title: "Вернуть салон?",
      okLabel: "Вернуть",
      bodyHtml: `<p class="pa-muted">Салон снова сможет работать, тариф вернётся к тому, что был до приостановки.</p>`,
      onSubmit: async () => {
        await Api.unsuspendOrganization(orgId);
        await reload();
      },
    });
  }

  function approvePayment(id) {
    openModal({
      title: "Подтвердить оплату?",
      okLabel: "Подтвердить",
      bodyHtml: `
        <p class="pa-muted">Проверьте поступление в Kaspi. Pro продлится на оплаченное количество месяцев.</p>
        <label class="field"><span class="field__label">Комментарий (необязательно)</span><input class="field__input" id="pa-note" maxlength="500"></label>`,
      onSubmit: async (root) => {
        await Api.approvePayment(id, fieldValue(root, "#pa-note") || null);
        await reload();
      },
    });
  }

  function rejectPayment(id) {
    openModal({
      title: "Отклонить заявку?",
      okLabel: "Отклонить",
      danger: true,
      bodyHtml: `
        <p class="pa-muted">Тариф не изменится. Причину увидит владелец салона.</p>
        <label class="field"><span class="field__label">Причина</span><input class="field__input" id="pa-note" maxlength="500" placeholder="Например: перевод не найден"></label>`,
      onSubmit: async (root) => {
        await Api.rejectPayment(id, requireText(fieldValue(root, "#pa-note"), "Укажите причину отказа."));
        await reload();
      },
    });
  }

  function editOrg(orgId) {
    const detail = state.detail || {};
    openModal({
      title: "Редактировать салон",
      okLabel: "Сохранить",
      bodyHtml: UI.renderEditForm(detail.organization || {}, detail.stats || {}),
      onSubmit: async (root) => {
        await Api.updateOrganization(orgId, {
          public_name: fieldValue(root, "#pa-edit-public-name"),
          name: fieldValue(root, "#pa-edit-name"),
          slug: fieldValue(root, "#pa-edit-slug"),
          business_type: fieldValue(root, "#pa-edit-type"),
          phone: fieldValue(root, "#pa-edit-phone"),
          address: fieldValue(root, "#pa-edit-address"),
          public_booking_enabled: root.querySelector("#pa-edit-online").checked,
        });
        await reload();
      },
    });
  }

  /** Показать одноразовую ссылку (вход / пароль) с кнопками «Открыть» и «Скопировать». */
  function showLink({ title, text, link, openLabel }) {
    openModal({
      title,
      okLabel: "Готово",
      bodyHtml: `
        <p class="pa-muted">${text}</p>
        <input class="field__input" id="pa-link" readonly value="${UI.escapeHtml(link)}">
        <div class="pa-presets">
          <button class="btn btn--outline btn--sm" type="button" id="pa-link-copy">Скопировать</button>
          ${openLabel ? `<a class="btn btn--outline btn--sm" href="${UI.escapeHtml(link)}" target="_blank" rel="noopener">${openLabel}</a>` : ""}
        </div>`,
      onSubmit: async () => {},
    });
    document.getElementById("pa-link-copy")?.addEventListener("click", async (event) => {
      try {
        await navigator.clipboard.writeText(link);
        event.target.textContent = "Скопировано ✓";
      } catch {
        document.getElementById("pa-link").select();
      }
    });
  }

  function loginAsOwner(orgId) {
    openModal({
      title: "Войти как владелец?",
      okLabel: "Получить ссылку",
      bodyHtml: `
        <p class="pa-muted">Бот создаст одноразовую ссылку входа в кабинет этого салона. У вас будут <b>все права владельца</b> — действуйте аккуратно. Вход попадёт в журнал.</p>
        <p class="pa-warn">Откройте ссылку в окне <b>инкогнито</b> (Ctrl+Shift+N). В этом же окне вы выйдете из админки.</p>`,
      onSubmit: async () => {
        const { link, email } = await Api.loginLink(orgId);
        setTimeout(
          () =>
            showLink({
              title: "Ссылка для входа",
              text: `Вход в кабинет ${UI.escapeHtml(email)}. Ссылка одноразовая и действует ограниченное время. Скопируйте и откройте в окне инкогнито.`,
              link,
            }),
          0
        );
      },
    });
  }

  function changeOwnerEmail(orgId) {
    openModal({
      title: "Сменить почту владельца",
      okLabel: "Сменить",
      bodyHtml: `
        <p class="pa-muted">Владелец будет входить с новой почтой. Почта сразу считается подтверждённой — убедитесь, что она правильная.</p>
        <label class="field"><span class="field__label">Новая почта</span><input class="field__input" id="pa-new-email" type="email" placeholder="owner@mail.kz"></label>`,
      onSubmit: async (root) => {
        await Api.changeOwnerEmail(orgId, requireText(fieldValue(root, "#pa-new-email"), "Укажите почту."));
        await reload();
      },
    });
  }

  async function ownerPassword(orgId) {
    try {
      const { link, email } = await Api.ownerPasswordLink(orgId);
      showLink({
        title: "Ссылка для нового пароля",
        text: `Отправьте её владельцу (${UI.escapeHtml(email)}) в WhatsApp или Telegram — по ней он задаст новый пароль. Ссылка одноразовая.`,
        link,
      });
      await reload();
    } catch (error) {
      alert(error.message || "Не удалось создать ссылку");
    }
  }

  function blockOwner(orgId) {
    openModal({
      title: "Заблокировать вход владельцу?",
      okLabel: "Заблокировать",
      danger: true,
      bodyHtml: `
        <p class="pa-muted">Владелец не сможет войти в кабинет. Салон и онлайн-запись продолжат работать — чтобы остановить и их, используйте «Приостановить».</p>
        <label class="field"><span class="field__label">Причина</span><input class="field__input" id="pa-reason" maxlength="500"></label>`,
      onSubmit: async (root) => {
        await Api.blockOwner(orgId, requireText(fieldValue(root, "#pa-reason"), "Укажите причину."));
        await reload();
      },
    });
  }

  function unblockOwner(orgId) {
    openModal({
      title: "Разблокировать вход?",
      okLabel: "Разблокировать",
      bodyHtml: `<p class="pa-muted">Владелец снова сможет войти в кабинет.</p>`,
      onSubmit: async () => {
        await Api.unblockOwner(orgId);
        await reload();
      },
    });
  }

  function revokePro(orgId) {
    openModal({
      title: "Забрать Pro?",
      okLabel: "Перевести на Free",
      danger: true,
      bodyHtml: `
        <p class="pa-muted">Салон сразу перейдёт на Free. Если активных мастеров больше 5 — самые новые встанут на паузу (данные сохранятся).</p>
        <label class="field"><span class="field__label">Причина</span><input class="field__input" id="pa-reason" maxlength="500" placeholder="Например: возврат оплаты, ошибочная выдача"></label>`,
      onSubmit: async (root) => {
        await Api.revokePro(orgId, requireText(fieldValue(root, "#pa-reason"), "Укажите причину."));
        await reload();
      },
    });
  }

  function deleteOrg(orgId, slug) {
    openModal({
      title: "Удалить салон навсегда?",
      okLabel: "Удалить навсегда",
      danger: true,
      bodyHtml: `
        <p class="pa-muted">Удалятся услуги, мастера, графики, все записи, клиенты и оплаты салона. <b>Отменить нельзя.</b></p>
        <label class="pa-check"><input type="checkbox" id="pa-delete-owner"> Удалить и аккаунт владельца (он не сможет войти)</label>
        <label class="field"><span class="field__label">Для подтверждения введите адрес страницы: <b>${UI.escapeHtml(slug)}</b></span><input class="field__input" id="pa-confirm-slug" autocomplete="off"></label>`,
      onSubmit: async (root) => {
        const typed = fieldValue(root, "#pa-confirm-slug");
        if (typed.toLowerCase() !== String(slug).toLowerCase()) throw new Error("Адрес страницы введён неверно.");
        await Api.deleteOrganization(orgId, typed, root.querySelector("#pa-delete-owner").checked);
        state.view = "organizations";
        await reload();
      },
    });
  }

  const ACTIONS = {
    orgEdit: editOrg,
    orgLogin: loginAsOwner,
    orgRevoke: revokePro,
    ownerEmail: changeOwnerEmail,
    ownerPassword,
    ownerBlock: blockOwner,
    ownerUnblock: unblockOwner,
  };

  content.addEventListener("click", (event) => {
    const extra = event.target.closest(
      "[data-org-edit], [data-org-login], [data-org-revoke], [data-owner-email], [data-owner-password], [data-owner-block], [data-owner-unblock], [data-org-delete]"
    );
    if (extra) {
      if (extra.dataset.orgDelete) return deleteOrg(extra.dataset.orgDelete, extra.dataset.orgSlug || "");
      const key = Object.keys(ACTIONS).find((k) => extra.dataset[k]);
      if (key) return ACTIONS[key](extra.dataset[key]);
    }
  });

  content.addEventListener("click", (event) => {
    const target = event.target.closest(
      "[data-org-open], [data-goto-view], [data-goto-segment], [data-org-extend], [data-org-suspend], [data-org-unsuspend], [data-payment-approve], [data-payment-reject]"
    );
    if (!target) return;

    if (target.dataset.orgOpen) return loadOrganization(target.dataset.orgOpen).catch(showError);
    if (target.dataset.gotoSegment) {
      state.segment = target.dataset.gotoSegment;
      return loadOrganizations().catch(showError);
    }
    if (target.dataset.gotoView) {
      state.view = target.dataset.gotoView;
      return reload();
    }
    if (target.dataset.orgExtend) return extendPro(target.dataset.orgExtend);
    if (target.dataset.orgSuspend) return suspendOrg(target.dataset.orgSuspend);
    if (target.dataset.orgUnsuspend) return unsuspendOrg(target.dataset.orgUnsuspend);
    if (target.dataset.paymentApprove) return approvePayment(target.dataset.paymentApprove);
    if (target.dataset.paymentReject) return rejectPayment(target.dataset.paymentReject);
  });

  document.querySelectorAll(".pa-nav__link").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      if (state.view === "organizations") state.segment = "all";
      reload();
    });
  });

  document.getElementById("pa-refresh")?.addEventListener("click", reload);
  document.getElementById("pa-burger")?.addEventListener("click", () => {
    side.classList.add("is-open");
    overlay.hidden = false;
  });
  overlay?.addEventListener("click", () => {
    side.classList.remove("is-open");
    overlay.hidden = true;
  });

  document.getElementById("admin-logout")?.addEventListener("click", async () => {
    await BooklyAuth.signOut({ redirect: false });
    window.location.replace(booklyPath("/login") + `?next=${encodeURIComponent(booklyPath("/admin"))}`);
  });

  deniedRetry?.addEventListener("click", () => window.location.reload());

  // ---------------------------------------------------------------------------
  // Запуск
  // ---------------------------------------------------------------------------

  async function boot() {
    if (!window.supabase?.createClient || !window.BooklyAuth) {
      showGate({ title: "Ошибка загрузки", message: "Не удалось загрузить страницу. Обновите её.", showRetry: true });
      return;
    }

    let session = null;
    try {
      session = await BooklyAuth.waitForSession({ timeoutMs: 10000 });
    } catch (error) {
      console.error("[platform-admin] session", error?.message || "unknown");
      showGate({ title: "Ошибка проверки доступа", message: "Не удалось получить сессию.", showRetry: true, showLogin: true });
      return;
    }

    if (!session) {
      showGate({ title: "Войдите в аккаунт", message: "Чтобы открыть админ-панель, войдите в аккаунт Jazyl.", showLogin: true });
      return;
    }

    if (userEmail) userEmail.textContent = session.user?.email || "";

    let adminPayload = null;
    try {
      adminPayload = await Api.me(session.access_token);
    } catch (error) {
      console.error("[platform-admin] /api/admin/me", error?.code || error?.status || "unknown");
      handleAdminMeError(error);
      return;
    }

    if (!adminPayload?.admin) {
      showGate({ title: "Нет доступа", message: "Нет доступа к админ-панели.", showLogin: true });
      return;
    }

    hideLoader();
    denied.hidden = true;
    app.hidden = false;
    await loadOverview().catch(showError);
  }

  try {
    await boot();
  } catch (error) {
    console.error("[platform-admin] init", error?.message || "unknown");
    showGate({ title: "Ошибка проверки доступа", message: error?.message || "Не удалось открыть админ-панель.", showRetry: true });
  } finally {
    bootDone = true;
    hideLoader();
  }

  setTimeout(() => {
    if (!bootDone) hideLoader();
    if (loader && !loader.hidden && app?.hidden && denied?.hidden) {
      showGate({ title: "Ошибка проверки доступа", message: "Проверка доступа заняла слишком много времени.", showRetry: true });
    }
  }, 15000);
})();
