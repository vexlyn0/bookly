window.PublicBookingUI = (() => {
  const els = {};
  const DAY_STRIP_LENGTH = 14;
  const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const DEFAULT_BRAND = "#534AB7";

  function cacheElements() {
    els.loader = document.getElementById("pb-loader");
    els.errorScreen = document.getElementById("pb-error-screen");
    els.errorTitle = document.getElementById("pb-error-title");
    els.errorText = document.getElementById("pb-error-text");
    els.cover = document.getElementById("pb-cover");
    els.flow = document.getElementById("pb-flow");
    els.success = document.getElementById("pb-success");
    els.logo = document.getElementById("pb-org-logo");
    els.heroName = document.getElementById("pb-org-name");
    els.heroDescription = document.getElementById("pb-org-description");
    els.heroMeta = document.getElementById("pb-org-meta");
    els.steps = document.getElementById("pb-steps");
    els.panel = document.getElementById("pb-panel");
    els.successStatus = document.getElementById("pb-success-status");
    els.successDetails = document.getElementById("pb-success-details");
    els.successRestart = document.getElementById("pb-success-restart");
    els.powered = document.getElementById("pb-powered");
  }

  // ---------------------------------------------------------------------------
  // Форматирование
  // ---------------------------------------------------------------------------

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatPrice(price, currency = "KZT") {
    const value = Number(price || 0);
    if (!value) return "";
    if (currency === "KZT") return `${value.toLocaleString("ru-RU")} ₸`;
    return `${value} ${currency}`;
  }

  function formatDuration(minutes) {
    const value = Number(minutes) || 0;
    const h = Math.floor(value / 60);
    const m = value % 60;
    if (h && m) return `${h} ч ${m} мин`;
    if (h) return `${h} ч`;
    return `${m} мин`;
  }

  function parseDate(dateStr) {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDateRu(dateStr) {
    if (!dateStr) return "—";
    return parseDate(dateStr).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  }

  /** «Сегодня» / «Завтра» / «пт, 31 октября» */
  function formatDayLabel(dateStr) {
    const today = PublicBookingState.getTodayString();
    if (dateStr === today) return "Сегодня";
    if (dateStr === PublicBookingState.addDays(today, 1)) return "Завтра";
    return parseDate(dateStr).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
  }

  function initials(name) {
    return (
      String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase() || "?"
    );
  }

  function dayIndex(dateStr) {
    return (parseDate(dateStr).getDay() + 6) % 7;
  }

  // ---------------------------------------------------------------------------
  // Экраны
  // ---------------------------------------------------------------------------

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
    window.scrollTo({ top: 0, behavior: "smooth" });

    const booking = result.booking;
    els.successStatus.textContent =
      booking.status === "pending" ? "Салон подтвердит запись — мы сообщим" : "Ждём вас!";

    els.successDetails.innerHTML = `
      <div><dt>Когда</dt><dd>${escapeHtml(formatDayLabel(booking.booking_date))}, ${escapeHtml(booking.start_time)}–${escapeHtml(booking.end_time)}</dd></div>
      <div><dt>Услуга</dt><dd>${escapeHtml(booking.service_name)}</dd></div>
      <div><dt>Мастер</dt><dd>${escapeHtml(booking.staff_name)}</dd></div>
      <div><dt>Номер записи</dt><dd>${escapeHtml(booking.reference)}</dd></div>
    `;

    renderManageLink(booking);
  }

  /** Личная ссылка клиента: перенос / отмена записи. */
  function renderManageLink(booking) {
    const block = document.getElementById("pb-manage-link");
    if (!block) return;

    block.hidden = !booking.manage_url;
    if (!booking.manage_url) return;

    const url = `${window.location.origin}${booking.manage_url}`;
    const orgName = els.heroName?.textContent || "";
    const message =
      `Моя запись${orgName ? ` в «${orgName}»` : ""}: ${booking.service_name}, ` +
      `${formatDateRu(booking.booking_date)} в ${booking.start_time}. ` +
      `Перенести или отменить: ${url}`;

    document.getElementById("pb-manage-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(message)}`;

    const copyBtn = document.getElementById("pb-manage-copy");
    copyBtn.textContent = "Скопировать ссылку";
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = "Скопировано ✓";
      } catch {
        window.prompt("Скопируйте ссылку:", url);
      }
    };
  }

  /** Обложка: фирменный цвет, логотип-инициалы, адрес и телефон. */
  function renderOrganization(organization) {
    const brand = /^#[0-9a-f]{6}$/i.test(organization.brand_color || "") ? organization.brand_color : DEFAULT_BRAND;
    document.documentElement.style.setProperty("--brand", brand);
    document.getElementById("pb-theme-color")?.setAttribute("content", brand);

    els.cover.hidden = false;
    els.logo.textContent = initials(organization.name).slice(0, 1);
    els.heroName.textContent = organization.name || "—";
    els.heroDescription.textContent = organization.description || "";
    els.heroDescription.hidden = !organization.description;
    document.title = `${organization.name} — онлайн-запись`;

    const meta = [];
    if (organization.address) {
      meta.push(`<span class="pb-chip"><span aria-hidden="true">📍</span>${escapeHtml(organization.address)}</span>`);
    }
    if (organization.phone) {
      const tel = organization.phone.replace(/[^\d+]/g, "");
      meta.push(
        `<a class="pb-chip" href="tel:${escapeHtml(tel)}"><span aria-hidden="true">📞</span>${escapeHtml(organization.phone)}</a>`
      );
    }
    els.heroMeta.innerHTML = meta.join("");

    // Free: подпись Bookly внизу страницы; Pro — без брендинга Bookly.
    if (els.powered) els.powered.hidden = organization.show_branding === false;
  }

  function renderProgress(state) {
    const steps = PublicBookingState.STEPS;
    const index = Math.max(0, PublicBookingState.getStepIndex(state.step));
    const percent = Math.round(((index + 1) / steps.length) * 100);

    els.steps.innerHTML = `
      <div class="pb-progress__row">
        <span class="pb-progress__label">${escapeHtml(steps[index].label)}</span>
        <span class="pb-progress__count">Шаг ${index + 1} из ${steps.length}</span>
      </div>
      <div class="pb-progress__bar"><div class="pb-progress__fill" style="width:${percent}%"></div></div>
    `;
  }

  function backButton() {
    return `<button class="pb-back" type="button" data-action="back"><span aria-hidden="true">←</span> Назад</button>`;
  }

  function renderPanel(state) {
    renderProgress(state);

    if (state.loading) {
      els.panel.innerHTML = `<div class="pb-loader"><div class="pb-loader__spinner" aria-hidden="true"></div></div>`;
      return;
    }

    const errorHtml = state.error
      ? `<p class="alert alert--error pb-alert" role="alert">${escapeHtml(state.error)}</p>`
      : "";

    const renderers = {
      service: renderServiceStep,
      staff: renderStaffStep,
      time: renderTimeStep,
      client: renderClientStep,
      confirm: renderConfirmStep,
    };
    els.panel.innerHTML = (renderers[state.step]?.(state) || "") + errorHtml;
  }

  // ---------------------------------------------------------------------------
  // Шаги
  // ---------------------------------------------------------------------------

  function renderServiceStep(state) {
    if (!state.services.length) {
      return `<div class="pb-empty">Сейчас нет доступных услуг для онлайн-записи.</div>`;
    }

    return `
      <h2 class="pb-panel__title">Выберите услугу</h2>
      <div class="pb-list">
        ${state.services
          .map((service) => {
            const price = formatPrice(service.price, service.currency);
            return `
              <button class="pb-service ${state.selection.serviceId === service.id ? "is-selected" : ""}" type="button" data-action="select-service" data-id="${service.id}">
                <span class="pb-service__body">
                  <span class="pb-service__name">${escapeHtml(service.name)}</span>
                  ${service.description ? `<span class="pb-service__text">${escapeHtml(service.description)}</span>` : ""}
                  <span class="pb-service__meta">${escapeHtml(formatDuration(service.duration_minutes))}</span>
                </span>
                <span class="pb-price">${price ? escapeHtml(price) : "Выбрать"}</span>
              </button>`;
          })
          .join("")}
      </div>
    `;
  }

  function renderStaffStep(state) {
    if (!state.staff.length) {
      return `
        ${backButton()}
        <h2 class="pb-panel__title">Выберите мастера</h2>
        <div class="pb-empty">Для этой услуги сейчас нет свободных мастеров.</div>
      `;
    }

    return `
      ${backButton()}
      <h2 class="pb-panel__title">Выберите мастера</h2>
      <div class="pb-masters">
        ${state.staff
          .map((member) => {
            const next = member.next_available;
            const nextText = next
              ? `${formatDayLabel(next.date)}, ${next.start_time}`
              : "Нет окон на 2 недели";
            return `
              <button class="pb-master ${state.selection.staffId === member.id ? "is-selected" : ""} ${next ? "" : "is-busy"}" type="button" data-action="select-staff" data-id="${member.id}">
                <span class="pb-avatar">${escapeHtml(initials(member.name))}</span>
                <span class="pb-master__name">${escapeHtml(member.name)}</span>
                ${member.position ? `<span class="pb-master__position">${escapeHtml(member.position)}</span>` : ""}
                <span class="pb-master__next">${next ? "Ближайшее: " : ""}${escapeHtml(nextText)}</span>
              </button>`;
          })
          .join("")}
      </div>
    `;
  }

  function renderDayStrip(state, staff) {
    const today = PublicBookingState.getTodayString();
    const selected = state.selection.bookingDate;
    const workDays = Array.isArray(staff?.work_days) ? staff.work_days : null;

    let days = Array.from({ length: DAY_STRIP_LENGTH }, (_, i) => PublicBookingState.addDays(today, i));
    // Дата из «Другая дата» вне ленты — показываем её первой, чтобы было видно выбор.
    if (selected && !days.includes(selected)) days = [selected, ...days];

    const chips = days
      .map((date) => {
        const d = parseDate(date);
        const off = workDays && !workDays.includes(dayIndex(date));
        const label = date === today ? "сег" : WEEKDAYS_SHORT[d.getDay()];
        return `
          <button class="pb-day ${date === selected ? "is-selected" : ""} ${off ? "is-off" : ""}" type="button" data-action="select-day" data-date="${date}" ${off ? 'aria-disabled="true" title="Выходной"' : ""}>
            <span class="pb-day__week">${label}</span>
            <span class="pb-day__num">${d.getDate()}</span>
          </button>`;
      })
      .join("");

    const monthTitle = parseDate(selected || today)
      .toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
      .replace(/\s*г\.?$/, "");

    return `
      <div class="pb-days-head">
        <span class="pb-days-head__month">${escapeHtml(monthTitle)}</span>
        <label class="pb-other-date">
          Другая дата
          <input type="date" id="pb-date-input" min="${today}" max="${PublicBookingState.getMaxDateString()}" value="${escapeHtml(selected || today)}">
        </label>
      </div>
      <div class="pb-days" role="listbox" aria-label="Дата">${chips}</div>
    `;
  }

  function renderSlots(state, staff) {
    if (state.slotsLoading) {
      return `<div class="pb-loader pb-loader--inline"><div class="pb-loader__spinner" aria-hidden="true"></div></div>`;
    }

    if (!state.slots.length) {
      const next = staff?.next_available;
      const offerNext = next && next.date !== state.selection.bookingDate && next.date > state.selection.bookingDate;
      return `
        <div class="pb-empty">
          В этот день свободного времени нет.
          ${
            offerNext
              ? `<button class="pb-link" type="button" data-action="select-day" data-date="${next.date}">Ближайшее: ${escapeHtml(formatDayLabel(next.date))}, ${escapeHtml(next.start_time)} →</button>`
              : ""
          }
        </div>`;
    }

    const groups = [
      { title: "Утро", from: 0, to: 12 * 60 },
      { title: "День", from: 12 * 60, to: 17 * 60 },
      { title: "Вечер", from: 17 * 60, to: 24 * 60 },
    ];
    const toMinutes = (time) => {
      const [h, m] = String(time).split(":").map(Number);
      return h * 60 + m;
    };

    return groups
      .map((group) => {
        const slots = state.slots.filter((slot) => {
          const minutes = toMinutes(slot.start_time);
          return minutes >= group.from && minutes < group.to;
        });
        if (!slots.length) return "";
        return `
          <div class="pb-slot-group">
            <p class="pb-slot-group__title">${group.title}</p>
            <div class="pb-slots">
              ${slots
                .map(
                  (slot) => `
                    <button class="pb-slot ${state.selection.startTime === slot.start_time ? "is-selected" : ""}" type="button" data-action="select-slot" data-start="${slot.start_time}" data-end="${slot.end_time}">
                      ${escapeHtml(slot.start_time)}
                    </button>`
                )
                .join("")}
            </div>
          </div>`;
      })
      .join("");
  }

  function renderTimeStep(state) {
    const staff = PublicBookingState.getSelectedStaff(state);
    const service = PublicBookingState.getSelectedService(state);

    return `
      ${backButton()}
      <h2 class="pb-panel__title">Выберите дату и время</h2>
      <p class="pb-panel__hint">${escapeHtml(service?.name || "")}${staff ? ` · ${escapeHtml(staff.name)}` : ""}</p>
      ${renderDayStrip(state, staff)}
      <div class="pb-slots-area">${renderSlots(state, staff)}</div>
    `;
  }

  function renderClientStep(state) {
    return `
      ${backButton()}
      <h2 class="pb-panel__title">Ваши контакты</h2>
      <p class="pb-panel__hint">${escapeHtml(formatDayLabel(state.selection.bookingDate))}, ${escapeHtml(state.selection.startTime)} — осталось указать имя и телефон.</p>
      <form class="pb-form-grid" id="pb-client-form">
        <label class="field">
          <span class="field__label">Имя</span>
          <input class="field__input" name="client_name" required minlength="2" maxlength="100" autocomplete="name" value="${escapeHtml(state.selection.clientName)}">
        </label>
        <label class="field">
          <span class="field__label">Телефон</span>
          <input class="field__input" name="client_phone" type="tel" required minlength="7" maxlength="30" autocomplete="tel" inputmode="tel" placeholder="+7 700 000 00 00" value="${escapeHtml(state.selection.clientPhone)}">
        </label>
        <label class="field">
          <span class="field__label">Комментарий <span class="pb-optional">— необязательно</span></span>
          <textarea class="field__textarea" name="client_comment" rows="2" maxlength="500">${escapeHtml(state.selection.clientComment)}</textarea>
        </label>
        <input type="hidden" name="client_email" value="${escapeHtml(state.selection.clientEmail)}">
        <label class="pb-consent">
          <input type="checkbox" name="consent" ${state.selection.consent ? "checked" : ""}>
          <span>Согласен на обработку данных для записи</span>
        </label>
        <label class="pb-honeypot" aria-hidden="true">
          <span>Website</span>
          <input type="text" name="website" tabindex="-1" autocomplete="off">
        </label>
      </form>
      <button class="pb-btn" type="button" data-action="continue-client">Продолжить</button>
    `;
  }

  function renderConfirmStep(state) {
    const service = PublicBookingState.getSelectedService(state);
    const staff = PublicBookingState.getSelectedStaff(state);
    const price = formatPrice(service?.price, service?.currency);

    return `
      ${backButton()}
      <h2 class="pb-panel__title">Проверьте запись</h2>
      <div class="pb-ticket">
        <div class="pb-ticket__when">
          <span class="pb-ticket__day">${escapeHtml(formatDayLabel(state.selection.bookingDate))}</span>
          <span class="pb-ticket__time">${escapeHtml(state.selection.startTime)}–${escapeHtml(state.selection.endTime)}</span>
        </div>
        <div class="pb-ticket__rows">
          <div class="pb-ticket__row"><span>Услуга</span><span>${escapeHtml(service?.name || "")}</span></div>
          <div class="pb-ticket__row"><span>Мастер</span><span>${escapeHtml(staff?.name || "")}</span></div>
          <div class="pb-ticket__row"><span>Длительность</span><span>${escapeHtml(formatDuration(service?.duration_minutes))}</span></div>
          ${price ? `<div class="pb-ticket__row"><span>Цена</span><span>${escapeHtml(price)}</span></div>` : ""}
          <div class="pb-ticket__row"><span>Имя</span><span>${escapeHtml(state.selection.clientName)}</span></div>
          <div class="pb-ticket__row"><span>Телефон</span><span>${escapeHtml(state.selection.clientPhone)}</span></div>
          ${state.selection.clientComment ? `<div class="pb-ticket__row"><span>Комментарий</span><span>${escapeHtml(state.selection.clientComment)}</span></div>` : ""}
        </div>
      </div>
      ${renderVerification(state)}
    `;
  }

  /** Кнопка подтверждения записи или шаг «Подтвердите номер в Telegram». */
  function renderVerification(state) {
    const required = state.organization?.phone_verification_required;
    const v = state.verification;
    const verified = v?.status === "verified" && v.phone === state.selection.clientPhone;
    const phone = escapeHtml(state.selection.clientPhone);

    if (!required || verified) {
      return `<button class="pb-btn" type="button" data-action="submit-booking" id="pb-submit-btn">Записаться</button>`;
    }

    if (v?.status === "waiting") {
      return `
        <div class="pb-verify">
          <p class="pb-verify__title">Подтвердите номер ${phone}</p>
          <ol class="pb-verify__steps">
            <li>Откройте Telegram кнопкой ниже.</li>
            <li>Нажмите <b>Start</b>, затем <b>«Поделиться номером»</b>.</li>
            <li>Вернитесь сюда — запись создастся сама.</li>
          </ol>
          <a class="btn btn--primary pb-verify__open" href="${escapeHtml(v.botUrl)}" target="_blank" rel="noopener">Открыть Telegram</a>
          <p class="pb-verify__wait"><span class="pb-verify__spinner" aria-hidden="true"></span>Ждём подтверждения…</p>
        </div>
        <button class="pb-btn pb-btn--ghost" type="button" data-action="change-phone">Изменить номер</button>`;
    }

    if (v?.status === "mismatch" || v?.status === "expired") {
      const text =
        v.status === "mismatch"
          ? `Номер вашего Telegram не совпадает с ${phone}. Укажите номер, к которому привязан Telegram.`
          : "Время на подтверждение истекло. Попробуйте ещё раз.";
      return `
        <p class="alert alert--error pb-alert" role="alert">${text}</p>
        <button class="pb-btn" type="button" data-action="retry-verification">Подтвердить ещё раз</button>
        <button class="pb-btn pb-btn--ghost" type="button" data-action="change-phone">Изменить номер</button>`;
    }

    return `
      <p class="pb-verify__note">Салон просит подтвердить номер в Telegram — это защищает расписание от фейковых записей. Бесплатно, 10 секунд.</p>
      <button class="pb-btn" type="button" data-action="submit-booking" id="pb-submit-btn" ${v?.status === "creating" ? "disabled" : ""}>
        ${v?.status === "creating" ? "Подождите…" : "Подтвердить номер в Telegram"}
      </button>`;
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
