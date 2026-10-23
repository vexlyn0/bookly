/**
 * Bookly — раздел «Тариф и оплата» + Kaspi + баннер ограничения доступа
 */
window.BooklySubscriptionUI = (() => {
  let organization = null;
  /** Единое состояние доступа (источник истины: subscription access API). */
  let access = null;
  /** Тариф и лимиты: free / pro, пробный период, лимит мастеров. */
  let entitlements = null;
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

    els.trialBtn = document.getElementById("pro-trial-btn");
    els.upgradeBtn = document.getElementById("pro-upgrade-btn");
    els.trialMessage = document.getElementById("pro-trial-message");
    els.planCardFree = document.getElementById("plan-card-free");
    els.planCardPro = document.getElementById("plan-card-pro");
  }

  async function init(org) {
    organization = org;
    cacheElements();

    const openSubscription = () => {
      document.querySelector('.sidebar__link[data-section="subscription"]')?.click();
    };
    els.bannerLink?.addEventListener("click", openSubscription);
    els.planBadge?.addEventListener("click", openSubscription);
    els.trialBtn?.addEventListener("click", handleStartTrial);
    els.upgradeBtn?.addEventListener("click", () => {
      els.kaspiBlock?.scrollIntoView({ behavior: "smooth", block: "start" });
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

      try {
        entitlements = await BooklySubscription.loadEntitlements(organization.id, { force: true });
      } catch (error) {
        BooklyAuthErrors.logError("subscription:entitlements", error);
        entitlements = billingInfo?.entitlements || entitlements;
      }

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
    if (els.planPrice) {
      const amount = plan?.price_amount ?? 6990;
      const currency = plan?.currency || "KZT";
      els.planPrice.innerHTML = `${BooklySubscription.formatPrice(amount, currency)} <span>/ месяц</span>`;
    }

    renderPlanBadge();

    if (!entitlements) {
      if (els.explain) els.explain.textContent = "Не удалось загрузить данные тарифа.";
      return;
    }

    const label = BooklySubscription.planLabel(entitlements);
    if (els.planName) els.planName.textContent = label;

    if (els.statusBadge) {
      els.statusBadge.textContent = entitlements.is_suspended
        ? "Приостановлен"
        : entitlements.is_pro
          ? "Активен"
          : "Бесплатно";
      els.statusBadge.className = `badge ${
        entitlements.is_suspended ? "badge--danger" : entitlements.is_pro ? "badge--success" : "badge--muted"
      }`;
    }

    if (els.explain) els.explain.textContent = explainEntitlements(entitlements);

    const status = entitlements.status;
    toggleRow(els.trialRow, els.trialValue, entitlements.is_trial, entitlements.trial_ends_at);
    toggleRow(
      els.periodRow,
      els.periodValue,
      entitlements.is_pro && !entitlements.is_trial && Boolean(entitlements.current_period_end),
      entitlements.current_period_end
    );
    toggleRow(
      els.graceRow,
      els.graceValue,
      entitlements.is_pro && status === "past_due",
      entitlements.grace_period_ends_at
    );

    if (els.cancelNote) {
      els.cancelNote.hidden = !(entitlements.is_pro && status === "canceled");
    }

    els.planCardFree?.classList.toggle("is-current", !entitlements.is_pro);
    els.planCardPro?.classList.toggle("is-current", entitlements.is_pro);

    if (els.trialBtn) {
      els.trialBtn.hidden = billingInfo?.trial_enabled !== true;
    }
    if (els.upgradeBtn) {
      els.upgradeBtn.textContent =
        entitlements.is_pro && !entitlements.is_trial ? "Продлить Pro" : "Подключить Pro";
      els.upgradeBtn.hidden = entitlements.is_suspended;
    }
  }

  function renderPlanBadge() {
    if (!els.planBadge) return;
    if (!entitlements) {
      els.planBadge.textContent = "—";
      els.planBadge.className = "badge badge--muted plan-badge";
      return;
    }
    els.planBadge.textContent = BooklySubscription.planLabel(entitlements);
    els.planBadge.className = `badge plan-badge ${
      entitlements.is_suspended ? "badge--danger" : entitlements.is_pro ? "badge--success" : "badge--muted"
    }`;
  }

  function explainEntitlements(value) {
    const days = value.days_remaining ?? 0;
    const daysText = `${days} ${BooklySubscription.pluralDays(days)}`;

    if (value.is_suspended) {
      return "Организация приостановлена. Обратитесь в поддержку.";
    }
    if (value.is_trial) {
      return `Пробный Pro — осталось ${daysText}. Потом вы вернётесь на Free, все данные сохранятся.`;
    }
    if (value.is_pro) {
      if (value.status === "past_due") {
        return `Не удалось продлить Pro. Оплатите до ${BooklySubscription.formatDate(value.grace_period_ends_at)}, иначе вы вернётесь на Free.`;
      }
      if (value.status === "canceled") {
        return `Pro отменён и действует до ${BooklySubscription.formatDate(value.current_period_end)}. Потом — Free.`;
      }
      return `Pro активен до ${BooklySubscription.formatDate(value.current_period_end)}.`;
    }
    return `Бесплатно навсегда. Активных мастеров: ${value.active_staff_count} из ${value.staff_limit ?? 5}.`;
  }

  async function handleStartTrial() {
    if (!els.trialBtn) return;
    els.trialBtn.disabled = true;
    try {
      await BooklyBilling.startTrial();
      await refreshBillingAndSubscription();
      showTrialMessage("Пробный Pro включён на 14 дней.");
    } catch (error) {
      showTrialMessage(error.message || "Не удалось запустить пробный период.");
    } finally {
      els.trialBtn.disabled = false;
    }
  }

  function showTrialMessage(text) {
    if (!els.trialMessage) return;
    els.trialMessage.hidden = !text;
    els.trialMessage.textContent = text || "";
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
   * Баннер: приостановка организации или скорое окончание Pro.
   * Отсутствие Pro — нормальное состояние (Free), баннер не показывается.
   */
  function renderBanner() {
    if (!els.banner) return;

    const hide = () => {
      els.banner.hidden = true;
      els.banner.classList.remove("subscription-banner--suspended");
    };

    if (!entitlements) {
      hide();
      return;
    }

    if (entitlements.is_suspended) {
      els.banner.hidden = false;
      els.banner.classList.add("subscription-banner--suspended");
      if (els.bannerText) {
        els.bannerText.textContent = "Организация приостановлена. Обратитесь в поддержку.";
      }
      return;
    }

    const days = entitlements.days_remaining;
    const endingSoon = entitlements.is_pro && days != null && days <= 3 && entitlements.status !== "canceled";

    if (!endingSoon) {
      hide();
      return;
    }

    els.banner.hidden = false;
    els.banner.classList.remove("subscription-banner--suspended");
    if (els.bannerText) {
      const daysText = `${days} ${BooklySubscription.pluralDays(days)}`;
      els.bannerText.textContent = entitlements.is_trial
        ? `Пробный Pro закончится через ${daysText}. Подключите Pro, чтобы сохранить функции.`
        : `Pro закончится через ${daysText}. Продлите, чтобы не вернуться на Free.`;
    }
  }

  function isBlocked() {
    return Boolean(entitlements?.is_suspended);
  }

  function getEntitlements() {
    return entitlements;
  }

  return {
    init,
    refresh,
    refreshBillingAndSubscription,
    isBlocked,
    getEntitlements,
  };
})();
