/**
 * Bookly — раздел «Тариф и оплата» + баннер ограничения доступа
 */
window.BooklySubscriptionUI = (() => {
  let organization = null;
  let access = null;
  const els = {};

  function cacheElements() {
    els.section = document.getElementById("subscription-section");
    els.planName = document.getElementById("subscription-plan-name");
    els.planPrice = document.getElementById("subscription-plan-price");
    els.statusBadge = document.getElementById("subscription-status-badge");
    els.explain = document.getElementById("subscription-explain");
    els.trialRow = document.getElementById("subscription-trial-row");
    els.trialValue = document.getElementById("subscription-trial-value");
    els.periodRow = document.getElementById("subscription-period-row");
    els.periodValue = document.getElementById("subscription-period-value");
    els.graceRow = document.getElementById("subscription-grace-row");
    els.graceValue = document.getElementById("subscription-grace-value");
    els.cancelNote = document.getElementById("subscription-cancel-note");
    els.upgradeBtn = document.getElementById("subscription-upgrade-btn");
    els.upgradeMessage = document.getElementById("subscription-upgrade-message");
    els.banner = document.getElementById("subscription-banner");
    els.bannerText = document.getElementById("subscription-banner-text");
    els.bannerLink = document.getElementById("subscription-banner-link");
  }

  async function init(org) {
    organization = org;
    cacheElements();

    els.upgradeBtn?.addEventListener("click", handleUpgradeClick);
    els.bannerLink?.addEventListener("click", () => {
      document.querySelector('.sidebar__link[data-section="subscription"]')?.click();
    });

    await refresh();
  }

  async function refresh() {
    if (!organization) return null;

    try {
      access = await BooklySubscription.getAccess(organization.id);
    } catch (error) {
      BooklyAuthErrors.logError("subscription:load", error);
      access = null;
    }

    renderPanel();
    renderBanner();
    return access;
  }

  function renderPanel() {
    if (!els.section) return;

    if (els.planName) els.planName.textContent = "Bookly Pro";
    if (els.planPrice) els.planPrice.textContent = `${BooklySubscription.formatPrice(6990, "KZT")} / месяц`;

    if (!access) {
      if (els.explain) els.explain.textContent = "Не удалось загрузить данные подписки.";
      return;
    }

    if (els.statusBadge) {
      els.statusBadge.textContent = BooklySubscription.statusLabel(access.status);
      els.statusBadge.className = `badge ${access.allowed ? "badge--success" : "badge--danger"}`;
    }

    if (els.explain) els.explain.textContent = BooklySubscription.explain(access);

    toggleRow(els.trialRow, els.trialValue, access.status === "trialing", access.trial_ends_at);
    toggleRow(
      els.periodRow,
      els.periodValue,
      access.status === "active" || access.status === "canceled",
      access.current_period_end
    );
    toggleRow(els.graceRow, els.graceValue, access.status === "past_due", access.grace_period_ends_at);

    if (els.cancelNote) {
      els.cancelNote.hidden = access.status !== "canceled";
    }
  }

  function toggleRow(rowEl, valueEl, visible, value) {
    if (!rowEl) return;
    rowEl.hidden = !visible;
    if (visible && valueEl) {
      valueEl.textContent = BooklySubscription.formatDate(value);
    }
  }

  function renderBanner() {
    document.querySelectorAll(".subscription-banner").forEach((el) => {
      el.hidden = true;
    });

    if (!els.banner) return;

    if (!access || access.allowed) {
      els.banner.hidden = true;
      return;
    }

    els.banner.hidden = false;
    els.banner.classList.toggle("subscription-banner--suspended", access.reason === "ORGANIZATION_SUSPENDED");

    if (els.bannerText) {
      els.bannerText.textContent =
        access.reason === "ORGANIZATION_SUSPENDED"
          ? "Организация приостановлена. Обратитесь в поддержку."
          : "Подписка закончилась. Продлите доступ, чтобы продолжить работу.";
    }
  }

  function handleUpgradeClick() {
    if (!els.upgradeMessage) return;
    els.upgradeMessage.hidden = false;
    els.upgradeMessage.textContent = "Подключение автоматической оплаты появится на следующем этапе.";
  }

  function isBlocked() {
    return Boolean(access && access.allowed !== true);
  }

  return { init, refresh, isBlocked };
})();
