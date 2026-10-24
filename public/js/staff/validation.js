/**
 * Bookly — валидация сотрудников
 */
window.BooklyStaffValidation = (() => {
  const MIN_NAME_LENGTH = 2;

  function validate(payload) {
    const errors = {};
    const name = String(payload.name || "").trim();
    const position = String(payload.position || "").trim();
    const phone = String(payload.phone || "").trim();
    const emailRaw = String(payload.email || "").trim();
    const description = String(payload.description || "").trim();

    if (name.length < MIN_NAME_LENGTH) {
      errors.name = `Имя должно содержать минимум ${MIN_NAME_LENGTH} символа.`;
    }

    if (emailRaw) {
      const emailError = BooklyAuthUI.validateEmail(emailRaw);
      if (emailError) {
        errors.email = emailError;
      }
    }

    const serviceIds = Array.isArray(payload.service_ids)
      ? payload.service_ids.filter(Boolean)
      : [];

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      data: {
        name,
        position: position || null,
        photo_url: /^https:\/\//.test(String(payload.photo_url || "")) ? payload.photo_url : null,
        phone: phone || null,
        email: emailRaw || null,
        description: description || null,
        is_active: payload.is_active !== false,
        service_ids: serviceIds,
      },
    };
  }

  return { validate, MIN_NAME_LENGTH };
})();
