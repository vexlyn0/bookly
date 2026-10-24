/**
 * Jazyl — фото на странице записи: логотип, обложка, «Наши работы».
 * Сохраняется сразу после выбора фото — отдельная кнопка «Сохранить» не нужна.
 */
window.BooklyProfileMediaUI = (() => {
  const PORTFOLIO_LIMIT = 24;
  let organization = null;
  let portfolio = [];
  let box = null;
  let busy = "";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function init(org) {
    organization = org;
    box = document.getElementById("profile-media");
    if (!box) return;
    box.addEventListener("click", handleClick);
    box.addEventListener("change", handleFile);
    render();
    await loadPortfolio();
  }

  async function loadPortfolio() {
    try {
      const supabase = await BooklyAuth.getClient();
      const { data, error } = await supabase
        .from("portfolio_photos")
        .select("id, url, created_at")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      portfolio = data || [];
    } catch (error) {
      BooklyAuthErrors.logError("profile-media:portfolio", error);
      portfolio = [];
    }
    render();
  }

  function picker(kind, label, multiple = false) {
    return `
      <label class="btn btn--outline btn--sm profile-media__pick${busy === kind ? " is-loading" : ""}">
        ${busy === kind ? "Загрузка…" : label}
        <input type="file" accept="image/*" data-kind="${kind}" ${multiple ? "multiple" : ""} hidden ${busy ? "disabled" : ""}>
      </label>`;
  }

  function render(message = "", isError = false) {
    if (!box) return;
    const logo = organization.logo_url;
    const cover = organization.cover_url;
    const brand = organization.brand_color || "#534AB7";

    box.innerHTML = `
      <header class="profile-media__head">
        <h3 class="profile-media__title">Фото на странице записи</h3>
        <p class="profile-media__hint">Сохраняются сразу. Большие фото с телефона мы сами уменьшим.</p>
      </header>

      <div class="profile-media__row">
        <div class="profile-media__item">
          <span class="field__label">Логотип</span>
          <div class="profile-media__logo" style="background:${escapeHtml(brand)}">
            ${logo ? `<img src="${escapeHtml(logo)}" alt="Логотип">` : `<span>${escapeHtml((organization.public_name || organization.name || "J").trim().charAt(0).toUpperCase())}</span>`}
          </div>
          <div class="profile-media__actions">
            ${picker("logo", logo ? "Заменить" : "Загрузить")}
            ${logo ? `<button type="button" class="btn btn--ghost btn--sm" data-remove="logo">Убрать</button>` : ""}
          </div>
        </div>

        <div class="profile-media__item profile-media__item--wide">
          <span class="field__label">Обложка</span>
          <div class="profile-media__cover" style="background:${escapeHtml(brand)}">
            ${cover ? `<img src="${escapeHtml(cover)}" alt="Обложка">` : `<span>Фото салона — интерьер или работа</span>`}
          </div>
          <div class="profile-media__actions">
            ${picker("cover", cover ? "Заменить" : "Загрузить")}
            ${cover ? `<button type="button" class="btn btn--ghost btn--sm" data-remove="cover">Убрать</button>` : ""}
          </div>
        </div>
      </div>

      <div class="profile-media__item">
        <span class="field__label">Наши работы <span class="profile-media__count">${portfolio.length} из ${PORTFOLIO_LIMIT}</span></span>
        <div class="profile-media__grid">
          ${portfolio
            .map(
              (photo) => `
            <div class="profile-media__photo">
              <img src="${escapeHtml(photo.url)}" alt="" loading="lazy">
              <button type="button" class="profile-media__remove" data-remove-photo="${photo.id}" aria-label="Удалить фото">×</button>
            </div>`
            )
            .join("")}
          ${portfolio.length < PORTFOLIO_LIMIT ? `<div class="profile-media__add">${picker("portfolio", "+ Добавить", true)}</div>` : ""}
        </div>
      </div>

      ${message ? `<p class="alert ${isError ? "alert--error" : "alert--success"} profile-media__message" role="status">${escapeHtml(message)}</p>` : ""}
    `;
  }

  async function saveOrgPhoto(field, url) {
    const supabase = await BooklyAuth.getClient();
    const { error } = await supabase.from("organizations").update({ [field]: url }).eq("id", organization.id);
    if (error) throw error;
    const previous = organization[field];
    organization = { ...organization, [field]: url };
    document.dispatchEvent(new CustomEvent("bookly:organization-changed", { detail: { [field]: url } }));
    if (previous && previous !== url) BooklyMedia.removeByUrl(previous);
  }

  async function handleFile(event) {
    const input = event.target.closest('input[type="file"][data-kind]');
    if (!input || !input.files?.length) return;
    const kind = input.dataset.kind;
    const files = [...input.files];
    busy = kind;
    render();

    try {
      if (kind === "portfolio") {
        const free = PORTFOLIO_LIMIT - portfolio.length;
        const supabase = await BooklyAuth.getClient();
        for (const file of files.slice(0, free)) {
          const url = await BooklyMedia.upload(organization.id, "portfolio", file);
          const { error } = await supabase.from("portfolio_photos").insert([{ organization_id: organization.id, url }]);
          if (error) {
            BooklyMedia.removeByUrl(url);
            throw error;
          }
        }
        busy = "";
        await loadPortfolio();
        render(files.length > free ? `Добавлено ${free} фото — больше ${PORTFOLIO_LIMIT} нельзя.` : "Фото добавлены.");
        return;
      }

      const url = await BooklyMedia.upload(organization.id, kind, files[0]);
      await saveOrgPhoto(kind === "logo" ? "logo_url" : "cover_url", url);
      busy = "";
      render(kind === "logo" ? "Логотип обновлён." : "Обложка обновлена.");
    } catch (error) {
      BooklyAuthErrors.logError("profile-media:upload", error);
      busy = "";
      render(BooklySubscription.mapDbError(error) || error.message || "Не удалось загрузить фото.", true);
    }
  }

  async function handleClick(event) {
    const removeField = event.target.closest("[data-remove]")?.dataset.remove;
    const removePhoto = event.target.closest("[data-remove-photo]")?.dataset.removePhoto;
    if (!removeField && !removePhoto) return;

    try {
      if (removeField) {
        await saveOrgPhoto(removeField === "logo" ? "logo_url" : "cover_url", null);
        render(removeField === "logo" ? "Логотип убран." : "Обложка убрана.");
        return;
      }
      const photo = portfolio.find((item) => item.id === removePhoto);
      const supabase = await BooklyAuth.getClient();
      const { error } = await supabase.from("portfolio_photos").delete().eq("id", removePhoto);
      if (error) throw error;
      portfolio = portfolio.filter((item) => item.id !== removePhoto);
      if (photo) BooklyMedia.removeByUrl(photo.url);
      render();
    } catch (error) {
      BooklyAuthErrors.logError("profile-media:remove", error);
      render(BooklySubscription.mapDbError(error) || "Не удалось удалить. Попробуйте ещё раз.", true);
    }
  }

  return { init };
})();
