/**
 * Bookly — константы рабочего графика
 * day_of_week: 0 = понедельник … 6 = воскресенье
 */
window.BooklyScheduleConstants = (() => {
  const DAYS = [
    { day_of_week: 0, label: "Понедельник" },
    { day_of_week: 1, label: "Вторник" },
    { day_of_week: 2, label: "Среда" },
    { day_of_week: 3, label: "Четверг" },
    { day_of_week: 4, label: "Пятница" },
    { day_of_week: 5, label: "Суббота" },
    { day_of_week: 6, label: "Воскресенье" },
  ];

  const DEFAULT_SCHEDULE = [
    { day_of_week: 0, is_working: true, start_time: "09:00", end_time: "18:00" },
    { day_of_week: 1, is_working: true, start_time: "09:00", end_time: "18:00" },
    { day_of_week: 2, is_working: true, start_time: "09:00", end_time: "18:00" },
    { day_of_week: 3, is_working: true, start_time: "09:00", end_time: "18:00" },
    { day_of_week: 4, is_working: true, start_time: "09:00", end_time: "18:00" },
    { day_of_week: 5, is_working: true, start_time: "10:00", end_time: "15:00" },
    { day_of_week: 6, is_working: false, start_time: null, end_time: null },
  ];

  function getDayLabel(dayOfWeek) {
    return DAYS.find((day) => day.day_of_week === dayOfWeek)?.label || "День";
  }

  return { DAYS, DEFAULT_SCHEDULE, getDayLabel };
})();
