/**
 * Bookly — разделы «Клиенты» и «Аналитика» (Pro).
 * Free видит описание Pro; Pro и пробный период — настоящие данные.
 * Расчёты — в insights/compute.js (BooklyInsights).
 */
window.BooklyInsightsUI = (() => {
  const SEGMENTS = [
    { id: "all", label: "Все" },
    { id: "lapsed", label: "Давно не были" },
    { id: "regular", label: "Постоянные" },
    { id: "new", label: "Новые" },
    { id: "noshow", label: "С неявками" },
  ];
  const PERIODS = [
    { id: "7", label: "7 дней" },
    { id: "30", label: "30 дней" },
    { id: "90", label: "90 дней" },
    { id: "month", label: "Этот месяц" },
    { id: "prev_month", label: "Прошлый месяц" },
  ];
  const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const STATUS_LABELS = {
    pending: "Ждёт",
    confirmed: "Подтверждена",
    completed: "Завершена",
    no_show: "Не пришёл",
    canceled: "Отменена",
  };

  let organization = null;
  let isPro = false;
  let data = null; // { bookings, services, staff, schedules, loadedAt }
  let loadingPromise = null;
  let clients = [];
  const state = {
    segment: "all",
    query: "",
    lapsedDays: readNumber("bookly:clients-lapsed", 45),
    period: readString("bookly:analytics-period", "30"),
  };
  const els = {};

  // ---------------------------------------------------------------------------
  // Утилиты
  // ---------------------------------------------------------------------------

  function readString(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function readNumber(key, fallback) {
    const value = Number(readString(key, ""));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // приватный режим — не страшно
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(value) {
    return `${Math.round(Number(value) || 0).toLocaleString("ru-RU")} ₸`;
  }

  function shortMoney(value) {
    const n = Number(value) || 0;
    if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(".0", "")} млн`;
    if (n >= 1000) return `${Math.round(n / 1000)} тыс`;
    return String(Math.round(n));
  }

  function formatDate(dateStr, options = { day: "numeric", month: "short" }) {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("ru-RU", options);
  }

  /** «28 окт» в этом году, «28 окт 2025» — в другом. */
  function shortDate(dateStr) {
    const year = Number(String(dateStr).slice(0, 4));
    const options = year === new Date().getFullYear()
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" };
    return formatDate(dateStr, options).replace(/.?s*г.?$/, "").replace(/.$/, "");
  }

  function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function daysAgo(days) {
    if (days === null || days === undefined) return "—";
    if (days <= 0) return "сегодня";
    if (days === 1) return "вчера";
    return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  }

  function staffName(id) {
    return data?.staff.find((m) => m.id === id)?.name || "";
  }

  function toWhatsAppNumber(phone) {
    let digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
    if (digits.length === 10) digits = `7${digits}`;
    return digits.length >= 11 && digits.length <= 15 ? digits : "";
  }

  function bookingUrl() {
    return organization?.slug ? `${window.location.origin}/book/${organization.slug}` : "";
  }

  function inviteLink(client, lapsed) {
    const orgName = organization?.public_name || organization?.name || "";
    const firstName = client.name.split(/\s+/)[0];
    const url = bookingUrl();
    const text = lapsed
      ? `Здравствуйте, ${firstName}! Давно не виделись в «${orgName}» — будем рады видеть вас снова.${url ? ` Записаться на удобное время: ${url}` : ""}`
      : `Здравствуйте, ${firstName}!${url ? ` Записаться в «${orgName}» на удобное время: ${url}` : ""}`;
    const number = toWhatsAppNumber(client.phone);
    return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  }

  function renderSeg(container, items, active, attr) {
    container.innerHTML = items
      .map(
        (item) => `
          <button class="seg__item ${item.id === active ? "is-active" : ""}" type="button" role="tab"
            aria-selected="${item.id === active}" ${attr}="${item.id}">
            ${escapeHtml(item.label)}${item.count !== undefined ? ` <span class="seg__count">${item.count}</span>` : ""}
          </button>`
      )
      .join("");
  }

  // ---------------------------------------------------------------------------
  // Данные
  // ---------------------------------------------------------------------------

  async function loadData({ force = false } = {}) {
    if (data && !force) return data;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      const [bookings, services, staff, schedules] = await Promise.all([
        BooklyBookings.list(organization.id),
        BooklyServices.list(organization.id),
        BooklyStaff.list(organization.id),
        BooklySchedules.listForOrganization(organization.id),
      ]);
      data = { bookings, services, staff, schedules, loadedAt: Date.now() };
      clients = BooklyInsights.aggregateClients(bookings, {
        priceByService: new Map(services.map((s) => [s.id, Number(s.price) || 0])),
      });
      return data;
    })();

    try {
      return await loadingPromise;
    } finally {
      loadingPromise = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Клиенты
  // ---------------------------------------------------------------------------

  function renderClients() {
    const options = { lapsedDays: state.lapsedDays };
    const counts = BooklyInsights.segmentCounts(clients, options);
    renderSeg(
      els.segments,
      SEGMENTS.map((s) => ({ ...s, count: counts[s.id] })),
      state.segment,
      "data-segment"
    );
    els.lapsed.hidden = state.segment !== "lapsed";
    els.lapsed.value = String(state.lapsedDays);

    const list = BooklyInsights.filterClients(clients, { ...options, segment: state.segment, query: state.query });

    const hints = {
      all: `${counts.all} ${plural(counts.all, "клиент", "клиента", "клиентов")} — база собирается сама из всех записей.`,
      lapsed: `Были у вас, но не приходили ${state.lapsedDays}+ дней и не записаны снова. Пригласите их — готовый текст откроется в WhatsApp.`,
      regular: "3 визита и больше. Скажите им спасибо — это ядро салона.",
      new: "Впервые записались за последние 30 дней.",
      noshow: "Хотя бы раз не пришли. Предоплата или напоминания помогут снизить неявки.",
    };
    els.hint.textContent = hints[state.segment];

    if (!clients.length) {
      els.list.innerHTML = `
        <div class="today-empty">
          <p class="today-empty__title">Клиентов пока нет</p>
          <p>Как только появятся записи, клиенты попадут сюда автоматически.</p>
        </div>`;
      return;
    }

    if (!list.length) {
      els.list.innerHTML = `<p class="today-empty">Никого не нашлось.</p>`;
      return;
    }

    const lapsedMode = state.segment === "lapsed";
    els.list.innerHTML = `
      <div class="clients-head" aria-hidden="true">
        <span>Клиент</span><span>Визиты</span><span>Последний визит</span><span>Следующая запись</span><span>Сумма</span><span></span>
      </div>
      ${list
        .slice(0, 300)
        .map((c) => {
          const next = c.nextBooking
            ? `${formatDate(c.nextBooking.booking_date, { weekday: "short", day: "numeric", month: "short" })}, ${String(c.nextBooking.start_time).slice(0, 5)}`
            : "—";
          const lapsed = c.visits > 0 && !c.nextBooking && c.daysSinceVisit >= state.lapsedDays;
          return `
            <div class="client-row" data-client="${escapeHtml(c.key)}" role="button" tabindex="0">
              <span class="client-row__main">
                <span class="client-avatar">${escapeHtml(c.name.charAt(0).toUpperCase())}</span>
                <span class="client-row__name">
                  <b>${escapeHtml(c.name)}${c.telegram ? ' <em class="client-tag client-tag--tg">TG</em>' : ""}${c.noShows ? ` <em class="client-tag client-tag--warn">неявки: ${c.noShows}</em>` : ""}</b>
                  <span>${escapeHtml(c.phone)}${staffName(c.favoriteStaffId) ? ` · ${escapeHtml(staffName(c.favoriteStaffId))}` : ""}</span>
                </span>
              </span>
              <span class="client-row__cell" data-label="Визиты">${c.visits}</span>
              <span class="client-row__cell ${lapsed ? "is-warn" : ""}" data-label="Последний визит">${escapeHtml(daysAgo(c.daysSinceVisit))}</span>
              <span class="client-row__cell" data-label="Следующая">${escapeHtml(next)}</span>
              <span class="client-row__cell" data-label="Сумма">${c.spent ? money(c.spent) : "—"}</span>
              <span class="client-row__actions">
                <a class="btn btn--sm ${lapsedMode || lapsed ? "btn--primary" : "btn--outline"}" href="${inviteLink(c, lapsed)}" target="_blank" rel="noopener" data-stop>${lapsed ? "Пригласить" : "WhatsApp"}</a>
              </span>
            </div>`;
        })
        .join("")}
      ${list.length > 300 ? `<p class="insights-hint">Показаны первые 300 — уточните поиск.</p>` : ""}
    `;
  }

  function openClient(key) {
    const c = clients.find((item) => item.key === key);
    if (!c) return;

    els.modalTitle.textContent = c.name;
    els.modalSubtitle.textContent = c.phone;
    const lapsed = c.visits > 0 && !c.nextBooking && c.daysSinceVisit >= state.lapsedDays;

    els.modalBody.innerHTML = `
      <div class="client-card__stats">
        <div><span>Визитов</span><b>${c.visits}</b></div>
        <div><span>Потратил</span><b>${c.spent ? money(c.spent) : "—"}</b></div>
        <div><span>Последний визит</span><b>${escapeHtml(daysAgo(c.daysSinceVisit))}</b></div>
        <div><span>Неявки</span><b>${c.noShows}</b></div>
      </div>
      <p class="client-card__meta">
        ${c.favoriteServiceName ? `Чаще всего: <b>${escapeHtml(c.favoriteServiceName)}</b>` : ""}
        ${staffName(c.favoriteStaffId) ? ` · мастер <b>${escapeHtml(staffName(c.favoriteStaffId))}</b>` : ""}
        ${c.firstDate ? ` · с нами с ${escapeHtml(formatDate(c.firstDate, { day: "numeric", month: "long", year: "numeric" }))}` : ""}
      </p>
      <div class="client-card__actions">
        <button class="btn btn--primary" type="button" data-book-client="${escapeHtml(c.key)}">Записать</button>
        <a class="btn btn--outline" href="${inviteLink(c, lapsed)}" target="_blank" rel="noopener">${lapsed ? "Пригласить в WhatsApp" : "Написать в WhatsApp"}</a>
        ${
          window.BooklyBlacklist && !BooklyBlacklist.isBlocked(c.phone)
            ? `<button class="btn btn--ghost" type="button" data-block-client="${escapeHtml(c.key)}">В чёрный список</button>`
            : ""
        }
      </div>
      <h3 class="client-card__title">История</h3>
      <div class="client-history">
        ${c.bookings
          .map(
            (b) => `
              <div class="client-history__row">
                <span class="client-history__date">${escapeHtml(shortDate(b.booking_date))}<small>${String(b.start_time).slice(0, 5)}</small></span>
                <span class="today-row__bar status-bar--${escapeHtml(b.status)}" aria-hidden="true"></span>
                <span class="client-history__body"><b>${escapeHtml(b.services?.name || "")}</b><span>${escapeHtml(staffName(b.staff_id))}</span></span>
                <span class="client-history__status">${escapeHtml(STATUS_LABELS[b.status] || b.status)}</span>
              </div>`
          )
          .join("")}
      </div>
    `;

    els.modal.classList.add("is-open");
    els.modal.setAttribute("aria-hidden", "false");
  }

  function closeClient() {
    els.modal.classList.remove("is-open");
    els.modal.setAttribute("aria-hidden", "true");
  }

  function exportCsv() {
    const list = BooklyInsights.filterClients(clients, {
      segment: state.segment,
      query: state.query,
      lapsedDays: state.lapsedDays,
    });
    const csv = BooklyInsights.clientsToCsv(list, staffName);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `bookly-clients-${BooklyInsights.dateString(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // ---------------------------------------------------------------------------
  // Аналитика
  // ---------------------------------------------------------------------------

  function deltaBadge(value, { inverse = false } = {}) {
    if (value === null || value === undefined || value === 0) return "";
    const good = inverse ? value < 0 : value > 0;
    return `<em class="an-delta ${good ? "is-up" : "is-down"}">${value > 0 ? "+" : ""}${value}%</em>`;
  }

  function bars(items, { valueKey, labelKey, format = (v) => v, highlightMax = true }) {
    const max = Math.max(1, ...items.map((i) => i[valueKey]));
    return items
      .map((item) => {
        const value = item[valueKey];
        const height = Math.max(value ? 4 : 0, Math.round((value / max) * 100));
        return `
          <div class="an-bar ${highlightMax && value === max && value > 0 ? "is-max" : ""}" title="${escapeHtml(item.title || "")}">
            <span class="an-bar__value">${value ? escapeHtml(format(value)) : ""}</span>
            <span class="an-bar__track"><span class="an-bar__fill" style="height:${height}%"></span></span>
            <span class="an-bar__label">${escapeHtml(item[labelKey])}</span>
          </div>`;
      })
      .join("");
  }

  function renderAnalytics() {
    renderSeg(els.periods, PERIODS, state.period, "data-period");

    const a = BooklyInsights.computeAnalytics({
      bookings: data.bookings,
      schedules: data.schedules,
      staff: data.staff,
      services: data.services,
      period: state.period,
    });
    const c = a.current;

    els.kpis.innerHTML = `
      <article class="kpi-card"><p class="kpi-card__label">Выручка</p><p class="kpi-card__value">${money(c.revenue)}</p>${deltaBadge(a.deltas.revenue)}</article>
      <article class="kpi-card"><p class="kpi-card__label">Визитов</p><p class="kpi-card__value">${c.visits}</p>${deltaBadge(a.deltas.visits)}</article>
      <article class="kpi-card"><p class="kpi-card__label">Средний чек</p><p class="kpi-card__value">${money(c.avgCheck)}</p>${deltaBadge(a.deltas.avgCheck)}</article>
      <article class="kpi-card"><p class="kpi-card__label">Новых клиентов</p><p class="kpi-card__value">${c.newClients}</p>${deltaBadge(a.deltas.newClients)}</article>
      <article class="kpi-card ${c.noShowRate >= 10 ? "kpi-card--warn is-active" : ""}"><p class="kpi-card__label">Неявки</p><p class="kpi-card__value">${c.noShowRate}%</p><span class="kpi-card__sub">${c.noShows} ${plural(c.noShows, "раз", "раза", "раз")} · отмен: ${c.cancellations}</span></article>
      <article class="kpi-card"><p class="kpi-card__label">Записались онлайн</p><p class="kpi-card__value">${c.onlineShare}%</p><span class="kpi-card__sub">из ${c.bookings} ${plural(c.bookings, "записи", "записей", "записей")}</span></article>
    `;

    els.chartNote.textContent = a.bucketDays === 7 ? "по неделям" : "по дням";
    const hasRevenue = a.chart.some((p) => p.revenue > 0);
    els.chart.innerHTML = hasRevenue
      ? bars(
          a.chart.map((p) => ({
            ...p,
            label: a.bucketDays === 7 ? formatDate(p.from) : formatDate(p.from, { day: "numeric" }),
            title: `${formatDate(p.from)}${p.to !== p.from ? ` – ${formatDate(p.to)}` : ""}: ${money(p.revenue)}, визитов: ${p.visits}`,
          })),
          { valueKey: "revenue", labelKey: "label", format: shortMoney }
        )
      : `<p class="today-empty">За этот период визитов ещё не было.</p>`;
    els.chart.classList.toggle("is-dense", a.chart.length > 14);

    els.staff.innerHTML = a.byStaff.length
      ? `<div class="an-table">${a.byStaff
          .map(
            (row) => `
              <div class="an-table__row">
                <span class="an-table__name">${escapeHtml(row.name)}</span>
                <span class="an-table__num">${row.visits} ${plural(row.visits, "визит", "визита", "визитов")}</span>
                <span class="an-table__num">${money(row.revenue)}</span>
                <span class="an-load" title="Занято от рабочего времени по графику">
                  ${
                    row.load === null
                      ? `<span class="an-load__none">нет графика</span>`
                      : `<span class="an-load__track"><span class="an-load__fill" style="width:${row.load}%"></span></span><b>${row.load}%</b>`
                  }
                </span>
              </div>`
          )
          .join("")}</div>`
      : `<p class="today-empty today-empty--small">Нет данных за период.</p>`;

    const maxService = Math.max(1, ...a.topServices.map((s) => s.revenue || s.visits));
    els.services.innerHTML = a.topServices.length
      ? `<div class="an-table">${a.topServices
          .map(
            (s) => `
              <div class="an-table__row an-table__row--service">
                <span class="an-table__name">${escapeHtml(s.name)}
                  <span class="an-share"><span style="width:${Math.round(((s.revenue || s.visits) / maxService) * 100)}%"></span></span>
                </span>
                <span class="an-table__num">${s.visits}×</span>
                <span class="an-table__num">${money(s.revenue)}</span>
              </div>`
          )
          .join("")}</div>`
      : `<p class="today-empty today-empty--small">Нет данных за период.</p>`;

    els.weekdays.innerHTML = bars(
      a.weekdays.map((count, i) => ({ count, label: WEEKDAYS[i], title: `${WEEKDAYS[i]}: ${count}` })),
      { valueKey: "count", labelKey: "label" }
    );
    els.hours.innerHTML = bars(
      a.byHour.map((h) => ({ count: h.count, label: String(h.hour), title: `${h.hour}:00 — ${h.count}` })),
      { valueKey: "count", labelKey: "label" }
    );
  }

  // ---------------------------------------------------------------------------
  // Показ разделов
  // ---------------------------------------------------------------------------

  function applyPlan() {
    els.clientsApp.hidden = !isPro;
    els.clientsGate.hidden = isPro;
    els.analyticsApp.hidden = !isPro;
    els.analyticsGate.hidden = isPro;
  }

  async function show(section) {
    if (!isPro) return;
    const target = section === "clients" ? els.list : els.kpis;
    if (!data) target.innerHTML = `<p class="today-empty">Загрузка…</p>`;
    try {
      await loadData();
      if (section === "clients") renderClients();
      else renderAnalytics();
    } catch (error) {
      console.error("[Insights]", error?.message);
      target.innerHTML = `<p class="today-empty">Не удалось загрузить данные. Обновите страницу.</p>`;
    }
  }

  function currentSection() {
    if (!els.clientsSection.hidden) return "clients";
    if (!els.analyticsSection.hidden) return "analytics";
    return null;
  }

  function init(org) {
    organization = org;
    els.clientsSection = document.getElementById("clients-section");
    els.analyticsSection = document.getElementById("analytics-section");
    if (!els.clientsSection || !els.analyticsSection) return;

    els.clientsApp = document.getElementById("clients-app");
    els.clientsGate = document.getElementById("clients-gate");
    els.analyticsApp = document.getElementById("analytics-app");
    els.analyticsGate = document.getElementById("analytics-gate");
    els.segments = document.getElementById("clients-segments");
    els.search = document.getElementById("clients-search");
    els.lapsed = document.getElementById("clients-lapsed");
    els.hint = document.getElementById("clients-hint");
    els.list = document.getElementById("clients-list");
    els.periods = document.getElementById("analytics-periods");
    els.kpis = document.getElementById("analytics-kpis");
    els.chart = document.getElementById("analytics-chart");
    els.chartNote = document.getElementById("analytics-chart-note");
    els.staff = document.getElementById("analytics-staff");
    els.services = document.getElementById("analytics-services");
    els.weekdays = document.getElementById("analytics-weekdays");
    els.hours = document.getElementById("analytics-hours");
    els.modal = document.getElementById("client-modal");
    els.modalTitle = document.getElementById("client-modal-title");
    els.modalSubtitle = document.getElementById("client-modal-subtitle");
    els.modalBody = document.getElementById("client-modal-body");

    // Клиенты
    els.segments.addEventListener("click", (event) => {
      const button = event.target.closest("[data-segment]");
      if (!button) return;
      state.segment = button.dataset.segment;
      renderClients();
    });
    let searchTimer = null;
    els.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = els.search.value;
        renderClients();
      }, 150);
    });
    els.lapsed.addEventListener("change", () => {
      state.lapsedDays = Number(els.lapsed.value) || 45;
      save("bookly:clients-lapsed", state.lapsedDays);
      renderClients();
    });
    document.getElementById("clients-export")?.addEventListener("click", exportCsv);
    els.list.addEventListener("click", (event) => {
      if (event.target.closest("[data-stop]")) return;
      const row = event.target.closest("[data-client]");
      if (row) openClient(row.dataset.client);
    });
    els.list.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("[data-client]")) openClient(event.target.dataset.client);
    });

    // Карточка клиента
    els.modal.addEventListener("click", async (event) => {
      if (event.target === els.modal || event.target.closest("[data-close-client-modal]")) {
        closeClient();
        return;
      }
      const book = event.target.closest("[data-book-client]");
      if (book) {
        const c = clients.find((item) => item.key === book.dataset.bookClient);
        closeClient();
        window.BooklyBookingsUI?.openCreate({
          staffId: c?.favoriteStaffId || "",
          clientName: c?.name || "",
          clientPhone: c?.phone || "",
        });
        return;
      }
      const block = event.target.closest("[data-block-client]");
      if (block) {
        const c = clients.find((item) => item.key === block.dataset.blockClient);
        if (c && confirm(`Добавить ${c.phone} (${c.name}) в чёрный список? Онлайн-запись с этого номера станет недоступна.`)) {
          try {
            await BooklyBlacklist.add({ phone: c.phone, clientName: c.name });
            block.remove();
          } catch (error) {
            alert(error.message || "Не удалось добавить в чёрный список.");
          }
        }
      }
    });

    // Аналитика
    els.periods.addEventListener("click", (event) => {
      const button = event.target.closest("[data-period]");
      if (!button || !data) return;
      state.period = button.dataset.period;
      save("bookly:analytics-period", state.period);
      renderAnalytics();
    });

    // Открытие разделов
    document.querySelector('.sidebar__link[data-section="clients"]')?.addEventListener("click", () => show("clients"));
    document.querySelector('.sidebar__link[data-section="analytics"]')?.addEventListener("click", () => show("analytics"));

    // Записи изменились — данные перечитаем при следующем открытии (или сразу, если раздел открыт).
    document.addEventListener("bookly:bookings-changed", () => {
      data = null;
      const section = currentSection();
      if (section) show(section);
    });

    if (window.BooklySubscription?.onEntitlementsChange) {
      BooklySubscription.onEntitlementsChange((entitlements) => {
        isPro = entitlements?.is_pro === true;
        applyPlan();
        const section = currentSection();
        if (section) show(section);
      });
    }
    applyPlan();
  }

  return { init };
})();
