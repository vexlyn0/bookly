/**
 * Bookly — валидация формы бронирования
 */
window.BooklyBookingsValidation = (() => {
  function validate(payload, { isEdit = false } = {}) {
    const errors = {};
    const clientName = String(payload.client_name || "").trim();
    const clientPhone = String(payload.client_phone || "").trim();
    const clientEmail = String(payload.client_email || "").trim();
    const clientComment = String(payload.client_comment || "").trim();

    if (!payload.service_id) errors.service_id = "Выберите услугу.";
    if (!payload.staff_id) errors.staff_id = "Выберите сотрудника.";
    if (!payload.booking_date) errors.booking_date = "Выберите дату.";
    if (!payload.start_time) errors.start_time = "Выберите время.";

    if (clientName.length < 2) {
      errors.client_name = "Имя клиента должно содержать минимум 2 символа.";
    }

    if (clientPhone.length < 5) {
      errors.client_phone = "Телефон должен содержать минимум 5 символов.";
    }

    if (clientEmail) {
      const emailError = BooklyAuthUI.validateEmail(clientEmail);
      if (emailError) errors.client_email = emailError;
    }

    const status = String(payload.status || "confirmed");
    const allowed = BooklyBookingsConstants.STATUSES.map((item) => item.value);
    if (!allowed.includes(status)) {
      errors.status = "Укажите корректный статус.";
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      data: {
        service_id: payload.service_id,
        staff_id: payload.staff_id,
        booking_date: payload.booking_date,
        start_time: BooklyBookingsSlots.formatTimeForInput(payload.start_time),
        client_name: clientName,
        client_phone: clientPhone,
        client_email: clientEmail || null,
        client_comment: clientComment || null,
        status,
        source: isEdit ? payload.source || "manual" : "manual",
      },
    };
  }

  return { validate };
})();
