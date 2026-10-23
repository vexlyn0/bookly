/**
 * Bookly — личная страница записи клиента (/b/<token>): отмена и перенос
 */
(() => {
  const token = decodeURIComponent(window.location.pathname.split("/").filter(Boolean)[1] || "");
  const BASE = `/api/public/manage/${encodeURIComponent(token)}`;

  const MESSAGES = {
    BOOKING_NOT_FOUND: "Запись не найдена. Проверьте ссылку.",
    CANCEL_NOT_ALLOWED: "Отменить эту запись онлайн уже нельзя. Позвоните в салон.",
    RESCHEDULE_NOT_ALLOWED: "Перенести эту запись онлайн уже нельзя. Позвоните в салон.",
    BOOKING_CHANGED: "Запись только что изменилась. Страница обновлена.",
  };

  const STATUS_LABELS = {
    pending: "Ожидает подтверждения",
    confirmed: "Подтверждена",
    canceled: "Отменена",
    completed: "Завершена",
    no_show: "Визит не состоялся",
  };

  const els = {
    loader: document.getElementById("pm-loader"),
    error: document.getElementById("pm-error"),
    errorText: document.getElementById("pm-error-text"),
    app: document.getElementById("pm-app"),
    orgName: document.getElementById("pm-org-name"),
    orgMeta: document.getElementById("pm-org-meta"),
    panel: document.getElementById("pm-panel"),
  };

  const state = {
    info: null,
    mode: "view", // view | reschedule | cancel
    date: "",
    slots: [],
    slotsLoading: false,
    selected: "",
    busy: false,
    error: "",
    notice: "",
  };

  async function request(path = "", options = {}) {
    let response;
    try {
      response = await fetch(`${BASE}${path}`, {
        headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
        ...options,
      });
    } catch {
      throw Object.assign(new Error(PublicBookingErrors.MESSAGES.NETWORK_ERROR), { code: "NETWORK_ERROR" });
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload?.code || "GENERIC";
      const error = new Error(MESSAGES[code] || PublicBookingErrors.fromResponse(payload));
      error.code = code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(dateStr) {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  }

  function localDateString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function phoneLink() {
    const phone = state.info?.organization?.phone;
    if (!phone) return "";
    const tel = phone.replace(/[^\d+]/g, "");
    return `<a class="btn btn--outline" href="tel:${escapeHtml(tel)}">Позвонить: ${escapeHtml(phone)}</a>`;
  }

  function reasonText(info) {
    switch (info.reason) {
      case "too_late":
        return `Отменить или перенести запись онлайн можно не позже чем за ${info.cutoff_hours} ч до визита. Сейчас — только по телефону.`;
      case "disabled":
        return "Чтобы отменить или перенести запись, свяжитесь с салоном.";
      case "reschedule_limit":
        return "Онлайн-перенос уже использован. Чтобы перенести ещё раз, позвоните в салон.";
      default:
        return "";
    }
  }

  // ---------------------------------------------------------------------------

  function render() {
    const info = state.info;
    els.orgName.textContent = info.organization.name || "—";
    const meta = [];
    if (info.organization.phone) meta.push(`Телефон: ${info.organization.phone}`);
    if (info.organization.address) meta.push(`Адрес: ${info.organization.address}`);
    els.orgMeta.innerHTML = meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("");

    const notice = state.notice ? `<p class="alert alert--success pm-notice" role="status">${escapeHtml(state.notice)}</p>` : "";
    const error = state.error ? `<p class="alert alert--error pb-alert" role="alert">${escapeHtml(state.error)}</p>` : "";

    if (state.mode === "reschedule") {
      els.panel.innerHTML = notice + renderReschedule() + error;
    } else if (state.mode === "cancel") {
      els.panel.innerHTML = renderCancel() + error;
    } else {
      els.panel.innerHTML = notice + renderView() + error;
    }
  }

  function renderSummary() {
    const b = state.info.booking;
    return `
      <div class="pb-summary">
        <div class="pb-summary__row"><span class="pb-summary__label">Статус</span><span class="pm-status pm-status--${escapeHtml(b.status)}">${escapeHtml(STATUS_LABELS[b.status] || b.status)}</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Дата</span><span>${escapeHtml(formatDate(b.booking_date))}</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Время</span><span>${escapeHtml(b.start_time)} – ${escapeHtml(b.end_time)}</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Услуга</span><span>${escapeHtml(b.service_name)}</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Мастер</span><span>${escapeHtml(b.staff_name)}</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Имя</span><span>${escapeHtml(b.client_name)}</span></div>
        ${b.reference ? `<div class="pb-summary__row"><span class="pb-summary__label">Номер записи</span><span>${escapeHtml(b.reference)}</span></div>` : ""}
      </div>
    `;
  }

  function renderView() {
    const info = state.info;
    const b = info.booking;
    const active = b.status === "pending" || b.status === "confirmed";
    const reason = reasonText(info);
    const bookAgain = info.organization.slug
      ? `<a class="btn btn--primary" href="/book/${encodeURIComponent(info.organization.slug)}">Записаться снова</a>`
      : "";

    let actions = "";
    if (info.can_cancel || info.can_reschedule) {
      actions = `
        <div class="pm-actions">
          ${info.can_reschedule ? `<button class="btn btn--primary" type="button" data-action="reschedule">Перенести</button>` : ""}
          ${info.can_cancel ? `<button class="btn btn--outline pm-danger" type="button" data-action="cancel">Отменить запись</button>` : ""}
        </div>
        ${reason ? `<p class="pm-hint">${escapeHtml(reason)}</p>` : ""}
        ${info.can_reschedule ? `<p class="pm-hint">Перенести или отменить онлайн можно не позже чем за ${info.cutoff_hours} ч до визита.</p>` : ""}
      `;
    } else if (active) {
      actions = `
        ${reason ? `<p class="pm-hint">${escapeHtml(reason)}</p>` : ""}
        <div class="pm-actions">${phoneLink()}</div>
      `;
    } else {
      actions = `<div class="pm-actions">${bookAgain}</div>`;
    }

    return `
      <h2 class="pb-panel__title">${active ? "Вы записаны" : "Запись"}</h2>
      ${renderSummary()}
      ${actions}
    `;
  }

  function renderCancel() {
    const b = state.info.booking;
    return `
      <h2 class="pb-panel__title">Отменить запись?</h2>
      <p class="pb-panel__hint">${escapeHtml(b.service_name)} · ${escapeHtml(formatDate(b.booking_date))}, ${escapeHtml(b.start_time)}</p>
      <p class="pm-hint">Время освободится, и на него сможет записаться другой клиент.</p>
      <div class="pb-panel__actions">
        <button class="btn btn--ghost" type="button" data-action="back">Не отменять</button>
        <button class="btn btn--primary pm-danger-solid" type="button" data-action="confirm-cancel" ${state.busy ? "disabled" : ""}>
          ${state.busy ? "Отмена…" : "Да, отменить"}
        </button>
      </div>
    `;
  }

  function renderReschedule() {
    const info = state.info;
    const today = localDateString(new Date());
    const max = new Date();
    max.setDate(max.getDate() + (info.max_days_ahead || 60));

    let slotsHtml = "";
    if (!state.date) {
      slotsHtml = "";
    } else if (state.slotsLoading) {
      slotsHtml = `<div class="pb-loader"><div class="pb-loader__spinner" aria-hidden="true"></div></div>`;
    } else if (!state.slots.length) {
      slotsHtml = `<div class="pb-empty">На эту дату свободного времени нет. Выберите другой день.</div>`;
    } else {
      slotsHtml = `
        <div class="pb-slots">
          ${state.slots
            .map(
              (slot) => `
                <button class="pb-slot ${state.selected === slot.start_time ? "is-selected" : ""}" type="button" data-action="select-slot" data-start="${escapeHtml(slot.start_time)}">
                  ${escapeHtml(slot.start_time)}
                </button>`
            )
            .join("")}
        </div>`;
    }

    return `
      <h2 class="pb-panel__title">Перенести запись</h2>
      <p class="pb-panel__hint">Сейчас: ${escapeHtml(formatDate(info.booking.booking_date))}, ${escapeHtml(info.booking.start_time)} · мастер ${escapeHtml(info.booking.staff_name)}</p>
      <label class="field">
        <span class="field__label">Новая дата</span>
        <input class="field__input pb-date-input" type="date" id="pm-date" min="${today}" max="${localDateString(max)}" value="${escapeHtml(state.date)}">
      </label>
      ${slotsHtml}
      <div class="pb-panel__actions">
        <button class="btn btn--ghost" type="button" data-action="back">Назад</button>
        <button class="btn btn--primary" type="button" data-action="confirm-reschedule" ${!state.selected || state.busy ? "disabled" : ""}>
          ${state.busy ? "Перенос…" : state.selected ? `Перенести на ${escapeHtml(state.selected)}` : "Выберите время"}
        </button>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------

  async function loadSlots(date) {
    state.date = date;
    state.selected = "";
    state.error = "";
    state.slots = [];
    if (!date) return render();

    state.slotsLoading = true;
    render();
    try {
      const result = await request(`/slots?date=${encodeURIComponent(date)}`);
      if (state.date !== date) return;
      state.slots = result.slots || [];
    } catch (error) {
      state.error = error.message;
    } finally {
      state.slotsLoading = false;
      render();
    }
  }

  async function refreshAfterConflict(error) {
    if (error.code === "BOOKING_CHANGED" || error.code === "CANCEL_NOT_ALLOWED" || error.code === "RESCHEDULE_NOT_ALLOWED") {
      try {
        state.info = await request();
        state.mode = "view";
      } catch {
        // оставляем как есть
      }
    }
  }

  async function confirmCancel() {
    state.busy = true;
    state.error = "";
    render();
    try {
      state.info = await request("/cancel", { method: "POST", body: "{}" });
      state.mode = "view";
      state.notice = "Запись отменена. Спасибо, что предупредили!";
    } catch (error) {
      state.error = error.message;
      await refreshAfterConflict(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function confirmReschedule() {
    if (!state.selected) return;
    state.busy = true;
    state.error = "";
    render();
    try {
      state.info = await request("/reschedule", {
        method: "POST",
        body: JSON.stringify({ booking_date: state.date, start_time: state.selected }),
      });
      state.mode = "view";
      state.notice = "Готово! Запись перенесена.";
    } catch (error) {
      state.error = error.message;
      if (error.code === "BOOKING_TIME_CONFLICT") {
        state.busy = false;
        await loadSlots(state.date);
        state.error = error.message;
      } else {
        await refreshAfterConflict(error);
      }
    } finally {
      state.busy = false;
      render();
    }
  }

  els.panel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || state.busy) return;
    const action = button.dataset.action;

    if (action === "reschedule") {
      state.mode = "reschedule";
      state.notice = "";
      state.error = "";
      loadSlots(state.date || localDateString(new Date()));
    } else if (action === "cancel") {
      state.mode = "cancel";
      state.notice = "";
      state.error = "";
      render();
    } else if (action === "back") {
      state.mode = "view";
      state.error = "";
      render();
    } else if (action === "select-slot") {
      state.selected = button.dataset.start;
      render();
    } else if (action === "confirm-cancel") {
      confirmCancel();
    } else if (action === "confirm-reschedule") {
      confirmReschedule();
    }
  });

  els.panel.addEventListener("change", (event) => {
    if (event.target.id === "pm-date") loadSlots(event.target.value);
  });

  (async () => {
    try {
      state.info = await request();
      els.loader.hidden = true;
      els.app.hidden = false;
      render();
    } catch (error) {
      els.loader.hidden = true;
      els.error.hidden = false;
      els.errorText.textContent = error.message;
    }
  })();
})();
