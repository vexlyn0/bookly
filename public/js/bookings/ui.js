/**
 * Bookly — раздел «Записи»
 */
window.BooklyBookingsUI = (() => {
  let organization = null;
  let bookings = [];
  let services = [];
  let staffMembers = [];
  let editingId = null;
  let editingSnapshot = null;
  let cancelTargetId = null;
  let deleteTargetId = null;
  let staffSchedulesCache = new Map();

  const els = {};

  function cacheElements() {
    els.section = document.getElementById("bookings-section");
    els.list = document.getElementById("bookings-list");
    els.empty = document.getElementById("bookings-empty");
    els.search = document.getElementById("bookings-search");
    els.filterStatus = document.getElementById("bookings-filter-status");
    els.filterStaff = document.getElementById("bookings-filter-staff");
    els.filterDate = document.getElementById("bookings-filter-date");
    els.addBtn = document.getElementById("bookings-add-btn");
    els.todayCount = document.getElementById("dashboard-today-bookings");
    els.upcomingCount = document.getElementById("dashboard-upcoming-bookings");
    els.formModal = document.getElementById("booking-modal");
    els.form = document.getElementById("booking-form");
    els.formTitle = document.getElementById("booking-modal-title");
    els.formError = document.getElementById("booking-form-error");
    els.formSubmit = document.getElementById("booking-form-submit");
    els.slotsHint = document.getElementById("booking-slots-hint");
    els.slotsSelect = document.getElementById("booking-start-time");
    els.cancelModal = document.getElementById("cancel-booking-modal");
    els.cancelName = document.getElementById("cancel-booking-label");
    els.cancelConfirm = document.getElementById("cancel-booking-confirm");
    els.deleteModal = document.getElementById("delete-booking-modal");
    els.deleteName = document.getElementById("delete-booking-label");
    els.deleteConfirm = document.getElementById("delete-booking-confirm");
  }

  function init(org) {
    organization = org;
    cacheElements();
    if (!els.section) return;

    els.addBtn?.addEventListener("click", () => openForm());
    els.search?.addEventListener("input", renderList);
    els.filterStatus?.addEventListener("change", renderList);
    els.filterStaff?.addEventListener("change", renderList);
    els.filterDate?.addEventListener("change", renderList);
    els.form?.addEventListener("submit", handleFormSubmit);
    els.cancelConfirm?.addEventListener("click", handleCancelConfirm);
    els.deleteConfirm?.addEventListener("click", handleDeleteConfirm);

    els.formModal?.addEventListener("click", (e) => {
      if (e.target === els.formModal) closeModals();
    });
    els.cancelModal?.addEventListener("click", (e) => {
      if (e.target === els.cancelModal) closeModals();
    });
    els.deleteModal?.addEventListener("click", (e) => {
      if (e.target === els.deleteModal) closeModals();
    });

    document.querySelectorAll("[data-close-booking-modal]").forEach((btn) => {
      btn.addEventListener("click", closeModals);
    });

    const serviceSelect = els.form?.elements.namedItem("service_id");
    const staffSelect = els.form?.elements.namedItem("staff_id");
    const dateInput = els.form?.elements.namedItem("booking_date");

    serviceSelect?.addEventListener("change", handleServiceChange);
    staffSelect?.addEventListener("change", handleStaffChange);
    dateInput?.addEventListener("change", handleDateChange);

    loadBookings();
  }

  async function loadReferenceData() {
    const [serviceList, staffList] = await Promise.all([
      BooklyServices.list(organization.id),
      BooklyStaff.list(organization.id),
    ]);
    services = serviceList;
    staffMembers = staffList;
    populateStaffFilter();
  }

  function populateStaffFilter() {
    if (!els.filterStaff) return;
    const current = els.filterStaff.value;
    els.filterStaff.innerHTML =
      '<option value="all">Все сотрудники</option>' +
      staffMembers
        .map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
        .join("");
    els.filterStaff.value = current || "all";
  }

  async function loadBookings() {
    try {
      await loadReferenceData();
      bookings = await BooklyBookings.list(organization.id);
      updateDashboard();
      renderList();
      if (els.empty) {
        els.empty.hidden = bookings.length > 0;
        if (!bookings.length) {
          els.empty.textContent = "Записей пока нет. Добавьте первую запись вручную.";
        }
      }
    } catch (error) {
      BooklyBookingsErrors.logError("load", error);
      if (els.list) els.list.innerHTML = "";
      if (els.empty) {
        els.empty.hidden = false;
        els.empty.textContent = BooklyBookingsErrors.fromError(error);
      }
    }
  }

  function updateDashboard() {
    const stats = BooklyBookings.computeStats(bookings);
    if (els.todayCount) els.todayCount.textContent = String(stats.todayCount);
    if (els.upcomingCount) els.upcomingCount.textContent = String(stats.upcomingCount);
  }

  function getFilteredBookings() {
    const query = String(els.search?.value || "").trim().toLowerCase();
    const status = String(els.filterStatus?.value || "all");
    const staffId = String(els.filterStaff?.value || "all");
    const date = String(els.filterDate?.value || "");

    return bookings.filter((item) => {
      const matchesSearch =
        !query ||
        item.client_name.toLowerCase().includes(query) ||
        String(item.client_phone || "").toLowerCase().includes(query);

      const matchesStatus = status === "all" || item.status === status;
      const matchesStaff = staffId === "all" || item.staff_id === staffId;
      const matchesDate = !date || item.booking_date === date;

      return matchesSearch && matchesStatus && matchesStaff && matchesDate;
    });
  }

  function formatDateRu(dateStr) {
    if (!dateStr) return "—";
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function formatTimeRange(start, end) {
    const s = BooklyBookingsSlots.formatTimeForInput(start);
    const e = BooklyBookingsSlots.formatTimeForInput(end);
    return `${s} – ${e}`;
  }

  function renderList() {
    const filtered = getFilteredBookings();
    if (!els.list || !els.empty) return;

    if (!filtered.length) {
      els.list.innerHTML = "";
      els.empty.hidden = false;
      els.empty.textContent = bookings.length
        ? "Ничего не найдено. Измените фильтры."
        : "Записей пока нет. Добавьте первую запись вручную.";
      return;
    }

    els.empty.hidden = true;
    els.list.innerHTML = filtered
      .map((item) => {
        const status = BooklyBookingsConstants.getStatus(item.status);
        const serviceName = item.services?.name || "—";
        const staffName = item.staff?.name || "—";

        return `
          <article class="booking-card" data-id="${item.id}">
            <div class="booking-card__main">
              <div class="booking-card__header">
                <div>
                  <p class="booking-card__datetime">${formatDateRu(item.booking_date)} · ${formatTimeRange(item.start_time, item.end_time)}</p>
                  <h3 class="booking-card__client">${escapeHtml(item.client_name)}</h3>
                </div>
                <span class="booking-card__badge ${status.badge}">${status.label}</span>
              </div>
              <div class="booking-card__meta">
                <span>${escapeHtml(item.client_phone)}</span>
                <span class="booking-card__dot" aria-hidden="true">·</span>
                <span>${escapeHtml(serviceName)}</span>
                <span class="booking-card__dot" aria-hidden="true">·</span>
                <span>${escapeHtml(staffName)}</span>
                <span class="booking-card__dot" aria-hidden="true">·</span>
                <span>${BooklyBookingsConstants.getSourceLabel(item.source)}</span>
              </div>
            </div>
            <div class="booking-card__actions">
              <select class="field__select booking-card__status" data-action="status" data-id="${item.id}" aria-label="Статус">
                ${BooklyBookingsConstants.STATUSES.map(
                  (s) =>
                    `<option value="${s.value}" ${s.value === item.status ? "selected" : ""}>${s.label}</option>`
                ).join("")}
              </select>
              <button class="btn btn--ghost btn--sm" type="button" data-action="edit" data-id="${item.id}">Изменить</button>
              ${
                item.status !== "canceled"
                  ? `<button class="btn btn--ghost btn--sm" type="button" data-action="cancel" data-id="${item.id}">Отменить</button>`
                  : ""
              }
              <button class="btn btn--ghost btn--sm booking-card__delete" type="button" data-action="delete" data-id="${item.id}">Удалить</button>
            </div>
          </article>
        `;
      })
      .join("");

    els.list.querySelectorAll("[data-action='edit'], [data-action='cancel'], [data-action='delete']").forEach((btn) => {
      btn.addEventListener("click", handleCardAction);
    });

    els.list.querySelectorAll("[data-action='status']").forEach((select) => {
      select.addEventListener("change", handleStatusChange);
    });
  }

  async function handleCardAction(event) {
    const action = event.currentTarget.dataset.action;
    const id = event.currentTarget.dataset.id;
    const booking = bookings.find((item) => item.id === id);
    if (!booking) return;

    if (action === "edit") {
      await openForm(booking);
      return;
    }

    if (action === "cancel") {
      openCancelModal(booking);
      return;
    }

    if (action === "delete") {
      openDeleteModal(booking);
    }
  }

  async function handleStatusChange(event) {
    const id = event.currentTarget.dataset.id;
    const status = event.currentTarget.value;
    const previous = bookings.find((item) => item.id === id)?.status;

    try {
      event.currentTarget.disabled = true;
      const updated = await BooklyBookings.setStatus(id, status);
      bookings = bookings.map((item) => (item.id === id ? updated : item));
      updateDashboard();
      renderList();
    } catch (error) {
      event.currentTarget.value = previous;
      BooklyBookingsErrors.logError("status", error);
      alert(BooklyBookingsErrors.fromError(error));
    } finally {
      event.currentTarget.disabled = false;
    }
  }

  function buildEditingSnapshot(booking) {
    if (!booking) return null;
    return {
      service_id: booking.service_id,
      staff_id: booking.staff_id,
      booking_date: booking.booking_date,
      start_time: BooklyBookingsSlots.formatTimeForInput(booking.start_time),
    };
  }

  function getSelectedService() {
    const serviceId = els.form?.elements.namedItem("service_id")?.value;
    return services.find((item) => item.id === serviceId) || null;
  }

  function getSelectedStaff() {
    const staffId = els.form?.elements.namedItem("staff_id")?.value;
    const fromList = staffMembers.find((item) => item.id === staffId);
    if (fromList) return fromList;
    if (editingSnapshot?.staff_id === staffId) {
      return { id: staffId, is_active: false };
    }
    return null;
  }

  function isRescheduleBlocked() {
    if (!editingId) return false;
    const service = getSelectedService();
    const staff = getSelectedStaff();
    if (!service || !staff) return false;
    return service.is_active !== true || staff.is_active !== true;
  }

  function syncScheduleFieldsState() {
    const dateInput = els.form?.elements.namedItem("booking_date");
    if (!dateInput || !els.slotsSelect) return;

    const blocked = isRescheduleBlocked();
    dateInput.disabled = blocked;

    if (blocked) {
      els.slotsSelect.disabled = true;
      if (els.slotsHint) {
        els.slotsHint.textContent = "Для переноса выберите активную услугу и активного сотрудника.";
      }
      return;
    }

    dateInput.disabled = false;
  }

  async function handleStaffChange() {
    syncScheduleFieldsState();
    if (!isRescheduleBlocked()) {
      await refreshSlots();
    }
  }

  async function handleDateChange() {
    if (isRescheduleBlocked()) {
      syncScheduleFieldsState();
      return;
    }
    await refreshSlots();
  }

  function populateServiceSelect(selectedId = "", { isEdit = false } = {}) {
    const select = els.form?.elements.namedItem("service_id");
    if (!select) return;

    const activeServices = services.filter((s) => s.is_active);
    const options = [];

    if (isEdit && selectedId) {
      const selected = services.find((s) => s.id === selectedId);
      if (selected && !selected.is_active) {
        options.push(selected);
      }
    }

    for (const service of activeServices) {
      if (!options.some((item) => item.id === service.id)) {
        options.push(service);
      }
    }

    select.innerHTML =
      '<option value="">Выберите услугу</option>' +
      options
        .map((service) => {
          const inactive = service.is_active !== true;
          const label = `${escapeHtml(service.name)} (${service.duration_minutes} мин)${inactive ? " — неактивна" : ""}`;
          const disabled = inactive && service.id !== selectedId ? "disabled" : "";
          return `<option value="${service.id}" ${service.id === selectedId ? "selected" : ""} ${disabled}>${label}</option>`;
        })
        .join("");

    syncScheduleFieldsState();
  }

  async function populateStaffSelect(serviceId, selectedId = "", { isEdit = false } = {}) {
    const select = els.form?.elements.namedItem("staff_id");
    if (!select) return;

    if (!serviceId) {
      select.innerHTML = '<option value="">Сначала выберите услугу</option>';
      select.disabled = true;
      return;
    }

    select.disabled = false;
    select.innerHTML = '<option value="">Загрузка…</option>';

    const staff = await BooklyBookings.getStaffForService(organization.id, serviceId);
    let options = [...staff];

    if (isEdit && selectedId && !options.some((member) => member.id === selectedId)) {
      const current = staffMembers.find((member) => member.id === selectedId);
      if (current) {
        options = [current, ...options];
      }
    }

    if (!options.length) {
      select.innerHTML = '<option value="">Нет сотрудников для этой услуги</option>';
      select.disabled = true;
      return;
    }

    select.innerHTML =
      '<option value="">Выберите сотрудника</option>' +
      options
        .map((member) => {
          const inactive = member.is_active !== true;
          const label = `${escapeHtml(member.name)}${inactive ? " — неактивен" : ""}`;
          const disabled = inactive && member.id !== selectedId ? "disabled" : "";
          return `<option value="${member.id}" ${member.id === selectedId ? "selected" : ""} ${disabled}>${label}</option>`;
        })
        .join("");

    syncScheduleFieldsState();
  }

  async function getSchedules(staffId) {
    if (staffSchedulesCache.has(staffId)) {
      return staffSchedulesCache.get(staffId);
    }
    const rows = await BooklySchedules.listForStaff(staffId);
    staffSchedulesCache.set(staffId, rows);
    return rows;
  }

  async function refreshSlots() {
    const form = els.form;
    if (!form || !els.slotsSelect) return;

    syncScheduleFieldsState();
    if (isRescheduleBlocked()) return;

    const serviceId = form.elements.namedItem("service_id").value;
    const staffId = form.elements.namedItem("staff_id").value;
    const date = form.elements.namedItem("booking_date").value;
    const previous = els.slotsSelect.value;

    els.slotsSelect.innerHTML = '<option value="">Выберите время</option>';
    els.slotsSelect.disabled = true;
    if (els.slotsHint) els.slotsHint.textContent = "";

    if (!serviceId || !staffId || !date) {
      if (els.slotsHint) els.slotsHint.textContent = "Выберите услугу, сотрудника и дату.";
      return;
    }

    const service = services.find((s) => s.id === serviceId);
    if (!service) return;

    try {
      const [schedules, dayBookings] = await Promise.all([
        getSchedules(staffId),
        BooklyBookings.listForStaffDate(staffId, date),
      ]);

      const schedule = BooklyBookingsSlots.findScheduleForDate(schedules, date);
      const slots = BooklyBookingsSlots.computeSlots({
        schedule,
        durationMinutes: service.duration_minutes,
        bookings: dayBookings,
        excludeBookingId: editingId,
        dateStr: date,
      });

      if (!schedule || schedule.is_working !== true) {
        if (els.slotsHint) els.slotsHint.textContent = "Сотрудник не работает в этот день.";
        return;
      }

      if (!slots.length) {
        if (els.slotsHint) els.slotsHint.textContent = "Нет свободных слотов на эту дату.";
        return;
      }

      els.slotsSelect.disabled = false;
      els.slotsSelect.innerHTML =
        '<option value="">Выберите время</option>' +
        slots.map((slot) => `<option value="${slot.start_time}">${slot.label}</option>`).join("");

      if (previous && [...els.slotsSelect.options].some((o) => o.value === previous)) {
        els.slotsSelect.value = previous;
      } else if (
        editingId &&
        previous &&
        !slots.some((s) => s.start_time === previous)
      ) {
        const current = BooklyBookingsSlots.formatTimeForInput(previous);
        els.slotsSelect.innerHTML += `<option value="${current}" selected>${current} (текущее)</option>`;
      }

      if (els.slotsHint) {
        els.slotsHint.textContent = `Длительность: ${service.duration_minutes} мин · шаг ${BooklyBookingsConstants.SLOT_STEP_MINUTES} мин`;
      }
    } catch (error) {
      BooklyBookingsErrors.logError("slots", error);
      if (els.slotsHint) els.slotsHint.textContent = BooklyBookingsErrors.fromError(error);
    }
  }

  async function handleServiceChange() {
    const serviceId = els.form?.elements.namedItem("service_id").value;
    await populateStaffSelect(serviceId, "", { isEdit: false });
    if (els.form?.elements.namedItem("staff_id")) {
      els.form.elements.namedItem("staff_id").value = "";
    }
    syncScheduleFieldsState();
    if (!isRescheduleBlocked()) {
      await refreshSlots();
    }
  }

  async function openForm(booking = null) {
    editingId = booking?.id || null;
    editingSnapshot = buildEditingSnapshot(booking);
    hideFormError();
    els.form?.reset();
    staffSchedulesCache.clear();

    if (els.formTitle) {
      els.formTitle.textContent = booking ? "Редактировать запись" : "Добавить запись";
    }
    if (els.formSubmit) {
      els.formSubmit.textContent = booking ? "Сохранить" : "Добавить";
    }

    await loadReferenceData();
    const isEdit = Boolean(booking);
    populateServiceSelect(booking?.service_id || "", { isEdit });

    const statusSelect = els.form?.elements.namedItem("status");
    if (statusSelect) {
      statusSelect.innerHTML = BooklyBookingsConstants.STATUSES.map(
        (s) => `<option value="${s.value}">${s.label}</option>`
      ).join("");
    }

    if (booking) {
      await populateStaffSelect(booking.service_id, booking.staff_id, { isEdit: true });
      els.form.elements.namedItem("booking_date").value = booking.booking_date;
      els.form.elements.namedItem("client_name").value = booking.client_name || "";
      els.form.elements.namedItem("client_phone").value = booking.client_phone || "";
      els.form.elements.namedItem("client_email").value = booking.client_email || "";
      els.form.elements.namedItem("client_comment").value = booking.client_comment || "";
      els.form.elements.namedItem("status").value = booking.status || "confirmed";
      await refreshSlots();
      els.slotsSelect.value = BooklyBookingsSlots.formatTimeForInput(booking.start_time);
      syncScheduleFieldsState();
    } else {
      await populateStaffSelect("", "", { isEdit: false });
      const today = BooklyBookingsSlots.formatDateLocal(new Date());
      els.form.elements.namedItem("booking_date").value = today;
      els.form.elements.namedItem("status").value = "confirmed";
    }

    els.formModal?.classList.add("is-open");
    els.formModal?.setAttribute("aria-hidden", "false");
  }

  function openCancelModal(booking) {
    cancelTargetId = booking.id;
    if (els.cancelName) {
      els.cancelName.textContent = `${booking.client_name} · ${formatDateRu(booking.booking_date)} ${formatTimeRange(booking.start_time, booking.end_time)}`;
    }
    els.cancelModal?.classList.add("is-open");
    els.cancelModal?.setAttribute("aria-hidden", "false");
  }

  function openDeleteModal(booking) {
    deleteTargetId = booking.id;
    if (els.deleteName) {
      els.deleteName.textContent = `${booking.client_name} · ${formatDateRu(booking.booking_date)}`;
    }
    els.deleteModal?.classList.add("is-open");
    els.deleteModal?.setAttribute("aria-hidden", "false");
  }

  function closeModals() {
    els.formModal?.classList.remove("is-open");
    els.formModal?.setAttribute("aria-hidden", "true");
    els.cancelModal?.classList.remove("is-open");
    els.cancelModal?.setAttribute("aria-hidden", "true");
    els.deleteModal?.classList.remove("is-open");
    els.deleteModal?.setAttribute("aria-hidden", "true");
    editingId = null;
    editingSnapshot = null;
    cancelTargetId = null;
    deleteTargetId = null;
    hideFormError();
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    hideFormError();
    BooklyAuthUI.clearFieldErrors(els.form);

    const form = els.form;
    const payload = {
      service_id: form.elements.namedItem("service_id").value,
      staff_id: form.elements.namedItem("staff_id").value,
      booking_date: form.elements.namedItem("booking_date").value,
      start_time: els.slotsSelect?.value,
      client_name: form.elements.namedItem("client_name").value,
      client_phone: form.elements.namedItem("client_phone").value,
      client_email: form.elements.namedItem("client_email").value,
      client_comment: form.elements.namedItem("client_comment").value,
      status: form.elements.namedItem("status").value,
      source: editingId ? bookings.find((b) => b.id === editingId)?.source : "manual",
    };

    const result = BooklyBookingsValidation.validate(payload, { isEdit: Boolean(editingId) });

    if (!result.valid) {
      Object.entries(result.errors).forEach(([field, message]) => {
        const input =
          field === "start_time" ? els.slotsSelect : form.elements.namedItem(field);
        if (input) BooklyAuthUI.setFieldError(input, message);
      });
      return;
    }

    const reschedule = editingId
      ? BooklyBookings.isReschedule(editingSnapshot, result.data)
      : false;

    if (reschedule && isRescheduleBlocked()) {
      const service = getSelectedService();
      const staff = getSelectedStaff();
      if (service?.is_active !== true) {
        showFormError(BooklyBookingsErrors.CODE_MESSAGES.BOOKING_RESCHEDULE_SERVICE_INACTIVE);
      } else if (staff?.is_active !== true) {
        showFormError(BooklyBookingsErrors.CODE_MESSAGES.BOOKING_RESCHEDULE_STAFF_INACTIVE);
      } else {
        showFormError("Для переноса выберите активную услугу и активного сотрудника.");
      }
      return;
    }

    BooklyAuthUI.setButtonLoading(els.formSubmit, true, "Сохранение…", editingId ? "Сохранить" : "Добавить");

    try {
      if (editingId) {
        const updated = await BooklyBookings.update(editingId, result.data, editingSnapshot);
        bookings = bookings.map((item) => (item.id === editingId ? updated : item));
      } else {
        const created = await BooklyBookings.create(organization.id, result.data);
        bookings = [...bookings, created].sort((a, b) => {
          const d = a.booking_date.localeCompare(b.booking_date);
          return d !== 0 ? d : String(a.start_time).localeCompare(String(b.start_time));
        });
      }

      updateDashboard();
      renderList();
      closeModals();
    } catch (error) {
      BooklyBookingsErrors.logError("save", error);
      showFormError(
        BooklyBookingsErrors.fromError(error, {
          isReschedule: editingId
            ? BooklyBookings.isReschedule(editingSnapshot, result.data)
            : false,
        })
      );
    } finally {
      BooklyAuthUI.setButtonLoading(els.formSubmit, false, "Сохранение…", editingId ? "Сохранить" : "Добавить");
    }
  }

  async function handleCancelConfirm() {
    if (!cancelTargetId) return;
    BooklyAuthUI.setButtonLoading(els.cancelConfirm, true, "Отмена…", "Отменить запись");

    try {
      const updated = await BooklyBookings.setStatus(cancelTargetId, "canceled");
      bookings = bookings.map((item) => (item.id === cancelTargetId ? updated : item));
      updateDashboard();
      renderList();
      closeModals();
    } catch (error) {
      BooklyBookingsErrors.logError("cancel", error);
      alert(BooklyBookingsErrors.fromError(error));
    } finally {
      BooklyAuthUI.setButtonLoading(els.cancelConfirm, false, "Отмена…", "Отменить запись");
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTargetId) return;
    BooklyAuthUI.setButtonLoading(els.deleteConfirm, true, "Удаление…", "Удалить");

    try {
      await BooklyBookings.remove(deleteTargetId);
      bookings = bookings.filter((item) => item.id !== deleteTargetId);
      updateDashboard();
      renderList();
      closeModals();
    } catch (error) {
      BooklyBookingsErrors.logError("delete", error);
      alert(BooklyBookingsErrors.fromError(error));
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

  return { init, refresh: loadBookings };
})();
