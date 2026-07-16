/**
 * Bookly — сообщения об ошибках бронирований
 */
window.BooklyBookingsErrors = (() => {
  const CODE_MESSAGES = {
    BOOKING_TIME_CONFLICT: "Это время уже занято. Выберите другой слот.",
    BOOKING_IN_PAST: "Нельзя создать запись на прошедшее время.",
    BOOKING_STAFF_SERVICE_MISMATCH: "Сотрудник не оказывает выбранную услугу.",
    BOOKING_STAFF_DAY_OFF: "Сотрудник не работает в выбранный день.",
    BOOKING_OUTSIDE_SCHEDULE: "Запись выходит за пределы рабочего графика сотрудника.",
    BOOKING_ORG_MISMATCH: "Услуга и сотрудник должны принадлежать вашей компании.",
    BOOKING_SERVICE_NOT_FOUND: "Услуга не найдена.",
    BOOKING_STAFF_NOT_FOUND: "Сотрудник не найден.",
    BOOKING_SERVICE_INACTIVE: "Нельзя создать запись с неактивной услугой.",
    BOOKING_STAFF_INACTIVE: "Нельзя создать запись с неактивным сотрудником.",
    BOOKING_RESCHEDULE_SERVICE_INACTIVE: "Нельзя перенести запись: услуга неактивна.",
    BOOKING_RESCHEDULE_STAFF_INACTIVE: "Нельзя перенести запись: сотрудник неактивен.",
    BOOKING_INVALID_DURATION: "Некорректная длительность услуги.",
    SUBSCRIPTION_REQUIRED:
      "Подписка закончилась. Продлите доступ в разделе «Тариф и оплата», чтобы продолжить работу.",
    ORGANIZATION_SUSPENDED: "Организация приостановлена. Обратитесь в поддержку.",
  };

  const EXCLUDE_PATTERNS = [
    "bookings_no_active_overlap",
    "exclusion constraint",
    "conflicting key value violates exclusion constraint",
    "23P01",
  ];

  const FALLBACK = "Не удалось сохранить запись. Проверьте данные и попробуйте снова.";
  const NETWORK = "Ошибка соединения с сервером. Проверьте интернет и попробуйте снова.";

  function fromError(error, { isReschedule = false } = {}) {
    if (!error) return FALLBACK;

    const message = String(error.message || "");

    if (isReschedule && message.includes("BOOKING_STAFF_INACTIVE")) {
      return CODE_MESSAGES.BOOKING_RESCHEDULE_STAFF_INACTIVE;
    }

    if (isReschedule && message.includes("BOOKING_SERVICE_INACTIVE")) {
      return CODE_MESSAGES.BOOKING_RESCHEDULE_SERVICE_INACTIVE;
    }

    for (const [code, text] of Object.entries(CODE_MESSAGES)) {
      if (message.includes(code)) return text;
    }

    if (EXCLUDE_PATTERNS.some((pattern) => message.toLowerCase().includes(pattern.toLowerCase()))) {
      return CODE_MESSAGES.BOOKING_TIME_CONFLICT;
    }

    if (
      message.includes("client_name") ||
      message.includes("check constraint") && message.includes("client_name")
    ) {
      return "Имя клиента должно содержать минимум 2 символа.";
    }

    if (message.includes("client_phone")) {
      return "Телефон клиента должен содержать минимум 5 символов.";
    }

    if (message.includes("status")) {
      return "Указан недопустимый статус записи.";
    }

    if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
      return NETWORK;
    }

    if (error.code === "PGRST301" || message.includes("JWT")) {
      return "Сессия истекла. Обновите страницу и войдите снова.";
    }

    if (message.includes("PGRST205")) {
      return "Модуль записей ещё не настроен. Выполните миграцию базы данных.";
    }

    return FALLBACK;
  }

  function logError(context, error) {
    console.error(`[bookings:${context}]`, error?.message || error);
  }

  return { fromError, logError, CODE_MESSAGES };
})();
