window.PublicBookingUI = (() => {
  const els = {};

  function cacheElements() {
    els.loader = document.getElementById("pb-loader");
    els.errorScreen = document.getElementById("pb-error-screen");
    els.errorTitle = document.getElementById("pb-error-title");
    els.errorText = document.getElementById("pb-error-text");
    els.flow = document.getElementById("pb-flow");
    els.success = document.getElementById("pb-success");
    els.heroName = document.getElementById("pb-org-name");
    els.heroDescription = document.getElementById("pb-org-description");
    els.heroMeta = document.getElementById("pb-org-meta");
    els.steps = document.getElementById("pb-steps");
    els.panel = document.getElementById("pb-panel");
    els.successStatus = document.getElementById("pb-success-status");
    els.successDetails = document.getElementById("pb-success-details");
    els.successRestart = document.getElementById("pb-success-restart");
    els.header = document.getElementById("pb-header");
    els.powered = document.getElementById("pb-powered");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatPrice(price, currency = "KZT") {
    if (currency === "KZT") return `${Number(price || 0).toLocaleString("ru-RU")} ₸`;
    return `${price} ${currency}`;
  }

  function formatDateRu(dateStr) {
    if (!dateStr) return "—";
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function showLoader() {
    els.loader.hidden = false;
    els.errorScreen.hidden = true;
    els.flow.hidden = true;
    els.success.hidden = true;
  }

  function showError(title, message) {
    els.loader.hidden = true;
    els.errorScreen.hidden = false;
    els.flow.hidden = true;
    els.success.hidden = true;
    els.errorTitle.textContent = title;
    els.errorText.textContent = message;
  }

  function showFlow() {
    els.loader.hidden = true;
    els.errorScreen.hidden = true;
    els.flow.hidden = false;
    els.success.hidden = true;
  }

  function showSuccess(result) {
    els.loader.hidden = true;
    els.errorScreen.hidden = true;
    els.flow.hidden = true;
    els.success.hidden = false;

    const booking = result.booking;
    els.successStatus.textContent =
      booking.status === "pending"
        ? "Организация должна подтвердить запись"
        : "Запись подтверждена";

    els.successDetails.innerHTML = `
      <div><dt>Номер записи</dt><dd>${escapeHtml(booking.reference)}</dd></div>
      <div><dt>Статус</dt><dd>${escapeHtml(booking.status === "pending" ? "Ожидает подтверждения" : "Подтверждена")}</dd></div>
      <div><dt>Услуга</dt><dd>${escapeHtml(booking.service_name)}</dd></div>
      <div><dt>Сотрудник</dt><dd>${escapeHtml(booking.staff_name)}</dd></div>
      <div><dt>Дата</dt><dd>${escapeHtml(formatDateRu(booking.booking_date))}</dd></div>
      <div><dt>Время</dt><dd>${escapeHtml(booking.start_time)} – ${escapeHtml(booking.end_time)}</dd></div>
    `;
  }

  function renderOrganization(organization) {
    els.heroName.textContent = organization.name || "—";
    els.heroDescription.textContent = organization.description || "";
    const meta = [];
    if (organization.phone) meta.push(`Телефон: ${organization.phone}`);
    if (organization.address) meta.push(`Адрес: ${organization.address}`);
    els.heroMeta.innerHTML = meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("");

    // Free: подпись Bookly в шапке и внизу страницы; Pro — без брендинга Bookly.
    const showBranding = organization.show_branding !== false;
    if (els.header) els.header.hidden = !showBranding;
    if (els.powered) els.powered.hidden = !showBranding;
  }

  function renderSteps(state) {
    const currentIndex = PublicBookingState.getStepIndex(state.step);
    els.steps.innerHTML = PublicBookingState.STEPS.map((step, index) => {
      const classes = ["pb-step"];
      if (index === currentIndex) classes.push("is-active");
      if (index < currentIndex) classes.push("is-done");
      return `<div class="${classes.join(" ")}">${escapeHtml(step.label)}</div>`;
    }).join("");
  }

  function renderPanel(state) {
    renderSteps(state);

    if (state.loading) {
      els.panel.innerHTML = `
        <div class="pb-loader">
          <div class="pb-loader__spinner" aria-hidden="true"></div>
          <p>Загрузка…</p>
        </div>
      `;
      return;
    }

    const errorHtml = state.error
      ? `<p class="alert alert--error pb-alert" role="alert">${escapeHtml(state.error)}</p>`
      : "";

    switch (state.step) {
      case "service":
        els.panel.innerHTML = renderServiceStep(state) + errorHtml;
        break;
      case "staff":
        els.panel.innerHTML = renderStaffStep(state) + errorHtml;
        break;
      case "date":
        els.panel.innerHTML = renderDateStep(state) + errorHtml;
        break;
      case "time":
        els.panel.innerHTML = renderTimeStep(state) + errorHtml;
        break;
      case "client":
        els.panel.innerHTML = renderClientStep(state) + errorHtml;
        break;
      case "confirm":
        els.panel.innerHTML = renderConfirmStep(state) + errorHtml;
        break;
      default:
        els.panel.innerHTML = errorHtml;
    }
  }

  function renderServiceStep(state) {
    if (!state.services.length) {
      return `<div class="pb-empty">Сейчас нет доступных услуг для онлайн-записи.</div>`;
    }

    return `
      <h2 class="pb-panel__title">Выберите услугу</h2>
      <p class="pb-panel__hint">Показаны только активные услуги организации.</p>
      <div class="pb-cards">
        ${state.services
          .map(
            (service) => `
              <button class="pb-card ${state.selection.serviceId === service.id ? "is-selected" : ""}" type="button" data-action="select-service" data-id="${service.id}">
                <h3 class="pb-card__title">${escapeHtml(service.name)}</h3>
                ${service.description ? `<p class="pb-card__text">${escapeHtml(service.description)}</p>` : ""}
                <div class="pb-card__meta">
                  <span>${service.duration_minutes} мин</span>
                  <span>${escapeHtml(formatPrice(service.price, service.currency))}</span>
                </div>
              </button>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderStaffStep(state) {
    if (!state.staff.length) {
      return `
        <h2 class="pb-panel__title">Выберите сотрудника</h2>
        <div class="pb-empty">Для выбранной услуги нет доступных сотрудников.</div>
        <div class="pb-panel__actions">
          <button class="btn btn--ghost" type="button" data-action="back">Назад</button>
        </div>
      `;
    }

    return `
      <h2 class="pb-panel__title">Выберите сотрудника</h2>
      <p class="pb-panel__hint">Показаны только активные сотрудники, оказывающие выбранную услугу.</p>
      <div class="pb-cards">
        ${state.staff
          .map((member) => {
            const initials = member.name
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0])
              .join("")
              .toUpperCase();
            return `
              <button class="pb-card pb-staff-card ${state.selection.staffId === member.id ? "is-selected" : ""}" type="button" data-action="select-staff" data-id="${member.id}">
                <span class="pb-avatar">${escapeHtml(initials || "?")}</span>
                <span>
                  <h3 class="pb-card__title">${escapeHtml(member.name)}</h3>
                  ${member.position ? `<p class="pb-card__text">${escapeHtml(member.position)}</p>` : ""}
                </span>
              </button>
            `;
          })
          .join("")}
      </div>
      <div class="pb-panel__actions">
        <button class="btn btn--ghost" type="button" data-action="back">Назад</button>
      </div>
    `;
  }

  function renderDateStep(state) {
    const today = PublicBookingState.getTodayString();
    const maxDate = PublicBookingState.getMaxDateString();
    const value = state.selection.bookingDate || today;

    return `
      <h2 class="pb-panel__title">Выберите дату</h2>
      <p class="pb-panel__hint">Можно записаться максимум на ${PublicBookingState.MAX_DAYS_AHEAD} дней вперёд.</p>
      <label class="field">
        <span class="field__label">Дата записи</span>
        <input class="field__input pb-date-input" type="date" id="pb-date-input" min="${today}" max="${maxDate}" value="${value}">
      </label>
      <div class="pb-panel__actions">
        <button class="btn btn--ghost" type="button" data-action="back">Назад</button>
        <button class="btn btn--primary" type="button" data-action="continue-date">Продолжить</button>
      </div>
    `;
  }

  function renderTimeStep(state) {
    if (!state.slots.length) {
      return `
        <h2 class="pb-panel__title">Выберите время</h2>
        <div class="pb-empty">На эту дату свободного времени нет.</div>
        <div class="pb-panel__actions">
          <button class="btn btn--ghost" type="button" data-action="back">Выбрать другую дату</button>
        </div>
      `;
    }

    return `
      <h2 class="pb-panel__title">Выберите время</h2>
      <p class="pb-panel__hint">${escapeHtml(formatDateRu(state.selection.bookingDate))}</p>
      <div class="pb-slots">
        ${state.slots
          .map(
            (slot) => `
              <button class="pb-slot ${state.selection.startTime === slot.start_time ? "is-selected" : ""}" type="button" data-action="select-slot" data-start="${slot.start_time}" data-end="${slot.end_time}">
                ${escapeHtml(slot.start_time)}
              </button>
            `
          )
          .join("")}
      </div>
      <div class="pb-panel__actions">
        <button class="btn btn--ghost" type="button" data-action="back">Назад</button>
      </div>
    `;
  }

  function renderClientStep(state) {
    return `
      <h2 class="pb-panel__title">Ваши контакты</h2>
      <form class="pb-form-grid" id="pb-client-form">
        <label class="field">
          <span class="field__label">Имя</span>
          <input class="field__input" name="client_name" required minlength="2" maxlength="100" value="${escapeHtml(state.selection.clientName)}">
        </label>
        <label class="field">
          <span class="field__label">Телефон</span>
          <input class="field__input" name="client_phone" required minlength="7" maxlength="30" value="${escapeHtml(state.selection.clientPhone)}">
        </label>
        <label class="field">
          <span class="field__label">Email (необязательно)</span>
          <input class="field__input" type="email" name="client_email" maxlength="150" value="${escapeHtml(state.selection.clientEmail)}">
        </label>
        <label class="field">
          <span class="field__label">Комментарий (необязательно)</span>
          <textarea class="field__textarea" name="client_comment" rows="3" maxlength="500">${escapeHtml(state.selection.clientComment)}</textarea>
        </label>
        <label class="field field--checkbox">
          <input type="checkbox" name="consent" ${state.selection.consent ? "checked" : ""}>
          <span>Я согласен на обработку данных для создания записи</span>
        </label>
        <label class="pb-honeypot" aria-hidden="true">
          <span>Website</span>
          <input type="text" name="website" tabindex="-1" autocomplete="off">
        </label>
      </form>
      <div class="pb-panel__actions">
        <button class="btn btn--ghost" type="button" data-action="back">Назад</button>
        <button class="btn btn--primary" type="button" data-action="continue-client">Продолжить</button>
      </div>
    `;
  }

  function renderConfirmStep(state) {
    const service = PublicBookingState.getSelectedService(state);
    const staff = PublicBookingState.getSelectedStaff(state);

    return `
      <h2 class="pb-panel__title">Подтверждение записи</h2>
      <div class="pb-summary">
        <div class="pb-summary__row"><span class="pb-summary__label">Организация</span><span>${escapeHtml(state.organization?.name || "")}</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Услуга</span><span>${escapeHtml(service?.name || "")}</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Сотрудник</span><span>${escapeHtml(staff?.name || "")}</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Дата</span><span>${escapeHtml(formatDateRu(state.selection.bookingDate))}</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Время</span><span>${escapeHtml(state.selection.startTime)} – ${escapeHtml(state.selection.endTime)}</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Длительность</span><span>${service?.duration_minutes || "—"} мин</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Цена</span><span>${escapeHtml(formatPrice(service?.price, service?.currency))}</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Имя</span><span>${escapeHtml(state.selection.clientName)}</span></div>
        <div class="pb-summary__row"><span class="pb-summary__label">Телефон</span><span>${escapeHtml(state.selection.clientPhone)}</span></div>
        ${state.selection.clientEmail ? `<div class="pb-summary__row"><span class="pb-summary__label">Email</span><span>${escapeHtml(state.selection.clientEmail)}</span></div>` : ""}
        ${state.selection.clientComment ? `<div class="pb-summary__row"><span class="pb-summary__label">Комментарий</span><span>${escapeHtml(state.selection.clientComment)}</span></div>` : ""}
      </div>
      <div class="pb-panel__actions">
        <button class="btn btn--ghost" type="button" data-action="back">Назад</button>
        <button class="btn btn--primary" type="button" data-action="submit-booking" id="pb-submit-btn">Подтвердить запись</button>
      </div>
    `;
  }

  return {
    cacheElements,
    showLoader,
    showError,
    showFlow,
    showSuccess,
    renderOrganization,
    renderPanel,
    escapeHtml,
    formatDateRu,
    els,
  };
})();
