window.PublicBookingUI = (() => {
  const els = {};
  const DAY_STRIP_LENGTH = 14;
  const DEFAULT_BRAND = "#534AB7";
  const I18n = window.PublicBookingI18n;
  const t = (key, vars) => I18n.t(key, vars);

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
    if (currency === "KZT") return `${value.toLocaleString("ru-RU")} ₸`; // пробелы между разрядами в обоих языках
    return `${value} ${currency}`;
  }

  function formatDuration(minutes) {
    const value = Number(minutes) || 0;
    const h = Math.floor(value / 60);
    const m = value % 60;
    if (h && m) return `${t("duration_h", { h })} ${t("duration_m", { m })}`;
    if (h) return t("duration_h", { h });
    return t("duration_m", { m });
  }

  function parseDate(dateStr) {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDateRu(dateStr) {
    if (!dateStr) return "—";
    return I18n.formatDate(parseDate(dateStr), "full");
  }

  /** «Сегодня» / «Завтра» / «пт, 31 октября» */
  function formatDayLabel(dateStr) {
    const today = PublicBookingState.getTodayString();
    if (dateStr === today) return t("today");
    if (dateStr === PublicBookingState.addDays(today, 1)) return t("tomorrow");
    return I18n.formatDate(parseDate(dateStr), "weekdayShort");
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
      booking.status === "pending" ? t("success_pending") : t("success_confirmed");

    els.successDetails.innerHTML = `
      <div><dt>${t("when")}</dt><dd>${escapeHtml(formatDayLabel(booking.booking_date))}, ${escapeHtml(booking.start_time)}–${escapeHtml(booking.end_time)}</dd></div>
      <div><dt>${t("service")}</dt><dd>${escapeHtml(booking.service_name)}</dd></div>
      <div><dt>${t("master")}</dt><dd>${escapeHtml(booking.staff_name)}</dd></div>
      <div><dt>${t("reference")}</dt><dd>${escapeHtml(booking.reference)}</dd></div>
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
    const message = t("whatsapp_message", {
      org: orgName ? t("whatsapp_org", { org: orgName }) : "",
      service: booking.service_name,
      date: formatDateRu(booking.booking_date),
      time: booking.start_time,
      url,
    });

    document.getElementById("pb-manage-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(message)}`;

    const copyBtn = document.getElementById("pb-manage-copy");
    copyBtn.textContent = t("copy_link");
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = t("copied");
      } catch {
        window.prompt(t("copy_prompt"), url);
      }
    };
  }

  /** Обложка: фирменный цвет, логотип-инициалы, адрес и телефон. */
  function renderOrganization(organization) {
    const brand = /^#[0-9a-f]{6}$/i.test(organization.brand_color || "") ? organization.brand_color : DEFAULT_BRAND;
    document.documentElement.style.setProperty("--brand", brand);
    document.getElementById("pb-theme-color")?.setAttribute("content", brand);

    els.cover.hidden = false;
    const band = els.cover.querySelector(".pb-cover__band");
    if (band) {
      band.classList.toggle("has-photo", Boolean(organization.cover_url));
      band.style.backgroundImage = organization.cover_url ? `url("${organization.cover_url.replace(/"/g, "%22")}")` : "";
    }
    els.logo.classList.toggle("has-photo", Boolean(organization.logo_url));
    els.logo.innerHTML = organization.logo_url
      ? `<img src="${escapeHtml(organization.logo_url)}" alt="">`
      : escapeHtml(initials(organization.name).slice(0, 1));
    els.heroName.textContent = organization.name || "—";
    els.heroDescription.textContent = organization.description || "";
    els.heroDescription.hidden = !organization.description;
    document.title = t("page_title", { org: organization.name });

    const meta = [];
    const status = statusText(organization.status);
    if (status) {
      meta.push(
        `<span class="pb-chip pb-chip--status${organization.status.open_now ? " is-open" : ""}"><span class="pb-dot" aria-hidden="true"></span>${escapeHtml(status)}</span>`
      );
    }
    if (organization.address) {
      meta.push(
        `<a class="pb-chip" href="${escapeHtml(routeUrl(organization))}" target="_blank" rel="noopener"><span aria-hidden="true">📍</span>${escapeHtml(organization.address)}</a>`
      );
    }
    els.heroMeta.innerHTML = meta.join("");

    const contacts = [];
    const instagram = instagramUrl(organization.instagram);
    if (instagram) {
      contacts.push(`<a class="pb-contact" href="${escapeHtml(instagram)}" target="_blank" rel="noopener">${ICONS.instagram}<span>Instagram</span></a>`);
    }
    const whatsapp = whatsappUrl(organization.whatsapp);
    if (whatsapp) {
      contacts.push(`<a class="pb-contact" href="${escapeHtml(whatsapp)}" target="_blank" rel="noopener">${ICONS.whatsapp}<span>WhatsApp</span></a>`);
    }
    if (organization.phone) {
      const tel = organization.phone.replace(/[^\d+]/g, "");
      contacts.push(`<a class="pb-contact" href="tel:${escapeHtml(tel)}">${ICONS.phone}<span>${escapeHtml(t("call_short"))}</span></a>`);
    }
    const contactsBox = document.getElementById("pb-org-contacts");
    if (contactsBox) {
      contactsBox.innerHTML = contacts.join("");
      contactsBox.hidden = !contacts.length;
    }

    renderInfo(organization);

    // Free: подпись Jazyl внизу страницы; Pro — без брендинга Jazyl.
    if (els.powered) els.powered.hidden = organization.show_branding === false;
  }

  // ---------------------------------------------------------------------------
  // Профиль салона: «открыто», контакты, часы, «Наши работы», маршрут
  // ---------------------------------------------------------------------------

  const ICONS = {
    instagram:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
    whatsapp:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 1c-1.2-.5-2.4-1.7-3-3l1-1-1-2z" stroke-width="1.5"/></svg>',
    phone:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/></svg>',
  };

  function instagramUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^https:\/\//i.test(raw)) return raw;
    const nick = raw.replace(/^@/, "").replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "");
    return /^[a-z0-9._]{1,30}$/i.test(nick) ? `https://instagram.com/${nick}` : "";
  }

  function whatsappUrl(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
    if (digits.length === 10) digits = `7${digits}`;
    return digits.length >= 11 ? `https://wa.me/${digits}` : "";
  }

  function routeUrl(organization) {
    if (/^https:\/\//i.test(organization.gis_url || "")) return organization.gis_url;
    return `https://2gis.kz/search/${encodeURIComponent(organization.address || "")}`;
  }

  /** «Открыто до 20:00» / «Откроется завтра в 10:00» / «Сейчас закрыто». */
  function statusText(status) {
    if (!status) return "";
    if (status.open_now) return t("open_until", { time: status.closes_at });
    if (!status.opens_at) return t("closed_now");
    const today = PublicBookingState.getTodayString();
    let when;
    if (status.opens_date === today) when = t("when_today", { time: status.opens_at });
    else if (status.opens_date === PublicBookingState.addDays(today, 1)) when = t("when_tomorrow", { time: status.opens_at });
    else when = t("when_day", { day: t("weekdays_acc").split(",")[parseDate(status.opens_date).getDay()], time: status.opens_at });
    return t("opens_at", { when });
  }

  function renderInfo(organization) {
    const box = document.getElementById("pb-info");
    if (!box) return;
    const parts = [];

    const photos = Array.isArray(organization.portfolio) ? organization.portfolio : [];
    if (photos.length) {
      parts.push(`
        <section class="pb-info__card">
          <h2 class="pb-info__title">${escapeHtml(t("works_title"))}</h2>
          <div class="pb-works">
            ${photos
              .map(
                (url) =>
                  `<button type="button" class="pb-works__item" data-photo="${escapeHtml(url)}"><img src="${escapeHtml(url)}" alt="" loading="lazy"></button>`
              )
              .join("")}
          </div>
        </section>`);
    }

    const hours = Array.isArray(organization.hours) ? organization.hours : [];
    if (hours.some(Boolean)) {
      const names = t("weekdays_mon").split(",");
      const todayIndex = (new Date().getDay() + 6) % 7;
      parts.push(`
        <section class="pb-info__card">
          <h2 class="pb-info__title">${escapeHtml(t("hours_title"))}</h2>
          <dl class="pb-hours">
            ${hours
              .map(
                (day, i) => `
              <div class="pb-hours__row${i === todayIndex ? " is-today" : ""}">
                <dt>${escapeHtml(names[i])}</dt>
                <dd>${day ? `${escapeHtml(day.open)}–${escapeHtml(day.close)}` : escapeHtml(t("hours_off"))}</dd>
              </div>`
              )
              .join("")}
          </dl>
        </section>`);
    }

    if (organization.address) {
      parts.push(`
        <section class="pb-info__card">
          <h2 class="pb-info__title">${escapeHtml(t("route_title"))}</h2>
          <p class="pb-info__text">${escapeHtml(organization.address)}</p>
          <a class="pb-btn pb-btn--ghost pb-info__route" href="${escapeHtml(routeUrl(organization))}" target="_blank" rel="noopener">${escapeHtml(t("route_btn"))} →</a>
        </section>`);
    }

    box.innerHTML = parts.join("");
    box.hidden = !parts.length;
  }

  // Просмотр фото «Наши работы» на весь экран
  document.addEventListener("click", (event) => {
    const lightbox = document.getElementById("pb-lightbox");
    if (!lightbox) return;
    const photo = event.target.closest("[data-photo]");
    if (photo) {
      document.getElementById("pb-lightbox-img").src = photo.dataset.photo;
      lightbox.hidden = false;
      return;
    }
    if (!lightbox.hidden && (event.target === lightbox || event.target.closest(".pb-lightbox__close"))) {
      lightbox.hidden = true;
    }
  });
  document.addEventListener("keydown", (event) => {
    const lightbox = document.getElementById("pb-lightbox");
    if (event.key === "Escape" && lightbox && !lightbox.hidden) lightbox.hidden = true;
  });

  function renderProgress(state) {
    const steps = PublicBookingState.STEPS;
    const index = Math.max(0, PublicBookingState.getStepIndex(state.step));
    const percent = Math.round(((index + 1) / steps.length) * 100);

    els.steps.innerHTML = `
      <div class="pb-progress__row">
        <span class="pb-progress__label">${escapeHtml(t(`step_${steps[index].id}`))}</span>
        <span class="pb-progress__count">${t("step_count", { n: index + 1, total: steps.length })}</span>
      </div>
      <div class="pb-progress__bar"><div class="pb-progress__fill" style="width:${percent}%"></div></div>
    `;
  }

  function backButton() {
    return `<button class="pb-back" type="button" data-action="back"><span aria-hidden="true">←</span> ${t("back")}</button>`;
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
    };
    els.panel.innerHTML = (renderers[state.step]?.(state) || "") + errorHtml;
  }

  // ---------------------------------------------------------------------------
  // Шаги
  // ---------------------------------------------------------------------------

  function renderServiceStep(state) {
    if (!state.services.length) {
      return `<div class="pb-empty">${t("no_services")}</div>`;
    }

    // Категории: вкладки «Все · Стрижки · …», если категорий хотя бы две.
    const categories = [...new Set(state.services.map((s) => s.category || ""))];
    const named = categories.filter(Boolean);
    const useCategories = named.length >= 2 || (named.length === 1 && categories.length === 2);
    const active = useCategories && categories.includes(state.serviceCategory) ? state.serviceCategory : null;

    const tabs = useCategories
      ? `<div class="pb-tabs" role="tablist">
          <button type="button" role="tab" class="pb-tab${active === null ? " is-active" : ""}" data-action="select-category" data-category="__all">${escapeHtml(t("all_services"))}</button>
          ${categories
            .map(
              (c) =>
                `<button type="button" role="tab" class="pb-tab${active === c ? " is-active" : ""}" data-action="select-category" data-category="${escapeHtml(c)}">${escapeHtml(c || t("other_services"))}</button>`
            )
            .join("")}
        </div>`
      : "";

    const list = (services) =>
      `<div class="pb-list">${services.map((service) => renderServiceItem(state, service)).join("")}</div>`;

    let body;
    if (!useCategories) {
      body = list(state.services);
    } else if (active !== null) {
      body = list(state.services.filter((s) => (s.category || "") === active));
    } else {
      // «Все» — группами по категориям, без категории — в конце
      const ordered = [...named, ...(categories.includes("") ? [""] : [])];
      body = ordered
        .map(
          (c) => `
          <p class="pb-group-title">${escapeHtml(c || t("other_services"))}</p>
          ${list(state.services.filter((s) => (s.category || "") === c))}`
        )
        .join("");
    }

    return `
      <h2 class="pb-panel__title">${t("choose_service")}</h2>
      ${tabs}
      ${body}
    `;
  }

  function renderServiceItem(state, service) {
    const price = formatPrice(service.price, service.currency);
    return `
      <button class="pb-service ${state.selection.serviceId === service.id ? "is-selected" : ""}" type="button" data-action="select-service" data-id="${service.id}">
        ${service.photo_url ? `<span class="pb-service__photo"><img src="${escapeHtml(service.photo_url)}" alt="" loading="lazy"></span>` : ""}
        <span class="pb-service__body">
          <span class="pb-service__name">${escapeHtml(service.name)}${service.is_popular ? ` <span class="pb-badge">${escapeHtml(t("popular"))}</span>` : ""}</span>
          ${service.description ? `<span class="pb-service__text">${escapeHtml(service.description)}</span>` : ""}
          <span class="pb-service__meta">${escapeHtml(formatDuration(service.duration_minutes))}</span>
        </span>
        <span class="pb-price">${price ? escapeHtml(price) : t("choose")}</span>
      </button>`;
  }

  function renderStaffStep(state) {
    if (!state.staff.length) {
      return `
        ${backButton()}
        <h2 class="pb-panel__title">${t("choose_master")}</h2>
        <div class="pb-empty">${t("no_masters")}</div>
      `;
    }

    const anyNext = state.staff
      .filter((m) => m.next_available)
      .map((m) => m.next_available)
      .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`))[0];
    const anyCard =
      state.staff.length > 1 && anyNext
        ? `
          <button class="pb-master pb-master--any" type="button" data-action="select-any">
            <span class="pb-avatar">★</span>
            <span class="pb-master__name">${t("any_master")}</span>
            <span class="pb-master__position">${t("any_master_hint")}</span>
            <span class="pb-master__next">${escapeHtml(formatDayLabel(anyNext.date))}, ${escapeHtml(anyNext.start_time)}</span>
          </button>`
        : "";

    return `
      ${backButton()}
      <h2 class="pb-panel__title">${t("choose_master")}</h2>
      <p class="pb-panel__hint">${t("masters_hint")}</p>
      <div class="pb-masters">
        ${anyCard}
        ${state.staff
          .map((member) => {
            const next = member.next_available;
            const nextText = next
              ? `${formatDayLabel(next.date)}, ${next.start_time}`
              : t("no_windows");
            return `
              <button class="pb-master ${state.selection.staffId === member.id ? "is-selected" : ""} ${next ? "" : "is-busy"}" type="button" data-action="select-staff" data-id="${member.id}">
                <span class="pb-avatar${member.photo_url ? " has-photo" : ""}">${
                  member.photo_url ? `<img src="${escapeHtml(member.photo_url)}" alt="" loading="lazy">` : escapeHtml(initials(member.name))
                }</span>
                <span class="pb-master__name">${escapeHtml(member.name)}</span>
                ${member.position ? `<span class="pb-master__position">${escapeHtml(member.position)}</span>` : ""}
                <span class="pb-master__next" ${next ? `data-action="select-next" data-id="${member.id}" title="${escapeHtml(t("book_this_time"))}"` : ""}>${next ? "⚡ " : ""}${escapeHtml(nextText)}</span>
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
        const label = date === today ? t("today_short") : t("weekdays_short").split(",")[d.getDay()];
        return `
          <button class="pb-day ${date === selected ? "is-selected" : ""} ${off ? "is-off" : ""}" type="button" data-action="select-day" data-date="${date}" ${off ? `aria-disabled="true" title="${escapeHtml(t("day_off"))}"` : ""}>
            <span class="pb-day__week">${label}</span>
            <span class="pb-day__num">${d.getDate()}</span>
          </button>`;
      })
      .join("");

    const monthTitle = I18n.formatDate(parseDate(selected || today), "monthYear");

    return `
      <div class="pb-days-head">
        <span class="pb-days-head__month">${escapeHtml(monthTitle)}</span>
        <label class="pb-other-date">
          ${t("other_date")}
          <input type="date" id="pb-date-input" min="${today}" max="${PublicBookingState.getMaxDateString()}" value="${escapeHtml(selected || today)}">
        </label>
      </div>
      <div class="pb-days" role="listbox" aria-label="${escapeHtml(t("date"))}">${chips}</div>
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
          ${t("no_free_time")}
          ${
            offerNext
              ? `<button class="pb-link" type="button" data-action="select-day" data-date="${next.date}">${escapeHtml(t("nearest", { when: `${formatDayLabel(next.date)}, ${next.start_time}` }))}</button>`
              : ""
          }
        </div>`;
    }

    const groups = [
      { title: t("morning"), from: 0, to: 12 * 60 },
      { title: t("afternoon"), from: 12 * 60, to: 17 * 60 },
      { title: t("evening"), from: 17 * 60, to: 24 * 60 },
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
      <h2 class="pb-panel__title">${t("choose_time")}</h2>
      <p class="pb-panel__hint">${escapeHtml(service?.name || "")}${staff ? ` · ${escapeHtml(staff.name)}` : ""}</p>
      ${renderDayStrip(state, staff)}
      <div class="pb-slots-area">${renderSlots(state, staff)}</div>
    `;
  }

  function renderClientStep(state) {
    const service = PublicBookingState.getSelectedService(state);
    const staff = PublicBookingState.getSelectedStaff(state);
    const price = formatPrice(service?.price, service?.currency);
    const showComment = state.showComment || Boolean(state.selection.clientComment);

    return `
      ${backButton()}
      <h2 class="pb-panel__title">${t("almost_done")}</h2>
      <div class="pb-ticket pb-ticket--compact">
        <div class="pb-ticket__when">
          <span class="pb-ticket__day">${escapeHtml(formatDayLabel(state.selection.bookingDate))}</span>
          <span class="pb-ticket__time">${escapeHtml(state.selection.startTime)}–${escapeHtml(state.selection.endTime)}</span>
        </div>
        <div class="pb-ticket__rows">
          <div class="pb-ticket__row"><span>${escapeHtml(service?.name || "")}</span><span>${escapeHtml(price)}</span></div>
          <div class="pb-ticket__row"><span>${t("master")}</span><span>${escapeHtml(staff?.name || "")}</span></div>
        </div>
      </div>

      <form class="pb-form-grid" id="pb-client-form" onsubmit="return false">
        <label class="field">
          <span class="field__label">${t("your_name")}</span>
          <input class="field__input" name="client_name" required minlength="2" maxlength="100" autocomplete="name" value="${escapeHtml(state.selection.clientName)}">
        </label>
        <label class="field">
          <span class="field__label">${t("phone")}</span>
          <input class="field__input" name="client_phone" type="tel" required maxlength="30" autocomplete="tel" inputmode="tel" placeholder="+7 (700) 000-00-00" value="${escapeHtml(state.selection.clientPhone)}">
        </label>
        ${
          showComment
            ? `<label class="field">
                 <span class="field__label">${t("comment")} <span class="pb-optional">${t("optional")}</span></span>
                 <textarea class="field__textarea" name="client_comment" rows="2" maxlength="500">${escapeHtml(state.selection.clientComment)}</textarea>
               </label>`
            : `<button class="pb-link pb-link--left" type="button" data-action="show-comment">${t("add_comment")}</button>`
        }
        <label class="pb-honeypot" aria-hidden="true">
          <span>Website</span>
          <input type="text" name="website" tabindex="-1" autocomplete="off">
        </label>
      </form>
      ${renderVerification(state)}
    `;
  }

  /** Кнопка подтверждения записи или шаг «Подтвердите номер в Telegram». */
  function renderVerification(state) {
    const v = state.verification;
    const phone = escapeHtml(state.selection.clientPhone);
    const consent = `<p class="pb-consent-note">${t("consent")}</p>`;

    if (v?.status === "waiting") {
      return `
        <div class="pb-verify">
          <p class="pb-verify__title">${t("verify_title", { phone })}</p>
          <ol class="pb-verify__steps">
            <li>${t("verify_step1")}</li>
            <li>${t("verify_step2")}</li>
            <li>${t("verify_step3")}</li>
          </ol>
          <a class="btn btn--primary pb-verify__open" href="${escapeHtml(v.botUrl)}" target="_blank" rel="noopener">${t("verify_open")}</a>
          <p class="pb-verify__wait"><span class="pb-verify__spinner" aria-hidden="true"></span>${t("verify_wait")}</p>
          <p class="pb-verify__note">${t("verify_note")}</p>
        </div>
        <button class="pb-btn pb-btn--ghost" type="button" data-action="change-phone">${t("change_phone")}</button>`;
    }

    if (v?.status === "mismatch" || v?.status === "expired") {
      const text =
        v.status === "mismatch"
          ? t("verify_mismatch", { phone })
          : t("verify_expired");
      return `
        <p class="alert alert--error pb-alert" role="alert">${text}</p>
        <button class="pb-btn" type="button" data-action="retry-verification">${t("verify_retry")}</button>
        <button class="pb-btn pb-btn--ghost" type="button" data-action="change-phone">${t("change_phone")}</button>`;
    }

    if (v?.status === "creating") {
      return `<button class="pb-btn" type="button" disabled>${t("please_wait")}</button>`;
    }

    return `<button class="pb-btn" type="button" data-action="submit-booking" id="pb-submit-btn">${t("submit")}</button>${consent}`;
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
