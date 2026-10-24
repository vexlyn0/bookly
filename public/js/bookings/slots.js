/**
 * Bookly — расчёт свободных слотов
 */
window.BooklyBookingsSlots = (() => {
  const STEP = BooklyBookingsConstants.SLOT_STEP_MINUTES;

  function formatDateLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function timeToMinutes(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function formatTimeForInput(value) {
    return minutesToTime(timeToMinutes(value) ?? 0).slice(0, 5);
  }

  function getScheduleDayIndex(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const jsDow = date.getDay();
    return (jsDow + 6) % 7;
  }

  function isPastSlot(dateStr, startMinutes) {
    const today = formatDateLocal(new Date());
    if (dateStr !== today) return dateStr < today;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return startMinutes <= nowMinutes;
  }

  function overlaps(startA, endA, startB, endB) {
    return startA < endB && endA > startB;
  }

  function findScheduleForDate(schedules, dateStr) {
    const dayIndex = getScheduleDayIndex(dateStr);
    return (schedules || []).find((row) => row.day_of_week === dayIndex) || null;
  }

  /**
   * Рабочий день с учётом исключений (то же, что resolveDay на сервере).
   * @returns {{ schedule: object|null, blocked: {start:number,end:number,label:string}[], off: string|null }}
   */
  function resolveDay(schedule, dateStr, timeOff = []) {
    const entries = (timeOff || []).filter((t) => dateStr >= t.date_from && dateStr <= t.date_to);

    const off = entries.find((t) => t.kind === "off");
    if (off) return { schedule: null, blocked: [], off: off.note || "Выходной" };

    const hours = entries
      .filter((t) => t.kind === "hours")
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];

    const blocked = [];
    let effective = schedule && schedule.is_working === true ? schedule : null;

    if (hours) {
      effective = { is_working: true, start_time: hours.start_time, end_time: hours.end_time };
    } else if (effective && effective.break_start && effective.break_end) {
      blocked.push({
        start: timeToMinutes(effective.break_start),
        end: timeToMinutes(effective.break_end),
        label: "Перерыв",
      });
    }

    for (const block of entries.filter((t) => t.kind === "block")) {
      blocked.push({
        start: timeToMinutes(block.start_time),
        end: timeToMinutes(block.end_time),
        label: block.note || "Занято",
      });
    }

    return { schedule: effective, blocked: blocked.filter((b) => b.start !== null && b.end !== null), off: null };
  }

  function computeSlots({ schedule: weeklySchedule, durationMinutes, bookings, excludeBookingId, dateStr, timeOff = [] }) {
    const day = resolveDay(weeklySchedule, dateStr, timeOff);
    const schedule = day.schedule;
    if (!schedule || schedule.is_working !== true) return [];

    const workStart = timeToMinutes(schedule.start_time);
    const workEnd = timeToMinutes(schedule.end_time);
    const duration = Number(durationMinutes) || 0;

    if (workStart === null || workEnd === null || duration < 1) return [];

    const busy = (bookings || [])
      .filter(
        (item) =>
          BooklyBookingsConstants.ACTIVE_BLOCKING_STATUSES.includes(item.status) &&
          item.id !== excludeBookingId
      )
      .map((item) => ({
        start: timeToMinutes(item.start_time),
        end: timeToMinutes(item.end_time),
      }))
      .filter((item) => item.start !== null && item.end !== null)
      .concat(day.blocked);

    const slots = [];

    for (let start = workStart; start + duration <= workEnd; start += STEP) {
      const end = start + duration;

      if (isPastSlot(dateStr, start)) continue;

      const hasConflict = busy.some((item) => overlaps(start, end, item.start, item.end));
      if (hasConflict) continue;

      slots.push({
        start_time: minutesToTime(start),
        end_time: minutesToTime(end),
        label: `${minutesToTime(start)} – ${minutesToTime(end)}`,
      });
    }

    return slots;
  }

  return {
    formatDateLocal,
    timeToMinutes,
    minutesToTime,
    formatTimeForInput,
    getScheduleDayIndex,
    findScheduleForDate,
    computeSlots,
    resolveDay,
    isPastSlot,
  };
})();
