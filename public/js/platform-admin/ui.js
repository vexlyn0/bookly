/**
 * UI глобальной админ-панели Bookly
 */
window.BooklyPlatformAdminUI = (() => {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString("ru-RU");
    } catch {
      return "—";
    }
  }

  function formatMoney(amount, currency = "KZT") {
    const symbol = currency === "KZT" ? "₸" : currency;
    return `${Number(amount || 0).toLocaleString("ru-RU")} ${symbol}`;
  }

  function statusBadge(status) {
    const labels = {
      trialing: "Пробный",
      active: "Активна",
      expired: "Закончилась",
      suspended: "Приостановлена",
      pending: "Ожидает",
      approved: "Подтверждена",
      rejected: "Отклонена",
      canceled: "Отменена",
    };
    return escapeHtml(labels[status] || status || "—");
  }

  function renderOverview({ overview, pendingPayments, recentOrgs }) {
    const s = overview.subscriptions || {};
    return `
      <div class="platform-admin__stats">
        <article class="platform-admin__stat"><p class="platform-admin__stat-label">Организаций</p><p class="platform-admin__stat-value">${overview.organizations_total}</p></article>
        <article class="platform-admin__stat"><p class="platform-admin__stat-label">Пробный период</p><p class="platform-admin__stat-value">${s.trialing || 0}</p></article>
        <article class="platform-admin__stat"><p class="platform-admin__stat-label">Активные</p><p class="platform-admin__stat-value">${s.active || 0}</p></article>
        <article class="platform-admin__stat"><p class="platform-admin__stat-label">Истекли</p><p class="platform-admin__stat-value">${s.expired || 0}</p></article>
        <article class="platform-admin__stat"><p class="platform-admin__stat-label">Приостановлены</p><p class="platform-admin__stat-value">${s.suspended || 0}</p></article>
        <article class="platform-admin__stat"><p class="platform-admin__stat-label">Ожидают оплаты</p><p class="platform-admin__stat-value">${overview.pending_payment_requests}</p></article>
        <article class="platform-admin__stat"><p class="platform-admin__stat-label">Подтверждено</p><p class="platform-admin__stat-value">${formatMoney(overview.approved_payments_total_amount)}</p></article>
      </div>

      <section class="platform-admin__panel">
        <h2>Ожидающие платежи</h2>
        ${renderPaymentsTable(pendingPayments.items || [], { actions: true })}
      </section>

      <section class="platform-admin__panel">
        <h2>Последние организации</h2>
        ${renderOrganizationsTable(recentOrgs.items || [], { compact: true })}
      </section>
    `;
  }

  function renderOrganizationsTable(items, { compact = false } = {}) {
    if (!items.length) {
      return `<div class="platform-admin__empty">Нет организаций</div>`;
    }

    return `
      <table class="platform-admin__table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Владелец</th>
            <th>Статус</th>
            <th>Окончание</th>
            ${compact ? "" : "<th>Услуги</th><th>Сотрудники</th><th>Записи</th><th></th>"}
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (row) => `
            <tr>
              <td>${escapeHtml(row.name)}<br><small>${escapeHtml(row.slug)}</small></td>
              <td>${escapeHtml(row.owner_email || "—")}</td>
              <td>${statusBadge(row.subscription_status)}</td>
              <td>${formatDate(row.current_period_end || row.trial_ends_at)}</td>
              ${
                compact
                  ? ""
                  : `<td>${row.services_count}</td><td>${row.staff_count}</td><td>${row.bookings_count}</td>
                     <td><button class="btn btn--outline btn--sm" type="button" data-org-open="${row.id}">Открыть</button></td>`
              }
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderPaymentsTable(items, { actions = false } = {}) {
    if (!items.length) {
      return `<div class="platform-admin__empty">Нет заявок</div>`;
    }

    return `
      <table class="platform-admin__table">
        <thead>
          <tr>
            <th>Организация</th>
            <th>Владелец</th>
            <th>Сумма</th>
            <th>Отправитель</th>
            <th>Дата перевода</th>
            <th>Reference</th>
            <th>Статус</th>
            ${actions ? "<th></th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (row) => `
            <tr>
              <td>${escapeHtml(row.organization_name || "—")}</td>
              <td>${escapeHtml(row.owner_email || "—")}</td>
              <td>${formatMoney(row.amount, row.currency)}</td>
              <td>${escapeHtml(row.payer_name)}${row.payer_phone ? `<br>${escapeHtml(row.payer_phone)}` : ""}</td>
              <td>${formatDate(row.payment_date)}</td>
              <td>${escapeHtml(row.payment_reference || row.customer_note || "—")}</td>
              <td>${statusBadge(row.status)}</td>
              ${
                actions && row.status === "pending"
                  ? `<td class="platform-admin__actions">
                      <button class="btn btn--primary btn--sm" type="button" data-payment-approve="${row.id}">Подтвердить</button>
                      <button class="btn btn--outline btn--sm" type="button" data-payment-reject="${row.id}">Отклонить</button>
                    </td>`
                  : actions
                    ? "<td></td>"
                    : ""
              }
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderOrganizationsView() {
    return `
      <div class="platform-admin__toolbar">
        <input class="field__input" type="search" id="org-search" placeholder="Поиск по названию или slug">
        <select class="field__select" id="org-status-filter">
          <option value="">Все статусы</option>
          <option value="trialing">Пробный</option>
          <option value="active">Активна</option>
          <option value="expired">Закончилась</option>
          <option value="suspended">Приостановлена</option>
        </select>
        <button class="btn btn--outline" type="button" id="org-refresh">Обновить</button>
      </div>
      <div id="organizations-table-wrap"></div>
    `;
  }

  function renderPaymentsView() {
    return `
      <div class="platform-admin__toolbar">
        <select class="field__select" id="payments-status-filter">
          <option value="">Все</option>
          <option value="pending">Ожидают</option>
          <option value="approved">Подтверждены</option>
          <option value="rejected">Отклонены</option>
        </select>
        <button class="btn btn--outline" type="button" id="payments-refresh">Обновить</button>
      </div>
      <div id="payments-table-wrap"></div>
    `;
  }

  function renderOrganizationDetail(detail) {
    const org = detail.organization;
    const sub = detail.subscription || {};
    return `
      <section class="platform-admin__panel">
        <h2>${escapeHtml(org.name)}</h2>
        <p>Владелец: ${escapeHtml(detail.owner?.email || "—")}</p>
        <p>Статус: ${statusBadge(sub.status)}</p>
        <p>Пробный до: ${formatDate(sub.trial_ends_at)}</p>
        <p>Оплаченный период до: ${formatDate(sub.current_period_end)}</p>
        <div class="platform-admin__actions">
          <button class="btn btn--outline btn--sm" type="button" data-org-extend="${org.id}">Продлить</button>
          <button class="btn btn--outline btn--sm" type="button" data-org-suspend="${org.id}">Suspend</button>
          <button class="btn btn--outline btn--sm" type="button" data-org-unsuspend="${org.id}">Unsuspend</button>
        </div>
      </section>
      <section class="platform-admin__panel">
        <h3>Заявки на оплату</h3>
        ${renderPaymentsTable(detail.payment_requests || [])}
      </section>
      <section class="platform-admin__panel">
        <h3>Журнал действий</h3>
        ${
          (detail.audit_log || []).length
            ? `<ul>${detail.audit_log.map((row) => `<li>${escapeHtml(row.action)} — ${formatDate(row.created_at)}</li>`).join("")}</ul>`
            : `<div class="platform-admin__empty">Пока пусто</div>`
        }
      </section>
    `;
  }

  function confirmModal({ title, body, confirmLabel = "Подтвердить", requireInput = false, inputLabel = "" }) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "platform-admin__modal-backdrop";
      backdrop.innerHTML = `
        <div class="platform-admin__modal" role="dialog" aria-modal="true">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(body)}</p>
          ${requireInput ? `<label class="field"><span class="field__label">${escapeHtml(inputLabel)}</span><textarea class="field__input" id="confirm-modal-input" rows="3" required></textarea></label>` : ""}
          <div class="platform-admin__modal-actions">
            <button class="btn btn--primary" type="button" id="confirm-modal-ok">${escapeHtml(confirmLabel)}</button>
            <button class="btn btn--ghost" type="button" id="confirm-modal-cancel">Отмена</button>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);

      const cleanup = (value) => {
        backdrop.remove();
        resolve(value);
      };

      backdrop.querySelector("#confirm-modal-cancel")?.addEventListener("click", () => cleanup(null));
      backdrop.querySelector("#confirm-modal-ok")?.addEventListener("click", () => {
        if (requireInput) {
          const input = backdrop.querySelector("#confirm-modal-input");
          const text = String(input?.value || "").trim();
          if (!text) return;
          cleanup(text);
          return;
        }
        cleanup(true);
      });
    });
  }

  return {
    escapeHtml,
    formatDate,
    formatMoney,
    statusBadge,
    renderOverview,
    renderOrganizationsTable,
    renderPaymentsTable,
    renderOrganizationsView,
    renderPaymentsView,
    renderOrganizationDetail,
    confirmModal,
  };
})();
