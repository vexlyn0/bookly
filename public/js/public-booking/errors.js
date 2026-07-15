window.PublicBookingErrors = (() => {
  const MESSAGES = {
    ORGANIZATION_NOT_FOUND: "Организация не найдена.",
    PUBLIC_BOOKING_DISABLED: "Онлайн-запись временно недоступна.",
    SERVICE_NOT_FOUND: "Услуга не найдена.",
    SERVICE_INACTIVE: "Услуга недоступна для записи.",
    STAFF_NOT_FOUND: "Сотрудник не найден.",
    STAFF_INACTIVE: "Сотрудник недоступен для записи.",
    STAFF_SERVICE_MISMATCH: "Сотрудник не оказывает выбранную услугу.",
    NO_WORK_SCHEDULE: "На выбранную дату нет рабочего времени.",
    BOOKING_IN_PAST: "Нельзя записаться на прошедшее время.",
    BOOKING_TIME_CONFLICT: "Это время уже занято. Выберите другой слот.",
    VALIDATION_ERROR: "Проверьте введённые данные.",
    TOO_MANY_BOOKING_ATTEMPTS: "Слишком много попыток. Попробуйте позже.",
    NETWORK_ERROR: "Ошибка соединения. Проверьте интернет и попробуйте снова.",
    GENERIC: "Не удалось выполнить запрос. Попробуйте позже.",
  };

  function fromResponse(payload, fallback = "GENERIC") {
    if (!payload) return MESSAGES[fallback] || MESSAGES.GENERIC;
    if (payload.code && MESSAGES[payload.code]) return MESSAGES[payload.code];
    if (payload.message) return payload.message;
    return MESSAGES[fallback] || MESSAGES.GENERIC;
  }

  return { MESSAGES, fromResponse };
})();
