/**
 * UI глобальной админ-панели Bookly — только разметка, без запросов.
 */
window.BooklyPlatformAdminUI = (() => {
  const PLAN_LABELS = { free: "Free", pro: "Pro", trial: "Пробный", suspended: "Приостановлен" };
  const SEGMENTS = [
    { id: "all", label: "Все" },
    { id: "live", label: "Живые" },
    { id: "pro", label: "Pro" },
    { id: "trial", label: "Пробный" },
    { id: "free", label: "Free" },
    { id: "sleeping", label: "Спящие" },
    { id: "stuck", label: "Застряли" },
    { id: "suspended", label: "Приостановлены" },
  ];
  const SETUP_STEPS = [
    { key: "services", label: "Услуги" },
    { key: "staff", label: "Мастера" },
    { key: "public_booking", label: "Онлайн-запись" },
    { key: "telegram", label: "Telegram мастеру" },
  ];
  const PAYMENT_STATUS = { pending: "Ожидает", approved: "Подтверждена", rejected: "Отклонена", canceled: "Отменена" };
  const BOOKING_STATUS = {
    pending: "Ждёт",
    confirmed: "Подтверждена",
    completed: "Завершена",
    no_show: "Не пришёл",
    canceled: "Отменена",
  };
  const AUDIT_LABELS = {
    PAYMENT_APPROVED: "Подтвердил оплату",
    PAYMENT_REJECTED: "Отклонил оплату",
    SUBSCRIPTION_EXTENDED: "Выдал / продлил Pro",
    ORGANIZATION_SUSPENDED: "Приостановил салон",
    ORGANIZATION_UNSUSPENDED: "Вернул салон",
  };

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

  function money(amount) {
    return `${Math.round(Number(amount) || 0).toLocaleString("ru-RU")} ₸`;
  }

  function date(value, withTime = false) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("ru-RU", withTime
      ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", year: "numeric" });
  }

  function plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function ago(value) {
    if (!value) return "—";
    const diff = Date.now() - new Date(value).getTime();
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return "только что";
    if (minutes < 60) return `${minutes} мин назад`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} ч назад`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
    return date(value);
  }

  function until(value) {
    if (!value) return "";
    const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
    if (days <= 0) return "заканчивается сегодня";
    return `ещё ${days} ${plural(days, "день", "дня", "дней")}`;
  }

  function businessType(type) {
    return window.BooklyOrgConstants?.getBusinessTypeLabel?.(type) || type || "—";
  }

  function planBadge(plan, planUntil) {
    const label = PLAN_LABELS[plan] || plan || "—";
    return `<span class="pa-badge pa-badge--${escapeHtml(plan)}">${escapeHtml(label)}</span>${
      planUntil && (plan === "pro" || plan === "trial") ? `<small class="pa-muted"> ${escapeHtml(until(planUntil))}</small>` : ""
    }`;
  }

  function deltaBadge(value) {
    if (value === null || value === undefined || value === 0) return "";
    return `<em class="pa-delta ${value > 0 ? "is-up" : "is-down"}">${value > 0 ? "+" : ""}${value}%</em>`;
  }

  function setupDots(setup) {
    return `<span class="pa-setup" title="${SETUP_STEPS.map((s) => `${setup?.[s.key] ? "✓" : "✗"} ${s.label}`).join("\n")}">${SETUP_STEPS.map(
      (s) => `<i class="${setup?.[s.key] ? "is-done" : ""}"></i>`
    ).join("")}</span>`;
  }

  function empty(text) {
    return `<p class="pa-empty">${escapeHtml(text)}</p>`;
  }

  function bars(values, labels) {
    const max = Math.max(1, ...values);
    return `<div class="pa-bars">${values
      .map(
        (v, i) => `
          <div class="pa-bar ${v === max && v > 0 ? "is-max" : ""}" title="${escapeHtml(labels[i])}: ${v}">
            <span class="pa-bar__track"><span class="pa-bar__fill" style="height:${v ? Math.max(4, Math.round((v / max) * 100)) : 0}%"></span></span>
          </div>`
      )
      .join("")}</div>
      <div class="pa-bars__axis"><span>${escapeHtml(labels[0])}</span><span>${escapeHtml(labels[labels.length - 1])}</span></div>`;
  }

  // ---------------------------------------------------------------------------
  // Главная
  // ---------------------------------------------------------------------------

  function renderOverview(o) {
    const orgs = o.organizations;
    const newDelta = orgs.new_prev_7d ? Math.round(((orgs.new_7d - orgs.new_prev_7d) / orgs.new_prev_7d) * 100) : null;
    const labels = o.charts.days.map((d) => new Date(`${d}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }));
    const sum = (arr) => arr.reduce((a, b) => a + b, 0);
    const a = o.attention;

    const attentionCount = a.pending_payments.length + a.trials_ending.length + a.stuck.length;

    return `
      <div class="pa-kpis">
        <article class="pa-kpi"><p>Салонов</p><b>${orgs.total}</b><span>+${orgs.new_7d} за неделю ${deltaBadge(newDelta)}</span></article>
        <article class="pa-kpi"><p>Живые</p><b>${orgs.live}</b><span>были записи за 7 дней</span></article>
        <article class="pa-kpi"><p>Pro</p><b>${o.plans.pro}</b><span>${o.plans.trial} на пробном · ${o.plans.free} Free</span></article>
        <article class="pa-kpi"><p>Оплачено за 30 дней</p><b>${money(o.payments.approved_30d_amount)}</b><span>${o.payments.approved_30d_count} ${plural(o.payments.approved_30d_count, "оплата", "оплаты", "оплат")}</span></article>
        <article class="pa-kpi"><p>Записей за 7 дней</p><b>${o.bookings.last_7d}</b><span>${o.bookings.online_share_7d}% онлайн ${deltaBadge(o.bookings.delta)}</span></article>
        <article class="pa-kpi ${orgs.sleeping ? "pa-kpi--warn" : ""}" data-goto-segment="sleeping"><p>Спящие</p><b>${orgs.sleeping}</b><span>ни одной записи</span></article>
      </div>

      <div class="pa-grid">
        <section class="pa-card">
          <header class="pa-card__head"><h3>Регистрации</h3><span class="pa-muted">${sum(o.charts.signups)} за 30 дней</span></header>
          ${bars(o.charts.signups, labels)}
        </section>
        <section class="pa-card">
          <header class="pa-card__head"><h3>Записи на платформе</h3><span class="pa-muted">${sum(o.charts.bookings)} за 30 дней</span></header>
          ${bars(o.charts.bookings, labels)}
        </section>
      </div>

      <section class="pa-card">
        <header class="pa-card__head"><h3>Требует внимания</h3><span class="pa-muted">${attentionCount ? "" : "всё спокойно"}</span></header>
        <div class="pa-attention">
          <div>
            <p class="pa-attention__title">Заявки на оплату <span>${o.payments.pending}</span></p>
            ${
              a.pending_payments.length
                ? a.pending_payments
                    .map(
                      (p) => `
                        <button class="pa-attention__row" type="button" data-goto-view="payments">
                          <b>${escapeHtml(p.organization_name)}</b>
                          <span>${money(p.amount)} · ${p.billing_months} мес. · ${escapeHtml(ago(p.created_at))}</span>
                        </button>`
                    )
                    .join("")
                : empty("Новых заявок нет")
            }
          </div>
          <div>
            <p class="pa-attention__title">Пробный заканчивается <span>${a.trials_ending.length}</span></p>
            ${
              a.trials_ending.length
                ? a.trials_ending
                    .map(
                      (org) => `
                        <button class="pa-attention__row" type="button" data-org-open="${org.id}">
                          <b>${escapeHtml(org.name)}</b>
                          <span>${escapeHtml(until(org.plan_until))} · ${escapeHtml(org.owner_email || "")}</span>
                        </button>`
                    )
                    .join("")
                : empty("В ближайшие 3 дня — никого")
            }
          </div>
          <div>
            <p class="pa-attention__title">Застряли на настройке <span>${o.organizations.stuck}</span></p>
            ${
              a.stuck.length
                ? a.stuck
                    .map(
                      (org) => `
                        <button class="pa-attention__row" type="button" data-org-open="${org.id}">
                          <b>${escapeHtml(org.name)} ${setupDots(org.setup)}</b>
                          <span>с ${escapeHtml(date(org.created_at))} · ${escapeHtml(org.owner_email || "")}</span>
                        </button>`
                    )
                    .join("")
                : empty("Все прошли настройку")
            }
          </div>
        </div>
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // Салоны
  // ---------------------------------------------------------------------------

  function renderOrganizationsView({ counts = {}, segment = "all", search = "" } = {}) {
    return `
      <div class="pa-toolbar">
        <div class="pa-seg" id="pa-segments">
          ${SEGMENTS.map(
            (s) => `<button type="button" class="pa-seg__item ${s.id === segment ? "is-active" : ""}" data-segment="${s.id}">
              ${s.label} <span>${counts[s.id] ?? 0}</span></button>`
          ).join("")}
        </div>
        <input class="field__input pa-search" type="search" id="pa-org-search" placeholder="Название, адрес страницы, почта" value="${escapeHtml(search)}">
      </div>
      <div id="pa-org-table"></div>
    `;
  }

  function renderOrganizationsTable(items) {
    if (!items.length) return `<section class="pa-card">${empty("Салонов не найдено")}</section>`;
    return `
      <section class="pa-card pa-card--flush">
        <div class="pa-table pa-table--orgs">
          <div class="pa-table__head"><span>Салон</span><span>Тариф</span><span>Мастера</span><span>Записи 30 дн.</span><span>Последняя запись</span><span>Настройка</span><span>Создан</span></div>
          ${items
            .map(
              (o) => `
                <button class="pa-table__row" type="button" data-org-open="${o.id}">
                  <span class="pa-org">
                    <b>${escapeHtml(o.name)}${o.is_live ? ' <i class="pa-live" title="Есть записи за 7 дней"></i>' : ""}</b>
                    <small>/${escapeHtml(o.slug || "")} · ${escapeHtml(o.owner_email || "без владельца")}</small>
                  </span>
                  <span data-label="Тариф">${planBadge(o.plan, o.plan_until)}</span>
                  <span data-label="Мастера">${o.staff_active}${o.staff_total > o.staff_active ? `<small class="pa-muted">/${o.staff_total}</small>` : ""}${o.telegram_staff ? ` <small class="pa-tg">TG ${o.telegram_staff}</small>` : ""}</span>
                  <span data-label="Записи 30 дн.">${o.bookings_30d}${o.bookings_30d ? `<small class="pa-muted"> · ${Math.round((o.online_30d / o.bookings_30d) * 100)}% онлайн</small>` : ""}</span>
                  <span data-label="Последняя">${escapeHtml(ago(o.last_booking_at))}</span>
                  <span data-label="Настройка">${setupDots(o.setup)}</span>
                  <span data-label="Создан">${escapeHtml(date(o.created_at))}</span>
                </button>`
            )
            .join("")}
        </div>
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // Карточка салона
  // ---------------------------------------------------------------------------

  function toWhatsApp(phone) {
    let digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
    if (digits.length === 10) digits = `7${digits}`;
    return digits.length >= 11 && digits.length <= 15 ? digits : "";
  }

  function renderOrganizationDetail(detail) {
    const org = detail.organization || {};
    const s = detail.stats || {};
    const sub = detail.subscription || {};
    const ownerEmail = detail.owner?.email;
    const wa = toWhatsApp(org.phone);
    const suspended = s.plan === "suspended";

    return `
      <button class="pa-back" type="button" data-goto-view="organizations">← Все салоны</button>

      <section class="pa-hero">
        <div>
          <h2>${escapeHtml(org.public_name || org.name)} ${planBadge(s.plan, s.plan_until)}</h2>
          <p class="pa-muted">${escapeHtml(businessType(s.business_type))} · /${escapeHtml(org.slug || "")} · с ${escapeHtml(date(org.created_at))}</p>
        </div>
        <div class="pa-hero__actions">
          ${org.slug ? `<a class="btn btn--outline btn--sm" href="/book/${encodeURIComponent(org.slug)}" target="_blank" rel="noopener">Страница записи ↗</a>` : ""}
          ${wa ? `<a class="btn btn--outline btn--sm" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          ${ownerEmail ? `<a class="btn btn--outline btn--sm" href="mailto:${escapeHtml(ownerEmail)}">Письмо владельцу</a>` : ""}
          <button class="btn btn--primary btn--sm" type="button" data-org-extend="${org.id}">Выдать Pro</button>
          ${
            suspended
              ? `<button class="btn btn--outline btn--sm" type="button" data-org-unsuspend="${org.id}">Вернуть салон</button>`
              : `<button class="btn btn--ghost btn--sm pa-danger" type="button" data-org-suspend="${org.id}">Приостановить</button>`
          }
        </div>
      </section>

      <div class="pa-kpis pa-kpis--small">
        <article class="pa-kpi"><p>Записей всего</p><b>${s.bookings_total ?? 0}</b><span>${s.bookings_30d ?? 0} за 30 дней</span></article>
        <article class="pa-kpi"><p>Онлайн за 30 дней</p><b>${s.bookings_30d ? Math.round((s.online_30d / s.bookings_30d) * 100) : 0}%</b><span>${s.online_30d ?? 0} записей</span></article>
        <article class="pa-kpi"><p>Мастера</p><b>${s.staff_active ?? 0}</b><span>${s.telegram_staff ?? 0} с Telegram</span></article>
        <article class="pa-kpi"><p>Услуг</p><b>${s.services_active ?? 0}</b><span>активных</span></article>
        <article class="pa-kpi"><p>Последняя запись</p><b class="pa-kpi__text">${escapeHtml(ago(s.last_booking_at))}</b><span>&nbsp;</span></article>
      </div>

      <div class="pa-grid">
        <section class="pa-card">
          <header class="pa-card__head"><h3>Владелец и контакты</h3></header>
          <dl class="pa-dl">
            <dt>Почта</dt><dd>${escapeHtml(ownerEmail || "—")}</dd>
            <dt>Последний вход</dt><dd>${escapeHtml(ago(s.owner_last_sign_in_at))}</dd>
            <dt>Телефон салона</dt><dd>${escapeHtml(org.phone || "—")}</dd>
            <dt>Адрес</dt><dd>${escapeHtml(org.address || "—")}</dd>
            <dt>Юр. название</dt><dd>${escapeHtml(org.name || "—")}</dd>
          </dl>
        </section>

        <section class="pa-card">
          <header class="pa-card__head"><h3>Настройка</h3><span class="pa-muted">${s.setup_done ?? 0} из 4</span></header>
          <ul class="pa-checklist">
            ${SETUP_STEPS.map(
              (step) => `<li class="${s.setup?.[step.key] ? "is-done" : ""}"><i>${s.setup?.[step.key] ? "✓" : ""}</i>${step.label}</li>`
            ).join("")}
          </ul>
          ${s.setup_done < 4 ? `<p class="pa-muted pa-hint">Можно написать владельцу и помочь с недостающими шагами.</p>` : ""}
        </section>
      </div>

      <div class="pa-grid">
        <section class="pa-card">
          <header class="pa-card__head"><h3>Подписка</h3></header>
          <dl class="pa-dl">
            <dt>Тариф</dt><dd>${planBadge(s.plan, s.plan_until)}</dd>
            <dt>Статус в базе</dt><dd>${escapeHtml(sub.status || "—")}</dd>
            <dt>Оплачен до</dt><dd>${escapeHtml(date(sub.current_period_end))}</dd>
            <dt>Пробный до</dt><dd>${escapeHtml(date(sub.trial_ends_at))}</dd>
            ${sub.suspension_reason ? `<dt>Причина приостановки</dt><dd>${escapeHtml(sub.suspension_reason)}</dd>` : ""}
          </dl>
        </section>

        <section class="pa-card">
          <header class="pa-card__head"><h3>Последние записи</h3></header>
          ${
            (detail.recent_bookings || []).length
              ? `<div class="pa-list">${detail.recent_bookings
                  .map(
                    (b) => `
                      <div class="pa-list__row">
                        <span><b>${escapeHtml(b.client_name)}</b><small>${escapeHtml(b.services?.name || "")} · ${escapeHtml(b.staff?.name || "")}</small></span>
                        <span class="pa-list__meta">${escapeHtml(date(b.booking_date))} ${String(b.start_time || "").slice(0, 5)}<small>${escapeHtml(BOOKING_STATUS[b.status] || b.status)}${b.source === "public_booking" ? " · онлайн" : ""}</small></span>
                      </div>`
                  )
                  .join("")}</div>`
              : empty("Записей пока нет")
          }
        </section>
      </div>

      <div class="pa-grid">
        <section class="pa-card">
          <header class="pa-card__head"><h3>Оплаты</h3></header>
          ${
            (detail.payment_requests || []).length
              ? `<div class="pa-list">${detail.payment_requests
                  .map(
                    (p) => `
                      <div class="pa-list__row">
                        <span><b>${money(p.amount)}</b><small>${p.billing_months} мес. · ${escapeHtml(p.payer_name || "")}</small></span>
                        <span class="pa-list__meta">${escapeHtml(date(p.created_at))}<small>${escapeHtml(PAYMENT_STATUS[p.status] || p.status)}</small></span>
                      </div>`
                  )
                  .join("")}</div>`
              : empty("Оплат не было")
          }
        </section>

        <section class="pa-card">
          <header class="pa-card__head"><h3>Действия админов</h3></header>
          ${renderAuditList(detail.audit_log || [], { compact: true })}
        </section>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Платежи и журнал
  // ---------------------------------------------------------------------------

  function renderPaymentsView(status = "pending") {
    const options = [
      ["pending", "Ожидают"],
      ["approved", "Подтверждены"],
      ["rejected", "Отклонены"],
      ["", "Все"],
    ];
    return `
      <div class="pa-toolbar">
        <div class="pa-seg" id="pa-pay-status">
          ${options.map(([v, l]) => `<button type="button" class="pa-seg__item ${v === status ? "is-active" : ""}" data-pay-status="${v}">${l}</button>`).join("")}
        </div>
      </div>
      <div id="pa-pay-table"></div>
    `;
  }

  function renderPaymentsTable(items) {
    if (!items.length) return `<section class="pa-card">${empty("Заявок нет")}</section>`;
    return `
      <section class="pa-card pa-card--flush">
        <div class="pa-table pa-table--pay">
          <div class="pa-table__head"><span>Салон</span><span>Сумма</span><span>Плательщик</span><span>Создана</span><span>Статус</span><span></span></div>
          ${items
            .map(
              (p) => `
                <div class="pa-table__row pa-table__row--static">
                  <span class="pa-org"><b><button class="pa-link" type="button" data-org-open="${p.organization_id}">${escapeHtml(p.organization_name || "—")}</button></b><small>${escapeHtml(p.owner_email || "")}</small></span>
                  <span data-label="Сумма"><b>${money(p.amount)}</b><small class="pa-muted"> · ${p.billing_months} мес.</small></span>
                  <span data-label="Плательщик">${escapeHtml(p.payer_name || "—")}<small class="pa-muted">${p.payer_phone ? ` · ${escapeHtml(p.payer_phone)}` : ""}${p.payment_reference ? ` · №${escapeHtml(p.payment_reference)}` : ""}</small></span>
                  <span data-label="Создана">${escapeHtml(date(p.created_at, true))}</span>
                  <span data-label="Статус"><span class="pa-badge pa-badge--pay-${escapeHtml(p.status)}">${escapeHtml(PAYMENT_STATUS[p.status] || p.status)}</span>${p.admin_note ? `<small class="pa-muted"> ${escapeHtml(p.admin_note)}</small>` : ""}</span>
                  <span class="pa-row-actions">
                    ${
                      p.status === "pending"
                        ? `<button class="btn btn--primary btn--sm" type="button" data-payment-approve="${p.id}">Подтвердить</button>
                           <button class="btn btn--ghost btn--sm" type="button" data-payment-reject="${p.id}">Отклонить</button>`
                        : ""
                    }
                  </span>
                </div>`
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function auditText(item) {
    const meta = item.metadata || {};
    const extra = [];
    if (meta.days) extra.push(`${meta.days} дн.`);
    if (meta.amount) extra.push(money(meta.amount));
    if (meta.reason) extra.push(`«${meta.reason}»`);
    if (meta.admin_note) extra.push(`«${meta.admin_note}»`);
    return `${AUDIT_LABELS[item.action] || item.action}${extra.length ? ` · ${extra.join(" · ")}` : ""}`;
  }

  function renderAuditList(items, { compact = false } = {}) {
    if (!items.length) return empty("Действий пока не было");
    return `<div class="pa-list">${items
      .map(
        (item) => `
          <div class="pa-list__row">
            <span><b>${escapeHtml(auditText(item))}</b>${
              compact
                ? ""
                : `<small>${item.organization_id ? `<button class="pa-link" type="button" data-org-open="${item.organization_id}">${escapeHtml(item.organization_name || "салон")}</button>` : ""}${item.admin_email ? ` · ${escapeHtml(item.admin_email)}` : ""}</small>`
            }</span>
            <span class="pa-list__meta">${escapeHtml(date(item.created_at, true))}</span>
          </div>`
      )
      .join("")}</div>`;
  }

  function renderAuditView(items) {
    return `<section class="pa-card">${renderAuditList(items)}</section>`;
  }

  return {
    escapeHtml,
    money,
    renderOverview,
    renderOrganizationsView,
    renderOrganizationsTable,
    renderOrganizationDetail,
    renderPaymentsView,
    renderPaymentsTable,
    renderAuditView,
  };
})();
