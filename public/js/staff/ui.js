/**
 * Jazyl — раздел «Сотрудники»
 */
window.BooklyStaffUI = (() => {
  let organization = null;
  let staffList = [];
  let orgServices = [];
  let editingId = null;
  let deleteTargetId = null;

  const els = {};

  function cacheElements() {
    els.section = document.getElementById("staff-section");
    els.list = document.getElementById("staff-list");
    els.empty = document.getElementById("staff-empty");
    els.search = document.getElementById("staff-search");
    els.filter = document.getElementById("staff-filter");
    els.addBtn = document.getElementById("staff-add-btn");
    els.limit = document.getElementById("staff-limit");
    els.activeCount = document.getElementById("dashboard-active-staff");
    els.formModal = document.getElementById("staff-modal");
    els.form = document.getElementById("staff-form");
    els.formTitle = document.getElementById("staff-modal-title");
    els.formError = document.getElementById("staff-form-error");
    els.formSubmit = document.getElementById("staff-form-submit");
    els.servicesPicker = document.getElementById("staff-services-picker");
    els.deleteModal = document.getElementById("delete-staff-modal");
    els.deleteName = document.getElementById("delete-staff-name");
    els.deleteConfirm = document.getElementById("delete-staff-confirm");
    els.inviteModal = document.getElementById("telegram-invite-modal");
    els.inviteText = document.getElementById("telegram-invite-text");
    els.inviteLink = document.getElementById("telegram-invite-link");
    els.inviteHint = document.getElementById("telegram-invite-hint");
    els.inviteWhatsApp = document.getElementById("telegram-invite-whatsapp");
    els.inviteCopy = document.getElementById("telegram-invite-copy");
    els.inviteSelf = document.getElementById("telegram-invite-self");
  }

  function init(org) {
    organization = org;
    cacheElements();
    if (!els.section) return;

    els.addBtn?.addEventListener("click", handleAddClick);
    BooklySubscription.onEntitlementsChange(renderLimit);
    els.search?.addEventListener("input", renderList);
    els.filter?.addEventListener("change", renderList);
    els.form?.addEventListener("submit", handleFormSubmit);
    BooklyMedia.bindPhotoField(els.form?.querySelector("[data-photo-field]"), "staff", () => organization.id);
    els.deleteConfirm?.addEventListener("click", handleDeleteConfirm);

    els.formModal?.addEventListener("click", (event) => {
      if (event.target === els.formModal) closeModals();
    });

    els.deleteModal?.addEventListener("click", (event) => {
      if (event.target === els.deleteModal) closeModals();
    });

    els.inviteModal?.addEventListener("click", (event) => {
      if (event.target === els.inviteModal) closeModals();
    });
    els.inviteCopy?.addEventListener("click", copyInviteLink);
    els.inviteSelf?.addEventListener("click", connectSelf);
    els.inviteWhatsApp?.addEventListener("click", () => refreshStaffOnReturn());
    els.inviteLink?.addEventListener("focus", () => els.inviteLink.select());

    document.querySelectorAll("[data-close-staff-modal]").forEach((btn) => {
      btn.addEventListener("click", closeModals);
    });

    loadStaff();
  }

  async function loadOrgServices() {
    try {
      orgServices = await BooklyServices.list(organization.id);
    } catch (error) {
      BooklyAuthErrors.logError("staff:services", error);
      orgServices = [];
    }
  }

  async function loadStaff() {
    try {
      await loadOrgServices();
      staffList = await BooklyStaff.list(organization.id);
      updateDashboardCount();
      renderList();
      if (els.empty) {
        els.empty.hidden = staffList.length > 0;
        if (staffList.length === 0) {
          els.empty.textContent = "Сотрудников пока нет. Добавьте первого сотрудника для вашей компании.";
        }
      }
    } catch (error) {
      BooklyAuthErrors.logError("staff:load", error);
      if (els.list) els.list.innerHTML = "";
      if (els.empty) {
        els.empty.hidden = false;
        els.empty.textContent =
          error.message || "Не удалось загрузить сотрудников. Проверьте подключение и миграцию базы данных.";
      }
    }
  }

  function updateDashboardCount() {
    if (els.activeCount) {
      els.activeCount.textContent = String(BooklyStaff.countActive(staffList));
    }
    renderLimit();
  }

  /** Лимит активных мастеров на Free (null — без лимита, Pro). */
  function getStaffLimit() {
    const plan = BooklySubscription.getEntitlements();
    if (!plan || plan.is_pro) return null;
    return plan.staff_limit;
  }

  function isAtStaffLimit() {
    const limit = getStaffLimit();
    return limit != null && BooklyStaff.countActive(staffList) >= limit;
  }

  function renderLimit() {
    if (!els.limit) return;
    const limit = getStaffLimit();
    if (limit == null) {
      els.limit.hidden = true;
      return;
    }
    const active = BooklyStaff.countActive(staffList);
    els.limit.hidden = false;
    els.limit.textContent = `Активных мастеров: ${active} из ${limit} на Free`;
    els.limit.classList.toggle("staff-limit--full", active >= limit);
  }

  function offerPro(message) {
    const goToPlans = window.confirm(`${message}\n\nОткрыть «Тариф и оплата»?`);
    if (goToPlans) BooklyAppShell.open("subscription");
  }

  function handleAddClick() {
    if (isAtStaffLimit()) {
      offerPro(
        `На тарифе Free можно держать до ${getStaffLimit()} активных мастеров. ` +
          "Отключите одного из мастеров или подключите Pro — без лимита."
      );
      return;
    }
    openForm();
  }

  function isStaffLimitError(error) {
    return String(error?.message || "").includes("STAFF_LIMIT_REACHED");
  }

  function getFilteredStaff() {
    const query = String(els.search?.value || "").trim().toLowerCase();
    const filter = String(els.filter?.value || "all");

    return staffList.filter((item) => {
      const matchesSearch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        String(item.position || "").toLowerCase().includes(query);

      const matchesFilter =
        filter === "all" ||
        (filter === "active" && item.is_active) ||
        (filter === "inactive" && !item.is_active);

      return matchesSearch && matchesFilter;
    });
  }

  function renderList() {
    const filtered = getFilteredStaff();

    if (!els.list || !els.empty) return;

    if (filtered.length === 0) {
      els.list.innerHTML = "";
      els.empty.hidden = false;
      const hasStaff = staffList.length > 0;
      els.empty.textContent = hasStaff
        ? "Ничего не найдено. Измените поиск или фильтр."
        : "Сотрудников пока нет. Добавьте первого сотрудника для вашей компании.";
      return;
    }

    els.empty.hidden = true;
    els.list.innerHTML = filtered
      .map((item) => {
        const statusClass = item.is_active ? "staff-card--active" : "staff-card--inactive";
        const statusLabel = item.is_active ? "Активен" : "Неактивен";
        const serviceCount = BooklyStaff.getServiceCount(item);
        const serviceLabel = pluralServices(serviceCount);

        return `
          <article class="staff-card ${statusClass}" data-id="${item.id}">
            <div class="staff-card__main">
              <div class="staff-card__header">
                <h3 class="staff-card__name">${escapeHtml(item.name)}</h3>
                <span class="staff-card__badge ${item.is_active ? "staff-card__badge--on" : "staff-card__badge--off"}">${statusLabel}</span>
                ${item.telegram_chat_id ? `<span class="staff-card__badge staff-card__badge--telegram" title="Уведомления о новых записях приходят в Telegram">Telegram</span>` : ""}
              </div>
              ${item.position ? `<p class="staff-card__position">${escapeHtml(item.position)}</p>` : ""}
              ${item.description ? `<p class="staff-card__desc">${escapeHtml(item.description)}</p>` : ""}
              <div class="staff-card__meta">
                ${item.phone ? `<span>${escapeHtml(item.phone)}</span>` : ""}
                ${item.phone && item.email ? `<span class="staff-card__dot" aria-hidden="true">·</span>` : ""}
                ${item.email ? `<span>${escapeHtml(item.email)}</span>` : ""}
                ${(item.phone || item.email) ? `<span class="staff-card__dot" aria-hidden="true">·</span>` : ""}
                <span>${serviceCount} ${serviceLabel}</span>
              </div>
            </div>
            <div class="staff-card__actions">
              <label class="toggle" title="${item.is_active ? "Отключить" : "Включить"}">
                <input type="checkbox" class="toggle__input" data-action="toggle" data-id="${item.id}" ${item.is_active ? "checked" : ""}>
                <span class="toggle__track"></span>
              </label>
              ${telegramButton(item)}
              <button class="btn btn--ghost btn--sm" type="button" data-action="schedule" data-id="${item.id}">График</button>
              <button class="btn btn--ghost btn--sm" type="button" data-action="edit" data-id="${item.id}">Изменить</button>
              <button class="btn btn--ghost btn--sm staff-card__delete" type="button" data-action="delete" data-id="${item.id}">Удалить</button>
            </div>
          </article>
        `;
      })
      .join("");

    els.list.querySelectorAll("[data-action='edit'], [data-action='delete'], [data-action='schedule'], [data-action='telegram']").forEach((btn) => {
      btn.addEventListener("click", handleCardAction);
    });

    els.list.querySelectorAll("[data-action='toggle']").forEach((input) => {
      input.addEventListener("change", handleToggle);
    });
  }

  function telegramButton(item) {
    if (item.telegram_chat_id) {
      return `<button class="btn btn--ghost btn--sm" type="button" data-action="telegram" data-id="${item.id}" title="Отключить Telegram-уведомления">Отключить Telegram</button>`;
    }
    if (!getTelegramBotUsername()) return "";
    return `<button class="btn btn--ghost btn--sm" type="button" data-action="telegram" data-id="${item.id}" title="Отправить мастеру ссылку на уведомления о записях">Подключить Telegram</button>`;
  }

  function pluralServices(count) {
    const n = Math.abs(count) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return "услуг";
    if (n1 > 1 && n1 < 5) return "услуги";
    if (n1 === 1) return "услуга";
    return "услуг";
  }

  async function handleCardAction(event) {
    const action = event.currentTarget.dataset.action;
    const id = event.currentTarget.dataset.id;
    const member = staffList.find((item) => item.id === id);
    if (!member) return;

    if (action === "telegram") {
      await handleTelegram(member, event.currentTarget);
      return;
    }

    if (action === "edit") {
      await openForm(member);
      return;
    }

    if (action === "schedule") {
      BooklyScheduleUI.open(member);
      return;
    }

    if (action === "delete") {
      openDeleteModal(member);
    }
  }

  function getTelegramBotUsername() {
    return String(window.BooklyConfig?.telegramBotUsername || "");
  }

  async function handleTelegram(member, button) {
    if (member.telegram_chat_id) {
      const confirmed = window.confirm(
        `Отключить Telegram-уведомления для «${member.name}»?`
      );
      if (!confirmed) return;

      try {
        button.disabled = true;
        const updated = await BooklyStaff.unlinkTelegram(member.id);
        staffList = staffList.map((item) => (item.id === member.id ? updated : item));
        renderList();
      } catch (error) {
        BooklyAuthErrors.logError("staff:telegram-unlink", error);
        alert(error.message || "Не удалось отключить Telegram.");
      } finally {
        button.disabled = false;
      }
      return;
    }

    const botUsername = getTelegramBotUsername();
    if (!botUsername) {
      alert("Telegram-бот не настроен. Обратитесь в поддержку.");
      return;
    }

    if (!member.telegram_link_token) {
      alert("Ссылка привязки не найдена. Обновите страницу.");
      return;
    }

    openInviteModal(member);
  }

  let inviteMember = null;

  function getInviteLink(member) {
    return `https://t.me/${encodeURIComponent(getTelegramBotUsername())}?start=${encodeURIComponent(member.telegram_link_token)}`;
  }

  /** Номер для wa.me: только цифры, казахстанские 8XXXXXXXXXX → 7XXXXXXXXXX. */
  function toWhatsAppNumber(phone) {
    let digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
    if (digits.length === 10) digits = `7${digits}`;
    return digits.length >= 11 && digits.length <= 15 ? digits : "";
  }

  function buildInviteMessage(member, link) {
    const orgName = organization?.public_name || organization?.name || "Jazyl";
    return (
      `Здравствуйте, ${member.name}! Подключите уведомления о ваших записях в «${orgName}». ` +
      `Откройте ссылку и нажмите Start в Telegram-боте: ${link}`
    );
  }

  function openInviteModal(member, { justCreated = false } = {}) {
    if (!els.inviteModal) return;
    inviteMember = member;

    const link = getInviteLink(member);
    const message = buildInviteMessage(member, link);
    const waNumber = toWhatsAppNumber(member.phone);

    if (els.inviteText) {
      els.inviteText.textContent = justCreated
        ? `Мастер «${member.name}» добавлен. Отправьте ему ссылку — и записи к нему будут приходить ему в Telegram.`
        : `Записи к мастеру «${member.name}» будут приходить в тот Telegram, где нажмут Start по этой ссылке.`;
    }
    if (els.inviteLink) els.inviteLink.value = link;

    if (els.inviteWhatsApp) {
      els.inviteWhatsApp.href = waNumber
        ? `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`
        : `https://wa.me/?text=${encodeURIComponent(message)}`;
      els.inviteWhatsApp.textContent = waNumber ? "Отправить в WhatsApp" : "Выбрать чат в WhatsApp";
    }
    if (els.inviteHint) {
      els.inviteHint.hidden = Boolean(waNumber);
      els.inviteHint.textContent = waNumber
        ? ""
        : "Телефон мастера не указан — WhatsApp предложит выбрать чат. Номер можно добавить в «Изменить».";
    }
    if (els.inviteCopy) els.inviteCopy.textContent = "Скопировать ссылку";

    els.inviteModal.classList.add("is-open");
    els.inviteModal.setAttribute("aria-hidden", "false");
  }

  async function copyInviteLink() {
    if (!inviteMember || !els.inviteCopy) return;
    const text = buildInviteMessage(inviteMember, getInviteLink(inviteMember));
    try {
      await navigator.clipboard.writeText(text);
      els.inviteCopy.textContent = "Скопировано ✓";
    } catch {
      els.inviteLink?.focus();
      els.inviteCopy.textContent = "Скопируйте вручную";
    }
    refreshStaffOnReturn();
  }

  function connectSelf() {
    if (!inviteMember) return;
    window.open(getInviteLink(inviteMember), "_blank", "noopener");
    closeModals();
    refreshStaffOnReturn();
  }

  /** После привязки в Telegram токен меняется — обновим список, когда вкладка вернётся в фокус. */
  function refreshStaffOnReturn() {
    window.addEventListener("focus", () => loadStaff(), { once: true });
  }

  async function handleToggle(event) {
    const input = event.currentTarget;
    const id = input.dataset.id;
    const member = staffList.find((item) => item.id === id);
    if (!member) return;

    const nextValue = input.checked;

    try {
      input.disabled = true;
      const updated = await BooklyStaff.setActive(id, nextValue);
      staffList = staffList.map((item) => (item.id === id ? updated : item));
      updateDashboardCount();
      renderList();
    } catch (error) {
      input.checked = !nextValue;
      BooklyAuthErrors.logError("staff:toggle", error);
      const message =
        BooklySubscription.mapDbError(error) || error.message || "Не удалось изменить статус сотрудника.";
      if (isStaffLimitError(error)) {
        offerPro(message);
      } else {
        alert(message);
      }
    } finally {
      input.disabled = false;
    }
  }

  function renderServicesPicker(selectedIds = []) {
    if (!els.servicesPicker) return;

    if (!orgServices.length) {
      els.servicesPicker.innerHTML =
        '<p class="staff-services-picker__empty">Сначала добавьте услуги в разделе «Услуги».</p>';
      return;
    }

    const selected = new Set(selectedIds);
    els.servicesPicker.innerHTML = orgServices
      .map(
        (service) => `
        <label class="field field--checkbox staff-services-picker__item">
          <input type="checkbox" name="service_ids" value="${service.id}" ${selected.has(service.id) ? "checked" : ""}>
          <span>${escapeHtml(service.name)}</span>
        </label>
      `
      )
      .join("");
  }

  function getSelectedServiceIds() {
    if (!els.form) return [];
    return Array.from(els.form.querySelectorAll('input[name="service_ids"]:checked')).map(
      (input) => input.value
    );
  }

  async function openForm(member = null) {
    editingId = member?.id || null;
    hideFormError();
    els.form?.reset();
    await loadOrgServices();

    if (els.formTitle) {
      els.formTitle.textContent = member ? "Редактировать сотрудника" : "Добавить сотрудника";
    }

    if (els.formSubmit) {
      els.formSubmit.textContent = member ? "Сохранить" : "Добавить";
    }

    let selectedServiceIds = [];
    if (member) {
      selectedServiceIds = await BooklyStaff.getServiceIds(member.id);
    }

    renderServicesPicker(selectedServiceIds);

    if (member && els.form) {
      els.form.elements.namedItem("name").value = member.name || "";
      els.form.elements.namedItem("position").value = member.position || "";
      els.form.elements.namedItem("phone").value = member.phone || "";
      els.form.elements.namedItem("email").value = member.email || "";
      els.form.elements.namedItem("description").value = member.description || "";
      els.form.elements.namedItem("is_active").checked = member.is_active !== false;
    } else if (els.form) {
      els.form.elements.namedItem("is_active").checked = true;
    }
    BooklyMedia.setPhotoField(els.form?.querySelector("[data-photo-field]"), member?.photo_url || "");

    els.formModal?.classList.add("is-open");
    els.formModal?.setAttribute("aria-hidden", "false");
  }

  function openDeleteModal(member) {
    deleteTargetId = member.id;
    if (els.deleteName) {
      els.deleteName.textContent = member.name;
    }
    els.deleteModal?.classList.add("is-open");
    els.deleteModal?.setAttribute("aria-hidden", "false");
  }

  function closeModals() {
    els.formModal?.classList.remove("is-open");
    els.formModal?.setAttribute("aria-hidden", "true");
    els.deleteModal?.classList.remove("is-open");
    els.deleteModal?.setAttribute("aria-hidden", "true");
    els.inviteModal?.classList.remove("is-open");
    els.inviteModal?.setAttribute("aria-hidden", "true");
    editingId = null;
    deleteTargetId = null;
    hideFormError();
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    hideFormError();
    BooklyAuthUI.clearFieldErrors(els.form);

    const form = els.form;
    const payload = {
      name: form.elements.namedItem("name").value,
      position: form.elements.namedItem("position").value,
      photo_url: form.elements.namedItem("photo_url").value,
      phone: form.elements.namedItem("phone").value,
      email: form.elements.namedItem("email").value,
      description: form.elements.namedItem("description").value,
      is_active: form.elements.namedItem("is_active").checked,
      service_ids: getSelectedServiceIds(),
    };

    const result = BooklyStaffValidation.validate(payload);

    if (!result.valid) {
      Object.entries(result.errors).forEach(([field, message]) => {
        const input = form.elements.namedItem(field);
        if (input) BooklyAuthUI.setFieldError(input, message);
      });
      return;
    }

    BooklyAuthUI.setButtonLoading(els.formSubmit, true, "Сохранение…", editingId ? "Сохранить" : "Добавить");
    let newlyCreated = null;

    try {
      if (editingId) {
        const updated = await BooklyStaff.update(editingId, organization.id, result.data);
        staffList = staffList
          .map((item) => (item.id === editingId ? updated : item))
          .sort((a, b) => a.name.localeCompare(b.name, "ru"));
      } else {
        const created = await BooklyStaff.create(organization.id, result.data);
        staffList = [...staffList, created].sort((a, b) => a.name.localeCompare(b.name, "ru"));
        newlyCreated = created;
      }

      updateDashboardCount();
      renderList();
      closeModals();

      if (newlyCreated && getTelegramBotUsername() && newlyCreated.telegram_link_token) {
        openInviteModal(newlyCreated, { justCreated: true });
      }
    } catch (error) {
      BooklyAuthErrors.logError("staff:save", error);
      showFormError(BooklySubscription.mapDbError(error) || error.message || "Не удалось сохранить сотрудника.");
    } finally {
      BooklyAuthUI.setButtonLoading(els.formSubmit, false, "Сохранение…", editingId ? "Сохранить" : "Добавить");
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTargetId) return;

    BooklyAuthUI.setButtonLoading(els.deleteConfirm, true, "Удаление…", "Удалить");

    try {
      await BooklyStaff.remove(deleteTargetId);
      staffList = staffList.filter((item) => item.id !== deleteTargetId);
      updateDashboardCount();
      renderList();
      closeModals();
    } catch (error) {
      BooklyAuthErrors.logError("staff:delete", error);
      alert(BooklySubscription.mapDbError(error) || error.message || "Не удалось удалить сотрудника.");
    } finally {
      BooklyAuthUI.setButtonLoading(els.deleteConfirm, false, "Удаление…", "Удалить");
    }
  }

  function showFormError(message) {
    if (!els.formError) return;
    els.formError.textContent = message;
    els.formError.hidden = false;
  }

  function hideFormError() {
    if (!els.formError) return;
    els.formError.textContent = "";
    els.formError.hidden = true;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function refresh() {
    return loadStaff();
  }

  return { init, refresh };
})();
