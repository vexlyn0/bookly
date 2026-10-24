/**
 * Bookly — раздел «Услуги»
 */
window.BooklyServicesUI = (() => {
  let organization = null;
  let services = [];
  let editingId = null;
  let deleteTargetId = null;

  const els = {};

  function cacheElements() {
    els.section = document.getElementById("services-section");
    els.list = document.getElementById("services-list");
    els.empty = document.getElementById("services-empty");
    els.search = document.getElementById("services-search");
    els.filter = document.getElementById("services-filter");
    els.addBtn = document.getElementById("services-add-btn");
    els.activeCount = document.getElementById("dashboard-active-services");
    els.formModal = document.getElementById("service-modal");
    els.form = document.getElementById("service-form");
    els.formTitle = document.getElementById("service-modal-title");
    els.formError = document.getElementById("service-form-error");
    els.formSubmit = document.getElementById("service-form-submit");
    els.deleteModal = document.getElementById("delete-service-modal");
    els.deleteName = document.getElementById("delete-service-name");
    els.deleteConfirm = document.getElementById("delete-service-confirm");
  }

  function init(org) {
    organization = org;
    cacheElements();
    if (!els.section) return;

    els.addBtn?.addEventListener("click", () => openForm());
    els.search?.addEventListener("input", renderList);
    els.filter?.addEventListener("change", renderList);

    els.form?.addEventListener("submit", handleFormSubmit);
    BooklyMedia.bindPhotoField(els.form?.querySelector("[data-photo-field]"), "service", () => organization.id);
    els.form?.elements.namedItem("prepay_type")?.addEventListener("change", syncPrepayField);

    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", closeModals);
    });

    els.formModal?.addEventListener("click", (event) => {
      if (event.target === els.formModal) closeModals();
    });

    els.deleteModal?.addEventListener("click", (event) => {
      if (event.target === els.deleteModal) closeModals();
    });

    els.deleteConfirm?.addEventListener("click", handleDeleteConfirm);

    loadServices();
  }

  async function loadServices() {
    try {
      services = await BooklyServices.list(organization.id);
      updateDashboardCount();
      renderList();
      if (els.empty) {
        els.empty.hidden = services.length > 0;
        els.empty.textContent = "Услуг пока нет. Добавьте первую услугу для вашей компании.";
      }
    } catch (error) {
      BooklyAuthErrors.logError("services:load", error);
      if (els.list) els.list.innerHTML = "";
      if (els.empty) {
        els.empty.hidden = false;
        els.empty.textContent =
          error.message || "Не удалось загрузить услуги. Проверьте подключение и миграцию базы данных.";
      }
    }
  }

  function updateDashboardCount() {
    if (els.activeCount) {
      els.activeCount.textContent = String(BooklyServices.countActive(services));
    }
  }

  function getFilteredServices() {
    const query = String(els.search?.value || "").trim().toLowerCase();
    const filter = String(els.filter?.value || "all");

    return services.filter((item) => {
      const matchesSearch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        String(item.category || "").toLowerCase().includes(query);

      const matchesFilter =
        filter === "all" ||
        (filter === "active" && item.is_active) ||
        (filter === "inactive" && !item.is_active);

      return matchesSearch && matchesFilter;
    });
  }

  function renderList() {
    const filtered = getFilteredServices();

    if (!els.list || !els.empty) return;

    if (filtered.length === 0) {
      els.list.innerHTML = "";
      els.empty.hidden = false;
      return;
    }

    els.empty.hidden = true;
    els.list.innerHTML = filtered
      .map((item) => {
        const statusClass = item.is_active ? "service-card--active" : "service-card--inactive";
        const statusLabel = item.is_active ? "Активна" : "Неактивна";

        return `
          <article class="service-card ${statusClass}" data-id="${item.id}">
            <div class="service-card__main">
              <div class="service-card__header">
                <h3 class="service-card__name">${escapeHtml(item.name)}</h3>
                <span class="service-card__badge ${item.is_active ? "service-card__badge--on" : "service-card__badge--off"}">${statusLabel}</span>
              </div>
              ${item.description ? `<p class="service-card__desc">${escapeHtml(item.description)}</p>` : ""}
              <div class="service-card__meta">
                <span>${BooklyServices.formatPrice(item.price)}</span>
                <span class="service-card__dot" aria-hidden="true">·</span>
                <span>${BooklyServices.formatDuration(item.duration_minutes)}</span>
                ${item.category ? `<span class="service-card__dot" aria-hidden="true">·</span><span>${escapeHtml(item.category)}</span>` : ""}
              </div>
            </div>
            <div class="service-card__actions">
              <label class="toggle" title="${item.is_active ? "Отключить" : "Включить"}">
                <input type="checkbox" class="toggle__input" data-action="toggle" data-id="${item.id}" ${item.is_active ? "checked" : ""}>
                <span class="toggle__track"></span>
              </label>
              <button class="btn btn--ghost btn--sm" type="button" data-action="edit" data-id="${item.id}">Изменить</button>
              <button class="btn btn--ghost btn--sm service-card__delete" type="button" data-action="delete" data-id="${item.id}">Удалить</button>
            </div>
          </article>
        `;
      })
      .join("");

    els.list.querySelectorAll("[data-action='edit'], [data-action='delete']").forEach((btn) => {
      btn.addEventListener("click", handleCardAction);
    });

    els.list.querySelectorAll("[data-action='toggle']").forEach((input) => {
      input.addEventListener("change", handleToggle);
    });
  }

  async function handleCardAction(event) {
    const action = event.currentTarget.dataset.action;
    const id = event.currentTarget.dataset.id;
    const service = services.find((item) => item.id === id);
    if (!service) return;

    if (action === "edit") {
      openForm(service);
      return;
    }

    if (action === "delete") {
      openDeleteModal(service);
    }
  }

  async function handleToggle(event) {
    const input = event.currentTarget;
    const id = input.dataset.id;
    const service = services.find((item) => item.id === id);
    if (!service) return;

    const nextValue = input.checked;

    try {
      input.disabled = true;
      const updated = await BooklyServices.setActive(id, nextValue);
      services = services.map((item) => (item.id === id ? updated : item));
      updateDashboardCount();
      renderList();
    } catch (error) {
      input.checked = !nextValue;
      BooklyAuthErrors.logError("services:toggle", error);
      alert(BooklySubscription.mapDbError(error) || error.message || "Не удалось изменить статус услуги.");
    } finally {
      input.disabled = false;
    }
  }

  function openForm(service = null) {
    editingId = service?.id || null;
    hideFormError();
    els.form?.reset();

    if (els.formTitle) {
      els.formTitle.textContent = service ? "Редактировать услугу" : "Добавить услугу";
    }

    if (els.formSubmit) {
      els.formSubmit.textContent = service ? "Сохранить" : "Добавить";
    }

    if (service && els.form) {
      els.form.elements.namedItem("name").value = service.name || "";
      els.form.elements.namedItem("description").value = service.description || "";
      els.form.elements.namedItem("price").value = service.price ?? 0;
      els.form.elements.namedItem("duration_minutes").value = service.duration_minutes ?? 60;
      els.form.elements.namedItem("category").value = service.category || "";
      els.form.elements.namedItem("is_active").checked = service.is_active !== false;
      els.form.elements.namedItem("is_popular").checked = service.is_popular === true;
      els.form.elements.namedItem("prepay_type").value = service.prepay_type || "none";
      els.form.elements.namedItem("prepay_value").value = service.prepay_value ?? "";
    } else if (els.form) {
      els.form.elements.namedItem("duration_minutes").value = 60;
      els.form.elements.namedItem("is_active").checked = true;
    }
    BooklyMedia.setPhotoField(els.form?.querySelector("[data-photo-field]"), service?.photo_url || "");
    syncPrepayField();

    // Подсказки категорий — из уже существующих услуг
    const datalist = document.getElementById("service-categories");
    if (datalist) {
      const categories = [...new Set(services.map((item) => String(item.category || "").trim()).filter(Boolean))];
      datalist.innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
    }

    els.formModal?.classList.add("is-open");
    els.formModal?.setAttribute("aria-hidden", "false");
  }

  /** Поле суммы — только когда предоплата включена; подпись — ₸ или %. */
  function syncPrepayField() {
    const type = els.form?.elements.namedItem("prepay_type")?.value;
    const input = els.form?.elements.namedItem("prepay_value");
    if (!input) return;
    input.hidden = type === "none";
    input.placeholder = type === "percent" ? "Например, 30 (%)" : "Например, 2000 (₸)";
    input.max = type === "percent" ? "100" : "1000000";
  }

  function openDeleteModal(service) {
    deleteTargetId = service.id;
    if (els.deleteName) {
      els.deleteName.textContent = service.name;
    }
    els.deleteModal?.classList.add("is-open");
    els.deleteModal?.setAttribute("aria-hidden", "false");
  }

  function closeModals() {
    els.formModal?.classList.remove("is-open");
    els.formModal?.setAttribute("aria-hidden", "true");
    els.deleteModal?.classList.remove("is-open");
    els.deleteModal?.setAttribute("aria-hidden", "true");
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
      description: form.elements.namedItem("description").value,
      price: form.elements.namedItem("price").value,
      duration_minutes: form.elements.namedItem("duration_minutes").value,
      category: form.elements.namedItem("category").value,
      is_active: form.elements.namedItem("is_active").checked,
      is_popular: form.elements.namedItem("is_popular").checked,
      prepay_type: form.elements.namedItem("prepay_type").value,
      prepay_value: form.elements.namedItem("prepay_value").value,
      photo_url: form.elements.namedItem("photo_url").value,
    };

    const result = BooklyServicesValidation.validate(payload);

    if (!result.valid) {
      Object.entries(result.errors).forEach(([field, message]) => {
        const input = form.elements.namedItem(field === "duration_minutes" ? "duration_minutes" : field);
        if (input) BooklyAuthUI.setFieldError(input, message);
      });
      return;
    }

    BooklyAuthUI.setButtonLoading(els.formSubmit, true, "Сохранение…", editingId ? "Сохранить" : "Добавить");

    try {
      if (editingId) {
        const updated = await BooklyServices.update(editingId, result.data);
        services = services.map((item) => (item.id === editingId ? updated : item));
      } else {
        const created = await BooklyServices.create(organization.id, result.data);
        services = [...services, created].sort((a, b) => a.name.localeCompare(b.name, "ru"));
      }

      updateDashboardCount();
      renderList();
      closeModals();
    } catch (error) {
      BooklyAuthErrors.logError("services:save", error);
      showFormError(BooklySubscription.mapDbError(error) || error.message || "Не удалось сохранить услугу.");
    } finally {
      BooklyAuthUI.setButtonLoading(els.formSubmit, false, "Сохранение…", editingId ? "Сохранить" : "Добавить");
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTargetId) return;

    BooklyAuthUI.setButtonLoading(els.deleteConfirm, true, "Удаление…", "Удалить");

    try {
      await BooklyServices.remove(deleteTargetId);
      services = services.filter((item) => item.id !== deleteTargetId);
      updateDashboardCount();
      renderList();
      closeModals();
    } catch (error) {
      BooklyAuthErrors.logError("services:delete", error);
      alert(BooklySubscription.mapDbError(error) || error.message || "Не удалось удалить услугу.");
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
    return loadServices();
  }

  return { init, refresh };
})();
