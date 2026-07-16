/**
 * Bookly — раздел «Тариф и оплата» + Kaspi + баннер ограничения доступа
 */
window.BooklySubscriptionUI = (() => {
  let organization = null;
  let access = null;
  let billingInfo = null;
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
    els.banner = document.getElementById("subscription-banner");
    els.bannerText = document.getElementById("subscription-banner-text");
    els.bannerLink = document.getElementById("subscription-banner-link");

    els.kaspiBlock = document.getElementById("kaspi-payment-block");
    els.kaspiRecipient = document.getElementById("kaspi-recipient");
    els.kaspiPhone = document.getElementById("kaspi-phone");
    els.kaspiAmount = document.getElementById("kaspi-amount");
    els.kaspiInstructions = document.getElementById("kaspi-instructions");
    els.kaspiCopyPhone = document.getElementById("kaspi-copy-phone");
    els.kaspiPaidBtn = document.getElementById("kaspi-paid-btn");
    els.kaspiForm = document.getElementById("kaspi-payment-form");
    els.kaspiFormWrap = document.getElementById("kaspi-form-wrap");
    els.kaspiCancelForm = document.getElementById("kaspi-cancel-form");
    els.kaspiSubmit = document.getElementById("kaspi-submit-form");
    els.kaspiMessage = document.getElementById("kaspi-message");
    els.kaspiRequestStatus = document.getElementById("kaspi-request-status");
    els.kaspiCancelRequest = document.getElementById("kaspi-cancel-request");
    els.billingMonths = document.getElementById("billing-months");
  }

  async function init(org) {
    organization = org;
    cacheElements();

    els.bannerLink?.addEventListener("click", () => {
      document.querySelector('.sidebar__link[data-section="subscription"]')?.click();
    });

    els.kaspiCopyPhone?.addEventListener("click", copyPhone);
    els.kaspiPaidBtn?.addEventListener("click", () => toggleForm(true));
    els.kaspiCancelForm?.addEventListener("click", () => toggleForm(false));
    els.kaspiForm?.addEventListener("submit", handleSubmitPayment);
    els.kaspiCancelRequest?.addEventListener("click", handleCancelRequest);
    els.billingMonths?.addEventListener("change", updateKaspiAmount);

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

    try {
      billingInfo = await BooklyBilling.getPaymentInfo();
      access = billingInfo.subscription || access;
    } catch (error) {
      BooklyAuthErrors.logError("billing:load", error);
      billingInfo = null;
    }

    renderPanel();
    renderKaspi();
    renderBanner();
    return access;
  }

  function renderPanel() {
    if (!els.section) return;

    const plan = billingInfo?.plan;
    if (els.planName) els.planName.textContent = plan?.name || "Bookly Pro";
    if (els.planPrice) {
      const amount = plan?.price_amount ?? 6990;
      const currency = plan?.currency || "KZT";
      els.planPrice.textContent = `${BooklySubscription.formatPrice(amount, currency)} / месяц`;
    }

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

  function renderKaspi() {
    if (!els.kaspiBlock) return;

    const kaspi = billingInfo?.kaspi;
    const latest = billingInfo?.latest_request;
    const hasPending = latest?.status === "pending";

    if (kaspi) {
      if (els.kaspiRecipient) els.kaspiRecipient.textContent = kaspi.recipient || "—";
      if (els.kaspiPhone) els.kaspiPhone.textContent = kaspi.phone || "—";
      if (els.kaspiInstructions) els.kaspiInstructions.textContent = kaspi.instructions || "";
      updateKaspiAmount();
    }

    if (els.kaspiPaidBtn) {
      els.kaspiPaidBtn.hidden = hasPending;
      els.kaspiPaidBtn.disabled = hasPending;
    }

    if (els.kaspiFormWrap) {
      els.kaspiFormWrap.hidden = true;
    }

    if (els.kaspiRequestStatus) {
      if (!latest) {
        els.kaspiRequestStatus.hidden = true;
      } else {
        els.kaspiRequestStatus.hidden = false;
        els.kaspiRequestStatus.className = `kaspi-request-status kaspi-request-status--${latest.status}`;
        els.kaspiRequestStatus.innerHTML = renderRequestStatus(latest);
      }
    }

    if (els.kaspiCancelRequest) {
      els.kaspiCancelRequest.hidden = !hasPending;
    }

    if (els.kaspiMessage) {
      els.kaspiMessage.hidden = true;
      els.kaspiMessage.textContent = "";
    }
  }

  function renderRequestStatus(request) {
    const sentAt = BooklySubscription.formatDate(request.created_at);
    if (request.status === "pending") {
      return `<strong>Ожидает проверки</strong><br>Отправлено: ${sentAt}`;
    }
    if (request.status === "approved") {
      const until = BooklySubscription.formatDate(request.approved_period_end);
      return `<strong>Оплата подтверждена</strong><br>Доступ до: ${until}`;
    }
    if (request.status === "rejected") {
      const reason = request.admin_note
        ? `<br>Причина: ${escapeHtml(request.admin_note)}`
        : "";
      return `<strong>Заявка отклонена</strong>${reason}<br>Можно отправить новую заявку.`;
    }
    return "";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateKaspiAmount() {
    if (!billingInfo?.kaspi || !els.kaspiAmount) return;
    const months = Number(els.billingMonths?.value) || 1;
    const unit = billingInfo.plan?.price_amount ?? billingInfo.kaspi.amount;
    const total = unit * months;
    els.kaspiAmount.textContent = BooklySubscription.formatPrice(total, billingInfo.kaspi.currency);
  }

  function toggleForm(show) {
    if (els.kaspiFormWrap) els.kaspiFormWrap.hidden = !show;
    if (show && els.kaspiForm) els.kaspiForm.reset();
    if (show && els.billingMonths) els.billingMonths.value = "1";
    updateKaspiAmount();
  }

  async function copyPhone() {
    const phone = billingInfo?.kaspi?.phone;
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      if (els.kaspiMessage) {
        els.kaspiMessage.hidden = false;
        els.kaspiMessage.textContent = "Номер скопирован.";
      }
    } catch {
      if (els.kaspiMessage) {
        els.kaspiMessage.hidden = false;
        els.kaspiMessage.textContent = "Не удалось скопировать номер.";
      }
    }
  }

  async function handleSubmitPayment(event) {
    event.preventDefault();
    if (!els.kaspiForm) return;

    const formData = new FormData(els.kaspiForm);
    const paymentDateRaw = String(formData.get("payment_date") || "").trim();
    let paymentDate = null;
    if (paymentDateRaw) {
      paymentDate = new Date(paymentDateRaw).toISOString();
    }

    try {
      await BooklyBilling.createPaymentRequest({
        payer_name: String(formData.get("payer_name") || "").trim(),
        payer_phone: String(formData.get("payer_phone") || "").trim() || null,
        payment_reference: String(formData.get("payment_reference") || "").trim() || null,
        payment_date: paymentDate,
        customer_note: String(formData.get("customer_note") || "").trim() || null,
        billing_months: Number(formData.get("billing_months") || 1),
      });
      toggleForm(false);
      await refresh();
    } catch (error) {
      if (els.kaspiMessage) {
        els.kaspiMessage.hidden = false;
        els.kaspiMessage.textContent = error.message || "Не удалось отправить заявку.";
      }
    }
  }

  async function handleCancelRequest() {
    const latest = billingInfo?.latest_request;
    if (!latest || latest.status !== "pending") return;

    try {
      await BooklyBilling.cancelPaymentRequest(latest.id);
      await refresh();
    } catch (error) {
      if (els.kaspiMessage) {
        els.kaspiMessage.hidden = false;
        els.kaspiMessage.textContent = error.message || "Не удалось отменить заявку.";
      }
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

  function isBlocked() {
    return Boolean(access && access.allowed !== true);
  }

  return { init, refresh, isBlocked };
})();
