/**
 * Bookly — константы бронирований
 */
window.BooklyBookingsConstants = (() => {
  const STATUSES = [
    { value: "pending", label: "Ожидает", badge: "booking-badge--pending" },
    { value: "confirmed", label: "Подтверждена", badge: "booking-badge--confirmed" },
    { value: "completed", label: "Завершена", badge: "booking-badge--completed" },
    { value: "canceled", label: "Отменена", badge: "booking-badge--canceled" },
    { value: "no_show", label: "Не пришёл", badge: "booking-badge--no_show" },
  ];

  const SOURCES = [
    { value: "manual", label: "Вручную" },
    { value: "public_booking", label: "Онлайн-запись" },
  ];

  const ACTIVE_BLOCKING_STATUSES = ["pending", "confirmed"];
  const UPCOMING_STATUSES = ["pending", "confirmed"];
  const SLOT_STEP_MINUTES = 15;

  function getStatus(value) {
    return STATUSES.find((item) => item.value === value) || {
      value,
      label: value,
      badge: "booking-badge--muted",
    };
  }

  function getSourceLabel(value) {
    return SOURCES.find((item) => item.value === value)?.label || value;
  }

  return {
    STATUSES,
    SOURCES,
    ACTIVE_BLOCKING_STATUSES,
    UPCOMING_STATUSES,
    SLOT_STEP_MINUTES,
    getStatus,
    getSourceLabel,
  };
})();
