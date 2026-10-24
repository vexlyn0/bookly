/**
 * Jazyl — Telegram владельца (раздел «Уведомления»)
 * Привязка: t.me/<бот>?start=o_<owner_telegram_link_token>; бот сам записывает чат.
 * Оплаты Kaspi приходят всегда, копии записей и отмен — по галочкам.
 */
window.BooklyOwnerTelegram = (() => {
  const FIELDS = "owner_telegram_chat_id, owner_telegram_link_token, owner_notify_bookings, owner_notify_changes";

  let organization = null;
  let state = null;
  let waiting = false;
  const els = {};

  function botUsername() {
    return String(window.BooklyConfig?.telegramBotUsername || "");
  }

  function isOwner() {
    return organization?.role === "owner";
  }

  function showError(message) {
    els.error.textContent = message || "";
    els.error.hidden = !message;
  }

  async function load() {
    const supabase = await BooklyAuth.getClient();
    const { data, error } = await supabase.from("organizations").select(FIELDS).eq("id", organization.id).maybeSingle();
    if (error) throw error;
    state = data || {};
    render();
  }

  async function save(patch) {
    const supabase = await BooklyAuth.getClient();
    const { error } = await supabase.from("organizations").update(patch).eq("id", organization.id);
    if (error) throw error;
    Object.assign(state, patch);
  }

  function render() {
    const connected = Boolean(state?.owner_telegram_chat_id);
    els.root.classList.toggle("is-connected", connected);

    if (connected) {
      els.status.textContent = "✅ Подключён. Оплаты Kaspi и записи приходят в ваш Telegram.";
      waiting = false;
    } else if (waiting) {
      els.status.textContent = "Ждём, когда вы нажмёте Start в боте…";
    } else {
      els.status.textContent = "Не подключён. Оплаты Kaspi сейчас видны только здесь, в разделе «Записи».";
    }

    els.connect.hidden = connected || !isOwner();
    els.check.hidden = connected || !waiting;
    els.hint.hidden = connected || !waiting;
    els.disconnect.hidden = !connected || !isOwner();

    els.bookings.checked = state?.owner_notify_bookings !== false;
    els.changes.checked = state?.owner_notify_changes !== false;
    els.bookings.disabled = !isOwner();
    els.changes.disabled = !isOwner();

    if (!isOwner()) showError("Подключить Telegram и менять настройки может только владелец салона.");
  }

  function connect() {
    showError("");
    if (!botUsername()) {
      showError("Telegram-бот не настроен. Обратитесь в поддержку.");
      return;
    }
    if (!state?.owner_telegram_link_token) {
      showError("Ссылка не найдена. Обновите страницу.");
      return;
    }
    const link = `https://t.me/${encodeURIComponent(botUsername())}?start=o_${encodeURIComponent(state.owner_telegram_link_token)}`;
    window.open(link, "_blank", "noopener");
    waiting = true;
    render();
  }

  async function check() {
    try {
      els.check.disabled = true;
      await load();
      if (!state.owner_telegram_chat_id) {
        showError("Пока не видим подключения. Откройте бота, нажмите Start и попробуйте ещё раз.");
      } else {
        showError("");
      }
    } catch (error) {
      BooklyAuthErrors.logError("owner-telegram:check", error);
      showError("Не удалось проверить. Попробуйте ещё раз.");
    } finally {
      els.check.disabled = false;
    }
  }

  async function disconnect() {
    if (!window.confirm("Отключить Telegram владельца? Оплаты Kaspi придётся проверять в разделе «Записи».")) return;
    try {
      els.disconnect.disabled = true;
      await save({ owner_telegram_chat_id: null });
      render();
    } catch (error) {
      BooklyAuthErrors.logError("owner-telegram:disconnect", error);
      showError("Не удалось отключить. Попробуйте ещё раз.");
    } finally {
      els.disconnect.disabled = false;
    }
  }

  async function toggle(input, field) {
    showError("");
    const value = input.checked;
    try {
      input.disabled = true;
      await save({ [field]: value });
    } catch (error) {
      BooklyAuthErrors.logError("owner-telegram:toggle", error);
      input.checked = !value;
      showError("Не удалось сохранить. Попробуйте ещё раз.");
    } finally {
      input.disabled = !isOwner();
    }
  }

  function init(org) {
    organization = org;
    els.root = document.getElementById("owner-telegram");
    if (!els.root) return;
    els.status = document.getElementById("owner-telegram-status");
    els.connect = document.getElementById("owner-telegram-connect");
    els.check = document.getElementById("owner-telegram-check");
    els.disconnect = document.getElementById("owner-telegram-disconnect");
    els.hint = document.getElementById("owner-telegram-hint");
    els.bookings = document.getElementById("owner-notify-bookings");
    els.changes = document.getElementById("owner-notify-changes");
    els.error = document.getElementById("owner-telegram-error");

    els.connect.addEventListener("click", connect);
    els.check.addEventListener("click", check);
    els.disconnect.addEventListener("click", disconnect);
    els.bookings.addEventListener("change", () => toggle(els.bookings, "owner_notify_bookings"));
    els.changes.addEventListener("change", () => toggle(els.changes, "owner_notify_changes"));

    // Вернулся из Telegram — проверяем сами, без кнопки.
    window.addEventListener("focus", () => {
      if (waiting) void load().catch(() => {});
    });

    load().catch((error) => {
      BooklyAuthErrors.logError("owner-telegram:load", error);
      els.status.textContent = "Не удалось загрузить настройки. Обновите страницу.";
    });
  }

  function isConnected() {
    return Boolean(state?.owner_telegram_chat_id);
  }

  return { init, isConnected };
})();
