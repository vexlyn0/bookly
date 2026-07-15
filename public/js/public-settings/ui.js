/**
 * Bookly — раздел «Онлайн-запись»
 */
window.BooklyPublicSettingsUI = (() => {
  let organization = null;
  const els = {};

  function cacheElements() {
    els.section = document.getElementById("public-booking-section");
    els.form = document.getElementById("public-booking-form");
    els.error = document.getElementById("public-booking-form-error");
    els.success = document.getElementById("public-booking-form-success");
    els.submit = document.getElementById("public-booking-form-submit");
    els.link = document.getElementById("public-booking-link");
    els.openBtn = document.getElementById("public-booking-open-btn");
    els.copyBtn = document.getElementById("public-booking-copy-btn");
  }

  function init(org) {
    organization = org;
    cacheElements();
    if (!els.section || !els.form) return;

    populateForm();
    updatePublicLink();
    els.form.addEventListener("submit", handleSubmit);
    els.form.elements.namedItem("slug")?.addEventListener("input", updatePublicLink);
    els.openBtn?.addEventListener("click", openPublicPage);
    els.copyBtn?.addEventListener("click", copyPublicLink);
  }

  function getPublicUrl(slug = organization?.slug) {
    if (!slug) return "";
    return `${window.location.origin}/book/${slug}`;
  }

  function updatePublicLink() {
    const slug = String(els.form?.elements.namedItem("slug")?.value || organization?.slug || "")
      .trim()
      .toLowerCase();
    const url = getPublicUrl(slug);
    if (els.link) els.link.textContent = url || "—";
  }

  function populateForm() {
    if (!els.form || !organization) return;

    els.form.elements.namedItem("public_name").value = organization.public_name || organization.name || "";
    els.form.elements.namedItem("slug").value = organization.slug || "";
    els.form.elements.namedItem("description").value = organization.description || "";
    els.form.elements.namedItem("phone").value = organization.phone || "";
    els.form.elements.namedItem("address").value = organization.address || "";
    els.form.elements.namedItem("public_booking_enabled").checked =
      organization.public_booking_enabled === true;
    els.form.elements.namedItem("booking_confirmation_mode").value =
      organization.booking_confirmation_mode || "auto";
  }

  function hideMessages() {
    if (els.error) {
      els.error.hidden = true;
      els.error.textContent = "";
    }
    if (els.success) {
      els.success.hidden = true;
      els.success.textContent = "";
    }
  }

  function showError(message) {
    if (!els.error) return;
    els.error.textContent = message;
    els.error.hidden = false;
    if (els.success) els.success.hidden = true;
  }

  function showSuccess(message) {
    if (!els.success) return;
    els.success.textContent = message;
    els.success.hidden = false;
    if (els.error) els.error.hidden = true;
  }

  function mapSaveError(error) {
    const message = String(error?.message || "");

    if (
      message.includes("organizations_slug_unique") ||
      (message.includes("duplicate key") && message.toLowerCase().includes("slug"))
    ) {
      return "Этот адрес уже занят";
    }
    if (message.includes("organizations_slug_format")) {
      return "Slug может содержать только латиницу, цифры и дефисы.";
    }
    return "Не удалось сохранить настройки. Проверьте данные и попробуйте снова.";
  }

  async function handleSubmit(event) {
    event.preventDefault();
    hideMessages();
    BooklyAuthUI.clearFieldErrors(els.form);

    const form = els.form;
    const payload = {
      public_name: form.elements.namedItem("public_name").value,
      slug: form.elements.namedItem("slug").value,
      description: form.elements.namedItem("description").value,
      phone: form.elements.namedItem("phone").value,
      address: form.elements.namedItem("address").value,
      public_booking_enabled: form.elements.namedItem("public_booking_enabled").checked,
      booking_confirmation_mode: form.elements.namedItem("booking_confirmation_mode").value,
    };

    const result = BooklyPublicSettingsValidation.validate(payload);
    if (!result.valid) {
      Object.entries(result.errors).forEach(([field, message]) => {
        BooklyAuthUI.setFieldError(form.elements.namedItem(field), message);
      });
      return;
    }

    BooklyAuthUI.setButtonLoading(els.submit, true, "Сохранение…", "Сохранить");

    try {
      const updated = await BooklyOrg.updatePublicBookingSettings(organization.id, result.data);
      organization = { ...organization, ...updated };
      populateForm();
      updatePublicLink();
      showSuccess("Настройки онлайн-записи сохранены.");
    } catch (error) {
      showError(mapSaveError(error));
    } finally {
      BooklyAuthUI.setButtonLoading(els.submit, false, "Сохранение…", "Сохранить");
    }
  }

  function openPublicPage() {
    const url = getPublicUrl();
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function copyPublicLink() {
    const url = getPublicUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showSuccess("Ссылка скопирована в буфер обмена.");
    } catch {
      showError("Не удалось скопировать ссылку.");
    }
  }

  return { init };
})();
