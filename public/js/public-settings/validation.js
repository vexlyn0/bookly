/**
 * Bookly — настройки публичной онлайн-записи
 */
window.BooklyPublicSettingsValidation = (() => {
  const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  function validate(payload) {
    const errors = {};
    const publicName = String(payload.public_name || "").trim();
    const slug = String(payload.slug || "").trim().toLowerCase();
    const description = String(payload.description || "").trim();
    const phone = String(payload.phone || "").trim();
    const address = String(payload.address || "").trim();
    const mode = String(payload.booking_confirmation_mode || "auto");
    const instagram = String(payload.instagram || "").trim();
    const whatsapp = String(payload.whatsapp || "").trim();
    const gisUrl = String(payload.gis_url || "").trim();
    const kaspiPhone = String(payload.kaspi_phone || "").trim();
    const kaspiName = String(payload.kaspi_name || "").trim();
    const kaspiLink = String(payload.kaspi_link || "").trim();
    const prepayNote = String(payload.prepay_note || "").trim();
    const holdMinutes = Number(payload.prepay_hold_minutes) || 30;

    if (publicName.length < 2) {
      errors.public_name = "Публичное название должно содержать минимум 2 символа.";
    }

    if (slug.length < 3 || slug.length > 60 || !SLUG_PATTERN.test(slug)) {
      errors.slug = "Slug: только латиница, цифры и дефисы, от 3 до 60 символов.";
    }

    if (description.length > 1000) {
      errors.description = "Описание слишком длинное.";
    }

    if (phone.length > 30) {
      errors.phone = "Телефон слишком длинный.";
    }

    if (address.length > 200) {
      errors.address = "Адрес слишком длинный.";
    }

    if (instagram.length > 100) {
      errors.instagram = "Слишком длинно — укажите @ник или ссылку.";
    }

    if (whatsapp && (whatsapp.replace(/\D/g, "").length < 10 || whatsapp.length > 30)) {
      errors.whatsapp = "Укажите номер WhatsApp полностью.";
    }

    if (gisUrl && (!/^https:\/\//i.test(gisUrl) || gisUrl.length > 500)) {
      errors.gis_url = "Вставьте ссылку из 2ГИС целиком — она начинается с https://";
    }

    if (kaspiPhone && (kaspiPhone.replace(/\D/g, "").length < 10 || kaspiPhone.length > 30)) {
      errors.kaspi_phone = "Укажите номер Kaspi полностью.";
    }

    if (kaspiName.length > 60) {
      errors.kaspi_name = "Слишком длинное имя.";
    }

    if (kaspiLink && (!/^https:\/\//i.test(kaspiLink) || kaspiLink.length > 500)) {
      errors.kaspi_link = "Ссылка должна начинаться с https://";
    }

    if (prepayNote.length > 300) {
      errors.prepay_note = "Не больше 300 символов.";
    }

    if (!["auto", "manual"].includes(mode)) {
      errors.booking_confirmation_mode = "Выберите режим подтверждения.";
    }

    // "off" — клиент не может сам менять запись (null в базе)
    const cutoffRaw = String(payload.client_manage_cutoff_hours ?? "2");
    const cutoff = cutoffRaw === "off" ? null : Number(cutoffRaw);
    if (cutoff !== null && !(Number.isInteger(cutoff) && cutoff >= 0 && cutoff <= 168)) {
      errors.client_manage_cutoff_hours = "Выберите срок отмены.";
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      data: {
        public_name: publicName,
        slug,
        description: description || null,
        phone: phone || null,
        address: address || null,
        public_booking_enabled: Boolean(payload.public_booking_enabled),
        booking_confirmation_mode: mode,
        client_manage_cutoff_hours: cutoff,
        require_phone_verification: Boolean(payload.require_phone_verification),
        brand_color: /^#[0-9a-f]{6}$/i.test(String(payload.brand_color || "")) ? payload.brand_color : "#534AB7",
        instagram: instagram || null,
        whatsapp: whatsapp || null,
        gis_url: gisUrl || null,
        kaspi_phone: kaspiPhone || null,
        kaspi_name: kaspiName || null,
        kaspi_link: kaspiLink || null,
        prepay_hold_minutes: [15, 30, 60].includes(holdMinutes) ? holdMinutes : 30,
        prepay_note: prepayNote || null,
      },
    };
  }

  return { validate, SLUG_PATTERN };
})();
