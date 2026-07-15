/**
 * Bookly — валидация рабочего графика
 */
window.BooklyScheduleValidation = (() => {
  function timeToMinutes(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return null;

    const match = normalized.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return hours * 60 + minutes;
  }

  function formatTimeForInput(value) {
    if (!value) return "";
    const match = String(value).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return "";
    return `${match[1].padStart(2, "0")}:${match[2]}`;
  }

  function validateDay(day) {
    const errors = {};
    const label = BooklyScheduleConstants.getDayLabel(day.day_of_week);
    const isWorking = day.is_working === true;

    if (!isWorking) {
      return { valid: true, errors, data: { ...day, start_time: null, end_time: null } };
    }

    const start = formatTimeForInput(day.start_time);
    const end = formatTimeForInput(day.end_time);

    if (!start || !end) {
      errors.time = `Укажите время начала и окончания для «${label}».`;
      return { valid: false, errors, data: day };
    }

    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);

    if (startMinutes === null || endMinutes === null) {
      errors.time = `Некорректное время для «${label}».`;
      return { valid: false, errors, data: day };
    }

    if (endMinutes <= startMinutes) {
      errors.time = `Время окончания должно быть позже начала («${label}»).`;
      return { valid: false, errors, data: day };
    }

    return {
      valid: true,
      errors,
      data: {
        ...day,
        start_time: start,
        end_time: end,
      },
    };
  }

  function validateSchedule(days) {
    const errors = {};
    const normalized = [];

    for (const day of days) {
      const result = validateDay(day);
      if (!result.valid) {
        Object.assign(errors, result.errors);
      }
      normalized.push(result.data);
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      data: normalized,
    };
  }

  return {
    validateSchedule,
    validateDay,
    formatTimeForInput,
    timeToMinutes,
  };
})();
