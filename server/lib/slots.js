/**
 * Расчёт свободных слотов (серверная копия логики public/js/bookings/slots.js)
 */

const SLOT_STEP_MINUTES = 15;
const ACTIVE_BLOCKING_STATUSES = ["pending", "confirmed"];
const MAX_BOOKING_DAYS_AHEAD = 60;

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
  const date = new Date(Date.UTC(y, m - 1, d));
  const jsDow = date.getUTCDay();
  return (jsDow + 6) % 7;
}

function formatDateInTimezone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function getMinutesInTimezone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function isPastSlot(dateStr, startMinutes, timeZone) {
  const now = new Date();
  const today = formatDateInTimezone(now, timeZone);
  if (dateStr !== today) return dateStr < today;
  return startMinutes <= getMinutesInTimezone(now, timeZone);
}

function isDateTooFarAhead(dateStr, timeZone) {
  const now = new Date();
  const maxDate = new Date(now.getTime());
  maxDate.setUTCDate(maxDate.getUTCDate() + MAX_BOOKING_DAYS_AHEAD);
  const maxDateStr = formatDateInTimezone(maxDate, timeZone);
  return dateStr > maxDateStr;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function findScheduleForDate(schedules, dateStr) {
  const dayIndex = getScheduleDayIndex(dateStr);
  return (schedules || []).find((row) => row.day_of_week === dayIndex) || null;
}

function computeSlots({
  schedule,
  durationMinutes,
  bookings,
  excludeBookingId,
  dateStr,
  timeZone,
}) {
  if (!schedule || schedule.is_working !== true) return [];

  const workStart = timeToMinutes(schedule.start_time);
  const workEnd = timeToMinutes(schedule.end_time);
  const duration = Number(durationMinutes) || 0;

  if (workStart === null || workEnd === null || duration < 1) return [];

  const busy = (bookings || [])
    .filter(
      (item) =>
        ACTIVE_BLOCKING_STATUSES.includes(item.status) &&
        item.id !== excludeBookingId
    )
    .map((item) => ({
      start: timeToMinutes(item.start_time),
      end: timeToMinutes(item.end_time),
    }))
    .filter((item) => item.start !== null && item.end !== null);

  const slots = [];

  for (let start = workStart; start + duration <= workEnd; start += SLOT_STEP_MINUTES) {
    const end = start + duration;
    if (isPastSlot(dateStr, start, timeZone)) continue;
    const hasConflict = busy.some((item) => overlaps(start, end, item.start, item.end));
    if (hasConflict) continue;

    slots.push({
      start_time: minutesToTime(start),
      end_time: minutesToTime(end),
    });
  }

  return slots;
}

module.exports = {
  SLOT_STEP_MINUTES,
  MAX_BOOKING_DAYS_AHEAD,
  timeToMinutes,
  minutesToTime,
  formatTimeForInput,
  getScheduleDayIndex,
  findScheduleForDate,
  computeSlots,
  isPastSlot,
  isDateTooFarAhead,
  formatDateInTimezone,
  getMinutesInTimezone,
};
