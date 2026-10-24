/**
 * Jazyl — экран предоплаты Kaspi: реквизиты, таймер, «Я оплатил», ожидание подтверждения.
 * Используется сразу после записи и на странице «Моя запись» (/b/<token>).
 */
window.PublicBookingPrepay = (() => {
  const I18n = window.PublicBookingI18n;
  const t = (key, vars) => I18n.t(key, vars);
  const POLL_MS = 8000;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatAmount(value) {
    return `${Math.round(Number(value) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₸`;
  }

  function formatLeft(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  async function api(token, path = "", method = "GET") {
    const response = await fetch(`/api/public/manage/${encodeURIComponent(token)}${path}`, {
      method,
      headers: { Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: method === "POST" ? "{}" : undefined,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(PublicBookingErrors.fromResponse(payload));
      error.code = payload?.code;
      throw error;
    }
    return payload;
  }

  /**
   * @param {HTMLElement} el
   * @param {object} options
   * @param {string} options.token      manage_token записи
   * @param {object} options.prepay     { amount, status, deadline, kaspi_phone, kaspi_name, kaspi_link, note, bot_url }
   * @param {string} options.summary    «Маникюр · вт, 22 октября, 15:00»
   * @param {string} options.manageUrl  полная ссылка на запись
   * @param {string} [options.restartUrl] куда вести «Записаться снова»
   * @param {(status: string) => void} [options.onDone]  оплата подтверждена / отклонена / просрочена
   */
  function mount(el, { token, prepay, summary, manageUrl, restartUrl, onDone }) {
    let view = { ...prepay };
    let timer = null;
    let poll = null;
    let error = "";
    let sending = false;

    function stop() {
      clearInterval(timer);
      clearTimeout(poll);
    }

    function finish(status) {
      stop();
      render();
      onDone?.(status);
    }

    function render() {
      if (view.status === "paid" || view.status === "rejected" || view.status === "expired") {
        const text = t(view.status === "paid" ? "prepay_paid" : view.status === "rejected" ? "prepay_rejected" : "prepay_expired");
        el.innerHTML = `
          <div class="pb-prepay__result pb-prepay__result--${view.status}">
            <p class="pb-prepay__result-text">${escapeHtml(text)}</p>
            ${view.status !== "paid" && restartUrl ? `<a class="pb-btn" href="${escapeHtml(restartUrl)}">${escapeHtml(t("book_again_btn"))}</a>` : ""}
          </div>`;
        return;
      }

      if (view.status === "claimed") {
        el.innerHTML = `
          <h2 class="pb-panel__title">${escapeHtml(t("prepay_waiting_title"))}</h2>
          <p class="pb-panel__hint">${escapeHtml(summary)} · ${escapeHtml(formatAmount(view.amount))}</p>
          <div class="pb-verify">
            <p class="pb-verify__wait"><span class="pb-verify__spinner" aria-hidden="true"></span>${escapeHtml(t("prepay_waiting_title"))}…</p>
            <p class="pb-verify__note">${escapeHtml(t("prepay_waiting"))}</p>
          </div>
          ${linksBlock()}`;
        return;
      }

      const left = new Date(view.deadline).getTime() - Date.now();
      const phone = String(view.kaspi_phone || "");
      el.innerHTML = `
        <h2 class="pb-panel__title">${escapeHtml(t("prepay_title"))}</h2>
        <p class="pb-panel__hint">${escapeHtml(summary)}</p>

        <div class="pb-prepay__amount">${escapeHtml(formatAmount(view.amount))}</div>

        <div class="pb-prepay__card">
          <p class="pb-prepay__label">${escapeHtml(t("prepay_to"))}</p>
          <p class="pb-prepay__phone">${escapeHtml(phone)}</p>
          ${view.kaspi_name ? `<p class="pb-prepay__name">${escapeHtml(view.kaspi_name)}</p>` : ""}
          <div class="pb-prepay__actions">
            <button type="button" class="pb-btn pb-btn--ghost" data-prepay="copy">${escapeHtml(t("copy_number"))}</button>
            ${view.kaspi_link ? `<a class="pb-btn pb-btn--ghost" href="${escapeHtml(view.kaspi_link)}" target="_blank" rel="noopener">${escapeHtml(t("open_kaspi"))}</a>` : ""}
          </div>
          <p class="pb-prepay__hint">${escapeHtml(t("prepay_hint"))}</p>
        </div>

        <div class="pb-prepay__warning" role="note">
          <p class="pb-prepay__warning-title">⚠️ ${escapeHtml(t("prepay_warning_title"))}</p>
          <p>${escapeHtml(t("prepay_warning"))}</p>
          <p class="pb-prepay__timer" data-prepay-timer>${escapeHtml(t("prepay_timer", { time: formatLeft(left) }))}</p>
        </div>

        ${view.note ? `<div class="pb-prepay__note"><p class="pb-prepay__label">${escapeHtml(t("prepay_note_title"))}</p><p>${escapeHtml(view.note)}</p></div>` : ""}

        ${error ? `<p class="alert alert--error pb-alert" role="alert">${escapeHtml(error)}</p>` : ""}
        <button type="button" class="pb-btn" data-prepay="claim" ${sending ? "disabled" : ""}>${escapeHtml(t(sending ? "sending" : "i_paid"))}</button>
        ${linksBlock(true)}`;
    }

    function linksBlock(withFallbackText = false) {
      return `
        <div class="pb-prepay__links">
          ${withFallbackText ? `<p class="pb-prepay__fallback">${escapeHtml(t("prepay_fallback"))}</p>` : ""}
          <div class="pb-prepay__actions">
            ${manageUrl ? `<button type="button" class="pb-btn pb-btn--ghost" data-prepay="copy-link">${escapeHtml(t("copy_manage_link"))}</button>` : ""}
            ${view.bot_url ? `<a class="pb-btn pb-btn--ghost" href="${escapeHtml(view.bot_url)}" target="_blank" rel="noopener">${escapeHtml(t("open_bot"))}</a>` : ""}
          </div>
        </div>`;
    }

    async function refresh() {
      try {
        const info = await api(token);
        if (info.prepay) view = { ...view, ...info.prepay };
        // Запись отменили/подтвердили в обход (например, салон в кабинете)
        if (info.booking?.status === "canceled" && !["rejected", "expired"].includes(view.status)) view.status = "rejected";
      } catch {
        // нет сети — проверим позже
      }
    }

    function tick() {
      if (view.status !== "awaiting") return;
      const left = new Date(view.deadline).getTime() - Date.now();
      const node = el.querySelector("[data-prepay-timer]");
      if (node) node.textContent = t("prepay_timer", { time: formatLeft(left) });
      if (left <= 0) {
        view.status = "expired";
        finish("expired");
      }
    }

    async function waitForSalon() {
      clearTimeout(poll);
      await refresh();
      if (["paid", "rejected", "expired"].includes(view.status)) return finish(view.status);
      render();
      poll = setTimeout(waitForSalon, POLL_MS);
    }

    async function copy(text, button, doneLabel) {
      try {
        await navigator.clipboard.writeText(text);
        if (button && doneLabel) button.textContent = doneLabel;
      } catch {
        window.prompt("", text);
      }
    }

    el.onclick = async (event) => {
      const action = event.target.closest("[data-prepay]")?.dataset.prepay;
      if (action === "copy") copy(String(view.kaspi_phone || "").replace(/[^\d+]/g, ""), event.target, t("number_copied"));
      if (action === "copy-link" && manageUrl) copy(manageUrl, event.target, t("copied"));
      if (action === "claim" && !sending) {
        sending = true;
        error = "";
        render();
        try {
          const info = await api(token, "/prepay-claim", "POST");
          view = { ...view, ...(info.prepay || {}), status: info.prepay?.status || "claimed" };
          sending = false;
          if (["paid", "rejected", "expired"].includes(view.status)) return finish(view.status);
          clearInterval(timer);
          waitForSalon();
        } catch (err) {
          sending = false;
          if (err.code === "PREPAY_EXPIRED") {
            view.status = "expired";
            return finish("expired");
          }
          error = err.message;
          render();
        }
      }
    };

    // Вернулись на вкладку (например, из Kaspi) — сразу обновить
    const onVisible = () => {
      if (document.visibilityState === "visible" && view.status === "claimed") waitForSalon();
    };
    document.addEventListener("visibilitychange", onVisible);

    render();
    if (view.status === "awaiting") timer = setInterval(tick, 1000);
    if (view.status === "claimed") poll = setTimeout(waitForSalon, POLL_MS);

    return {
      rerender: render,
      destroy() {
        stop();
        document.removeEventListener("visibilitychange", onVisible);
      },
    };
  }

  return { mount, formatAmount };
})();
