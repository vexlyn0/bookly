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
      },
    };
  }

  return { validate, SLUG_PATTERN };
})();
