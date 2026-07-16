/**
 * Bookly — раздел «Тариф и оплата» + Kaspi + баннер ограничения доступа
 */
window.BooklySubscriptionUI = (() => {
  let organization = null;
  /** Единое состояние доступа (источник истины: subscription access API). */
  let access = null;
  let billingInfo = null;
  let refreshPromise = null;
  let focusBound = false;
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
    els.planBadge = document.getElementById("plan-badge");

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

    if (!focusBound) {
      focusBound = true;
      window.addEventListener("focus", () => {
        refreshBillingAndSubscription().catch(() => {});
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          refreshBillingAndSubscription().catch(() => {});
        }
      });
    }

    return refreshBillingAndSubscription();
  }

  /**
   * Единая точка обновления billing + subscription.
   * Источник истины статуса — getAccess / payment-info.subscription (access API).
   * latest_request.approved сам по себе статус подписки не задаёт.
   */
  async function refreshBillingAndSubscription() {
    if (!organization) return null;
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      let nextBilling = null;
      let nextAccess = null;

      try {
        nextBilling = await BooklyBilling.getPaymentInfo();
      } catch (error) {
        BooklyAuthErrors.logError("billing:load", error);
        nextBilling = null;
      }

      try {
        nextAccess = await BooklySubscription.getAccess(organization.id);
      } catch (error) {
        BooklyAuthErrors.logError("subscription:load", error);
        nextAccess = null;
      }

      // payment-info.subscription тоже из access API — используем как запасной/свежий снимок
      if (nextBilling?.subscription) {
        const fromBilling = BooklySubscription.sanitizeAccess(nextBilling.subscription);
        if (!nextAccess) {
          nextAccess = fromBilling;
        } else if (
          fromBilling.status === "active" &&
          fromBilling.allowed &&
          !(nextAccess.status === "active" && nextAccess.allowed)
        ) {
          nextAccess = fromBilling;
        }
      }

      const latest = nextBilling?.latest_request;
      const looksStaleAfterApprove =
        latest?.status === "approved" &&
        (!nextAccess ||
          nextAccess.allowed !== true ||
          nextAccess.status === "expired" ||
          nextAccess.status === "trialing");

      if (looksStaleAfterApprove) {
        try {
          const retryAccess = await BooklySubscription.getAccess(organization.id);
          if (retryAccess) nextAccess = retryAccess;
          const retryBilling = await BooklyBilling.getPaymentInfo();
          if (retryBilling) {
            nextBilling = retryBilling;
            if (retryBilling.subscription) {
              const fromRetry = BooklySubscription.sanitizeAccess(retryBilling.subscription);
              if (fromRetry.allowed && fromRetry.status === "active") {
                nextAccess = fromRetry;
              }
            }
          }
        } catch (error) {
          BooklyAuthErrors.logError("subscription:refresh-after-approve", error);
        }
      }

      billingInfo = nextBilling;
      access = nextAccess;

      renderPanel();
      renderKaspi();
      renderBanner();
      return access;
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function refresh() {
    return refreshBillingAndSubscription();
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

    if (els.planBadge && access?.status === "active" && access.allowed) {
      els.planBadge.textContent = plan?.name || "Pro";
      els.planBadge.className = "badge badge--success";
    } else if (els.planBadge && access?.status === "trialing" && access.allowed) {
      els.planBadge.textContent = "Пробный";
      els.planBadge.className = "badge badge--muted";
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

    // Не опираться только на trial_ends_at: при active показываем оплаченный период
    const showTrial =
      access.status === "trialing" && Boolean(access.trial_ends_at);
    const showPeriod =
      (access.status === "active" || access.status === "canceled") &&
      Boolean(access.current_period_end);

    toggleRow(els.trialRow, els.trialValue, showTrial, access.trial_ends_at);
    toggleRow(els.periodRow, els.periodValue, showPeriod, access.current_period_end);
    toggleRow(
      els.graceRow,
      els.graceValue,
      access.status === "past_due",
      access.grace_period_ends_at
    );

    if (els.cancelNote) {
      els.cancelNote.hidden = access.status !== "canceled";
    }
  }

  function renderKaspi() {
    if (!els.kaspiBlock) return;

    const kaspi = billingInfo?.kaspi;
    const latest = billingInfo?.latest_request;
    const hasPending = latest?.status === "pending";
    const kaspiConfigured = kaspi?.configured === true;

    if (!kaspiConfigured) {
      if (els.kaspiRecipient) els.kaspiRecipient.textContent = "—";
      if (els.kaspiPhone) els.kaspiPhone.textContent = "—";
      if (els.kaspiAmount) els.kaspiAmount.textContent = "—";
      if (els.kaspiInstructions) {
        els.kaspiInstructions.textContent =
          "Реквизиты оплаты пока не настроены. Свяжитесь с поддержкой.";
      }
      if (els.kaspiPaidBtn) {
        els.kaspiPaidBtn.hidden = false;
        els.kaspiPaidBtn.disabled = true;
        els.kaspiPaidBtn.title = "Реквизиты оплаты пока не настроены";
      }
      if (els.kaspiFormWrap) els.kaspiFormWrap.hidden = true;
      if (els.kaspiCancelRequest) els.kaspiCancelRequest.hidden = true;
      if (els.kaspiRequestStatus && latest) {
        els.kaspiRequestStatus.hidden = false;
        els.kaspiRequestStatus.className = `kaspi-request-status kaspi-request-status--${latest.status}`;
        els.kaspiRequestStatus.innerHTML = renderRequestStatus(latest);
      } else if (els.kaspiRequestStatus) {
        els.kaspiRequestStatus.hidden = true;
      }
      if (els.kaspiMessage) {
        els.kaspiMessage.hidden = false;
        els.kaspiMessage.textContent =
          "Реквизиты оплаты пока не настроены. Свяжитесь с поддержкой.";
      }
      return;
    }

    if (kaspi) {
      if (els.kaspiRecipient) els.kaspiRecipient.textContent = kaspi.recipient || "—";
      if (els.kaspiPhone) els.kaspiPhone.textContent = kaspi.phone || "—";
      if (els.kaspiInstructions) els.kaspiInstructions.textContent = kaspi.instructions || "";
      updateKaspiAmount();
    }

    if (els.kaspiPaidBtn) {
      els.kaspiPaidBtn.hidden = hasPending;
      els.kaspiPaidBtn.disabled = hasPending;
      els.kaspiPaidBtn.title = "";
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
      const until = BooklySubscription.formatDate(
        access?.current_period_end || request.approved_period_end
      );
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
    if (billingInfo?.kaspi?.configured !== true) {
      if (els.kaspiMessage) {
        els.kaspiMessage.hidden = false;
        els.kaspiMessage.textContent =
          "Реквизиты оплаты пока не настроены. Свяжитесь с поддержкой.";
      }
      return;
    }
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

    if (billingInfo?.kaspi?.configured !== true) {
      if (els.kaspiMessage) {
        els.kaspiMessage.hidden = false;
        els.kaspiMessage.textContent =
          "Реквизиты оплаты пока не настроены. Свяжитесь с поддержкой.";
      }
      return;
    }

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
      await refreshBillingAndSubscription();
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
      await refreshBillingAndSubscription();
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

  /**
   * Приоритет баннера:
   * suspended → active+allowed (скрыть) → trialing+allowed (скрыть) →
   * past_due → expired / subscription required.
   * Нельзя показывать expired только из-за прошедшего trial_ends_at при status=active.
   */
  function renderBanner() {
    if (!els.banner) return;

    const hideBanner = () => {
      els.banner.hidden = true;
      els.banner.classList.remove("subscription-banner--suspended");
    };

    if (!access) {
      hideBanner();
      return;
    }

    if (access.status === "suspended" || access.reason === "ORGANIZATION_SUSPENDED") {
      els.banner.hidden = false;
      els.banner.classList.add("subscription-banner--suspended");
      if (els.bannerText) {
        els.bannerText.textContent =
          "Организация приостановлена. Обратитесь в поддержку.";
      }
      return;
    }

    if (access.status === "active" && access.allowed) {
      hideBanner();
      return;
    }

    if (access.status === "trialing" && access.allowed) {
      hideBanner();
      return;
    }

    if (access.allowed === true) {
      hideBanner();
      return;
    }

    els.banner.hidden = false;
    els.banner.classList.remove("subscription-banner--suspended");

    if (els.bannerText) {
      if (access.status === "past_due") {
        els.bannerText.textContent =
          "Не удалось продлить подписку. Оплатите доступ, чтобы продолжить работу.";
      } else {
        els.bannerText.textContent =
          "Подписка закончилась. Продлите доступ, чтобы продолжить работу.";
      }
    }
  }

  function isBlocked() {
    return Boolean(access && access.allowed !== true);
  }

  return {
    init,
    refresh,
    refreshBillingAndSubscription,
    isBlocked,
  };
})();
