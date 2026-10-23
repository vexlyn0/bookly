/**
 * Bookly — чёрный список номеров (раздел «Онлайн-запись»)
 * С номеров из списка нельзя записаться онлайн; проверяет сервер.
 */
window.BooklyBlacklist = (() => {
  let organization = null;
  let entries = [];
  const els = {};

  /** Та же нормализация, что public.phone_key() в базе. */
  function phoneKey(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
    if (digits.length === 10) return `7${digits}`;
    return digits;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function emitChange() {
    document.dispatchEvent(new CustomEvent("bookly:blacklist-changed"));
  }

  async function load() {
    const supabase = await BooklyAuth.getClient();
    const { data, error } = await supabase
      .from("client_blacklist")
      .select("id, phone, phone_key, client_name, created_at")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    entries = data || [];
    render();
    emitChange();
  }

  function isBlocked(phone) {
    const key = phoneKey(phone);
    return Boolean(key) && entries.some((item) => item.phone_key === key);
  }

  async function add({ phone, clientName = "" }) {
    const value = String(phone || "").trim();
    if (phoneKey(value).length < 10) {
      throw new Error("Введите номер телефона полностью.");
    }
    if (isBlocked(value)) return;

    const supabase = await BooklyAuth.getClient();
    const { error } = await supabase.from("client_blacklist").insert({
      organization_id: organization.id,
      phone: value,
      client_name: String(clientName || "").trim().slice(0, 100) || null,
    });

    // 23505 — номер уже в списке (в другом формате)
    if (error && error.code !== "23505") throw error;
    await load();
  }

  async function remove(id) {
    const supabase = await BooklyAuth.getClient();
    const { error } = await supabase.from("client_blacklist").delete().eq("id", id);
    if (error) throw error;
    await load();
  }

  function render() {
    if (!els.list) return;
    if (!entries.length) {
      els.list.innerHTML = `<li class="blacklist__empty">Список пуст.</li>`;
      return;
    }
    els.list.innerHTML = entries
      .map(
        (item) => `
          <li class="blacklist__item">
            <span class="blacklist__phone">${escapeHtml(item.phone)}</span>
            ${item.client_name ? `<span class="blacklist__name">${escapeHtml(item.client_name)}</span>` : ""}
            <button class="blacklist__remove" type="button" data-blacklist-remove="${item.id}" aria-label="Убрать из списка" title="Убрать из списка">×</button>
          </li>`
      )
      .join("");
  }

  function showError(message) {
    if (!els.error) return;
    els.error.textContent = message;
    els.error.hidden = !message;
  }

  async function handleAdd(event) {
    event.preventDefault();
    showError("");
    const button = els.form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await add({ phone: els.phone.value });
      els.phone.value = "";
    } catch (error) {
      showError(error.message || "Не удалось добавить номер.");
    } finally {
      button.disabled = false;
    }
  }

  async function handleListClick(event) {
    const button = event.target.closest("[data-blacklist-remove]");
    if (!button) return;
    const item = entries.find((entry) => entry.id === button.dataset.blacklistRemove);
    if (!item || !confirm(`Убрать ${item.phone} из чёрного списка?`)) return;
    button.disabled = true;
    try {
      await remove(item.id);
    } catch {
      button.disabled = false;
      showError("Не удалось убрать номер. Попробуйте ещё раз.");
    }
  }

  function init(org) {
    organization = org;
    els.form = document.getElementById("blacklist-form");
    els.phone = document.getElementById("blacklist-phone");
    els.list = document.getElementById("blacklist-list");
    els.error = document.getElementById("blacklist-error");

    els.form?.addEventListener("submit", handleAdd);
    els.list?.addEventListener("click", handleListClick);

    load().catch(() => {
      if (els.list) els.list.innerHTML = `<li class="blacklist__empty">Не удалось загрузить список.</li>`;
    });
  }

  return { init, add, isBlocked, phoneKey };
})();
