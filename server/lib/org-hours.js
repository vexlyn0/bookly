/**
 * Jazyl — часы работы салона для страницы записи.
 *
 * Отдельно владелец часы не вводит: салон открыт, когда работает хотя бы один
 * активный мастер (по графику, с учётом выходных, отпусков и «других часов»).
 */

const { resolveDay } = require("./slots");

function pad(n) {
  return String(n).padStart(2, "0");
}

function toTime(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function toMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 = понедельник … 6 = воскресенье (как staff_schedules.day_of_week). */
function dayIndex(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Интервал [начало, конец] в минутах за день: самый ранний старт и самый поздний конец мастеров. */
function span(intervals) {
  if (!intervals.length) return null;
  return {
    start: Math.min(...intervals.map((i) => i.start)),
    end: Math.max(...intervals.map((i) => i.end)),
  };
}

function dayIntervals({ staffIds, schedules, timeOff, date }) {
  const dow = dayIndex(date);
  const intervals = [];
  for (const staffId of staffIds) {
    const weekly = schedules.find((row) => row.staff_id === staffId && row.day_of_week === dow) || null;
    const day = resolveDay(weekly, date, timeOff.filter((row) => row.staff_id === staffId));
    const start = toMinutes(day.schedule?.start_time);
    const end = toMinutes(day.schedule?.end_time);
    if (start !== null && end !== null && end > start) intervals.push({ start, end });
  }
  return intervals;
}

/**
 * @param {object} p
 * @param {string[]} p.staffIds   — активные мастера
 * @param {object[]} p.schedules  — staff_schedules
 * @param {object[]} p.timeOff    — staff_time_off на ближайшие 7 дней
 * @param {string}   p.today      — YYYY-MM-DD в часовом поясе салона
 * @param {number}   p.nowMinutes — минуты от полуночи в часовом поясе салона
 * @returns {{ hours: ({open:string, close:string}|null)[], status: object }}
 *   hours  — обычная неделя (пн…вс) по графикам, без исключений;
 *   status — { open_now, closes_at } | { open_now:false, opens_at, opens_date }
 */
function computeOrgHours({ staffIds, schedules, timeOff, today, nowMinutes }) {
  const hours = Array.from({ length: 7 }, (_, dow) => {
    const intervals = staffIds
      .map((id) => schedules.find((row) => row.staff_id === id && row.day_of_week === dow))
      .filter((row) => row && row.is_working === true)
      .map((row) => ({ start: toMinutes(row.start_time), end: toMinutes(row.end_time) }))
      .filter((i) => i.start !== null && i.end !== null && i.end > i.start);
    const s = span(intervals);
    return s ? { open: toTime(s.start), close: toTime(s.end) } : null;
  });

  const todayIntervals = dayIntervals({ staffIds, schedules, timeOff, date: today });
  const openNow = todayIntervals.filter((i) => i.start <= nowMinutes && nowMinutes < i.end);
  if (openNow.length) {
    // Закрывается, когда уходит последний мастер (с учётом тех, кто придёт позже).
    const closes = Math.max(...todayIntervals.filter((i) => i.end > nowMinutes).map((i) => i.end));
    return { hours, status: { open_now: true, closes_at: toTime(closes) } };
  }

  const laterToday = todayIntervals.filter((i) => i.start > nowMinutes);
  if (laterToday.length) {
    return {
      hours,
      status: { open_now: false, opens_at: toTime(Math.min(...laterToday.map((i) => i.start))), opens_date: today },
    };
  }

  for (let offset = 1; offset <= 7; offset += 1) {
    const date = addDays(today, offset);
    const s = span(dayIntervals({ staffIds, schedules, timeOff, date }));
    if (s) return { hours, status: { open_now: false, opens_at: toTime(s.start), opens_date: date } };
  }

  return { hours, status: { open_now: false } };
}

module.exports = { computeOrgHours, dayIndex };
