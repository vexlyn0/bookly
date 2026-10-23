/**
 * Bookly — раздел «Календарь»
 *
 * День: колонки по активным мастерам. Неделя: 7 дней выбранного мастера.
 * Клик по свободному времени — новая запись (мастер, дата и время подставляются),
 * клик по записи — редактирование. Нерабочее время и выходные затенены.
 */
window.BooklyCalendarUI = (() => {
  const PX_PER_MINUTE = 1.2;
  const SNAP_MINUTES = 15;
  const DEFAULT_RANGE = { start: 9 * 60, end: 19 * 60 };
  const HIDDEN_STATUSES = ["canceled"];

  const WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  const MONTHS_GENITIVE = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  const WEEKDAYS_FULL = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

  let organization = null;
  let view = "day";
  let currentDate = todayStr();
  let weekStaffId = "";
  let staff = [];
  let schedules = [];
  let bookings = [];
  let loaded = false;
  let loadToken = 0;
  let nowTimer = null;

  const els = {};

  // ---------------------------------------------------------------------------
  // Даты и время
  // ---------------------------------------------------------------------------

  function todayStr() {
    return BooklyBookingsSlots.formatDateLocal(new Date());
  }

  function parseDate(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(dateStr, days) {
    const date = parseDate(dateStr);
    date.setDate(date.getDate() + days);
    return BooklyBookingsSlots.formatDateLocal(date);
  }

  function weekdayIndex(dateStr) {
    return (parseDate(dateStr).getDay() + 6) % 7;
  }

  function weekStart(dateStr) {
    return addDays(dateStr, -weekdayIndex(dateStr));
  }

  function toMinutes(value) {
    return BooklyBookingsSlots.timeToMinutes(value);
  }

  function toTime(minutes) {
    return BooklyBookingsSlots.minutesToTime(minutes);
  }

  function formatDayTitle(dateStr) {
    const date = parseDate(dateStr);
    return `${WEEKDAYS_FULL[weekdayIndex(dateStr)]}, ${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`;
  }

  function formatWeekTitle(fromStr) {
    const from = parseDate(fromStr);
    const to = parseDate(addDays(fromStr, 6));
    const sameMonth = from.getMonth() === to.getMonth();
    return sameMonth
      ? `${from.getDate()} – ${to.getDate()} ${MONTHS_GENITIVE[to.getMonth()]} ${to.getFullYear()}`
      : `${from.getDate()} ${MONTHS_GENITIVE[from.getMonth()]} – ${to.getDate()} ${MONTHS_GENITIVE[to.getMonth()]} ${to.getFullYear()}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------------------
  // Инициализация
  // ---------------------------------------------------------------------------

  function cacheElements() {
    els.section = document.getElementById("calendar-section");
    els.grid = document.getElementById("cal-grid");
    els.title = document.getElementById("cal-title");
    els.date = document.getElementById("cal-date");
    els.prev = document.getElementById("cal-prev");
    els.next = document.getElementById("cal-next");
    els.today = document.getElementById("cal-today");
    els.add = document.getElementById("cal-add");
    els.staffSelect = document.getElementById("cal-staff");
    els.empty = document.getElementById("cal-empty");
    els.viewButtons = document.querySelectorAll("[data-cal-view]");
  }

  function init(org) {
    organization = org;
    cacheElements();
    if (!els.section) return;

    els.prev?.addEventListener("click", () => shift(-1));
    els.next?.addEventListener("click", () => shift(1));
    els.today?.addEventListener("click", () => setDate(todayStr()));
    els.date?.addEventListener("change", () => {
      if (els.date.value) setDate(els.date.value);
    });
    els.add?.addEventListener("click", () => {
      BooklyBookingsUI.openCreate({
        staffId: view === "week" ? weekStaffId : "",
        date: currentDate,
      });
    });
    els.staffSelect?.addEventListener("change", () => {
      weekStaffId = els.staffSelect.value;
      render();
    });
    els.viewButtons.forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.calView));
    });

    els.grid?.addEventListener("click", handleGridClick);
    els.grid?.addEventListener("mousemove", handleGridHover);
    els.grid?.addEventListener("mouseleave", hideGhost);

    document.addEventListener("bookly:bookings-changed", () => {
      if (loaded) loadBookings();
    });

    // Загружаем при первом открытии раздела и обновляем при каждом возврате.
    document
      .querySelector('.sidebar__link[data-section="calendar"]')
      ?.addEventListener("click", () => load());

    window.addEventListener("focus", () => {
      if (isVisible()) loadBookings();
    });
  }

  function isVisible() {
    return Boolean(els.section && !els.section.hidden);
  }

  function setView(nextView) {
    if (nextView !== "day" && nextView !== "week") return;
    view = nextView;
    els.viewButtons.forEach((button) => {
      const active = button.dataset.calView === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    loadBookings();
  }

  function setDate(dateStr) {
    currentDate = dateStr;
    loadBookings();
  }

  function shift(direction) {
    setDate(addDays(currentDate, direction * (view === "week" ? 7 : 1)));
  }

  function getRange() {
    if (view === "week") {
      const from = weekStart(currentDate);
      return { from, to: addDays(from, 6) };
    }
    return { from: currentDate, to: currentDate };
  }

  // ---------------------------------------------------------------------------
  // Данные
  // ---------------------------------------------------------------------------

  async function load() {
    try {
      const [staffList, scheduleRows] = await Promise.all([
        BooklyStaff.list(organization.id),
        BooklySchedules.listForOrganization(organization.id),
      ]);
      staff = staffList
        .filter((member) => member.is_active)
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
      schedules = scheduleRows;

      if (!staff.some((member) => member.id === weekStaffId)) {
        weekStaffId = staff[0]?.id || "";
      }
      populateStaffSelect();
      loaded = true;
      await loadBookings();
    } catch (error) {
      BooklyBookingsErrors.logError("calendar:load", error);
      showEmpty(BooklyBookingsErrors.fromError(error));
    }
  }

  async function loadBookings() {
    if (!loaded) return load();

    const token = ++loadToken;
    const { from, to } = getRange();
    renderToolbar();

    try {
      const rows = await BooklyBookings.listRange(organization.id, from, to);
      if (token !== loadToken) return;
      bookings = rows.filter((item) => !HIDDEN_STATUSES.includes(item.status));
      render();
    } catch (error) {
      BooklyBookingsErrors.logError("calendar:bookings", error);
      showEmpty(BooklyBookingsErrors.fromError(error));
    }
  }

  function populateStaffSelect() {
    if (!els.staffSelect) return;
    els.staffSelect.innerHTML = staff
      .map((member) => `<option value="${member.id}">${escapeHtml(member.name)}</option>`)
      .join("");
    els.staffSelect.value = weekStaffId;
  }

  function schedulesFor(staffId) {
    return schedules.filter((row) => row.staff_id === staffId);
  }

  // ---------------------------------------------------------------------------
  // Отрисовка
  // ---------------------------------------------------------------------------

  function renderToolbar() {
    const { from } = getRange();
    if (els.title) {
      els.title.textContent = view === "week" ? formatWeekTitle(from) : formatDayTitle(currentDate);
    }
    if (els.date) els.date.value = currentDate;
    if (els.staffSelect) els.staffSelect.hidden = view !== "week" || staff.length < 1;
    if (els.today) els.today.disabled = currentDate === todayStr();
  }

  function buildColumns() {
    if (view === "week") {
      const member = staff.find((item) => item.id === weekStaffId);
      if (!member) return [];
      const from = weekStart(currentDate);
      return Array.from({ length: 7 }, (_, index) => {
        const date = addDays(from, index);
        const day = parseDate(date);
        return {
          staffId: member.id,
          date,
          title: `${WEEKDAYS_SHORT[index]}, ${day.getDate()}`,
          subtitle: MONTHS_GENITIVE[day.getMonth()],
          isToday: date === todayStr(),
          schedule: BooklyBookingsSlots.findScheduleForDate(schedulesFor(member.id), date),
        };
      });
    }

    return staff.map((member) => ({
      staffId: member.id,
      date: currentDate,
      title: member.name,
      subtitle: member.position || "",
      isToday: currentDate === todayStr(),
      schedule: BooklyBookingsSlots.findScheduleForDate(schedulesFor(member.id), currentDate),
    }));
  }

  function computeTimeRange(columns, columnBookings) {
    let start = Infinity;
    let end = -Infinity;

    columns.forEach((column, index) => {
      if (column.schedule?.is_working) {
        start = Math.min(start, toMinutes(column.schedule.start_time));
        end = Math.max(end, toMinutes(column.schedule.end_time));
      }
      columnBookings[index].forEach((item) => {
        start = Math.min(start, toMinutes(item.start_time));
        end = Math.max(end, toMinutes(item.end_time));
      });
    });

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { ...DEFAULT_RANGE };
    }
    return {
      start: Math.max(0, Math.floor(start / 60) * 60),
      end: Math.min(24 * 60, Math.ceil(end / 60) * 60),
    };
  }

  /** Раскладка пересекающихся записей по дорожкам внутри колонки. */
  function layoutEvents(items) {
    const sorted = [...items].sort(
      (a, b) => toMinutes(a.start_time) - toMinutes(b.start_time) || toMinutes(b.end_time) - toMinutes(a.end_time)
    );
    const result = [];
    let group = [];
    let groupEnd = -1;

    const flush = () => {
      const lanes = [];
      group.forEach((item) => {
        const start = toMinutes(item.start_time);
        let lane = lanes.findIndex((laneEnd) => laneEnd <= start);
        if (lane === -1) {
          lane = lanes.length;
          lanes.push(0);
        }
        lanes[lane] = toMinutes(item.end_time);
        result.push({ item, lane });
      });
      result
        .slice(result.length - group.length)
        .forEach((entry) => (entry.lanes = lanes.length));
      group = [];
      groupEnd = -1;
    };

    sorted.forEach((item) => {
      const start = toMinutes(item.start_time);
      if (group.length && start >= groupEnd) flush();
      group.push(item);
      groupEnd = Math.max(groupEnd, toMinutes(item.end_time));
    });
    if (group.length) flush();

    return result;
  }

  function render() {
    renderToolbar();
    if (!els.grid) return;

    if (!staff.length) {
      showEmpty("Добавьте мастеров в разделе «Сотрудники» — и здесь появится их расписание.");
      return;
    }

    const columns = buildColumns();
    const columnBookings = columns.map((column) =>
      bookings.filter((item) => item.staff_id === column.staffId && item.booking_date === column.date)
    );
    const range = computeTimeRange(columns, columnBookings);
    const height = (range.end - range.start) * PX_PER_MINUTE;

    hideEmpty();

    const hours = [];
    for (let minute = range.start; minute < range.end; minute += 60) {
      hours.push(minute);
    }

    const head = columns
      .map(
        (column) => `
          <div class="cal__colhead${column.isToday ? " is-today" : ""}">
            <span class="cal__colhead-title">${escapeHtml(column.title)}</span>
            ${column.subtitle ? `<span class="cal__colhead-sub">${escapeHtml(column.subtitle)}</span>` : ""}
          </div>`
      )
      .join("");

    const times = hours
      .map(
        (minute) =>
          `<span class="cal__time" style="top:${(minute - range.start) * PX_PER_MINUTE}px">${toTime(minute)}</span>`
      )
      .join("");

    const body = columns
      .map((column, index) => renderColumn(column, columnBookings[index], range, height))
      .join("");

    els.grid.innerHTML = `
      <div class="cal" style="--cal-cols:${columns.length}; --cal-hour:${60 * PX_PER_MINUTE}px">
        <div class="cal__corner"></div>
        ${head}
        <div class="cal__times" style="height:${height}px">${times}</div>
        ${body}
      </div>`;

    scheduleNowLine(range);
  }

  function renderColumn(column, items, range, height) {
    const offZones = [];
    const schedule = column.schedule;
    let dayOff = false;

    if (!schedule || schedule.is_working !== true) {
      dayOff = true;
      offZones.push([range.start, range.end]);
    } else {
      const workStart = toMinutes(schedule.start_time);
      const workEnd = toMinutes(schedule.end_time);
      if (workStart > range.start) offZones.push([range.start, workStart]);
      if (workEnd < range.end) offZones.push([workEnd, range.end]);
    }

    const zones = offZones
      .map(
        ([from, to]) =>
          `<div class="cal__off" style="top:${(from - range.start) * PX_PER_MINUTE}px;height:${(to - from) * PX_PER_MINUTE}px"></div>`
      )
      .join("");

    const events = layoutEvents(items)
      .map(({ item, lane, lanes }) => {
        const start = toMinutes(item.start_time);
        const end = toMinutes(item.end_time);
        const top = (start - range.start) * PX_PER_MINUTE;
        const eventHeight = Math.max((end - start) * PX_PER_MINUTE, 22);
        const width = 100 / lanes;
        const status = BooklyBookingsConstants.getStatus(item.status);
        const compact = eventHeight < 44;
        return `
          <button type="button" class="cal-event cal-event--${item.status}${compact ? " cal-event--compact" : ""}"
            data-booking-id="${item.id}"
            style="top:${top}px;height:${eventHeight}px;left:calc(${lane * width}% + 2px);width:calc(${width}% - 4px)"
            title="${escapeHtml(`${toTime(start)}–${toTime(end)} · ${item.client_name} · ${item.services?.name || ""} · ${status.label}`)}">
            <span class="cal-event__time">${toTime(start)}–${toTime(end)}</span>
            <span class="cal-event__client">${escapeHtml(item.client_name)}</span>
            ${compact ? "" : `<span class="cal-event__service">${escapeHtml(item.services?.name || "")}</span>`}
          </button>`;
      })
      .join("");

    return `
      <div class="cal__col${column.isToday ? " is-today" : ""}${dayOff ? " is-off" : ""}"
        data-staff-id="${column.staffId}" data-date="${column.date}"
        data-range-start="${range.start}" style="height:${height}px">
        ${zones}
        ${dayOff ? '<span class="cal__off-label">Выходной</span>' : ""}
        ${events}
        <div class="cal__ghost" hidden></div>
      </div>`;
  }

  function scheduleNowLine(range) {
    clearInterval(nowTimer);
    const draw = () => {
      els.grid?.querySelectorAll(".cal__now").forEach((line) => line.remove());
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      if (minutes < range.start || minutes > range.end) return;
      els.grid
        ?.querySelectorAll(`.cal__col[data-date="${todayStr()}"]`)
        .forEach((col) => {
          const line = document.createElement("div");
          line.className = "cal__now";
          line.style.top = `${(minutes - range.start) * PX_PER_MINUTE}px`;
          col.appendChild(line);
        });
    };
    draw();
    nowTimer = setInterval(draw, 60 * 1000);
  }

  function showEmpty(message) {
    if (els.grid) els.grid.innerHTML = "";
    if (els.empty) {
      els.empty.hidden = false;
      els.empty.textContent = message;
    }
  }

  function hideEmpty() {
    if (els.empty) els.empty.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Взаимодействие
  // ---------------------------------------------------------------------------

  /** Минуты от начала суток для точки внутри колонки (с привязкой к сетке 15 мин). */
  function minutesAtPoint(column, clientY) {
    const rect = column.getBoundingClientRect();
    const rangeStart = Number(column.dataset.rangeStart) || 0;
    const raw = rangeStart + (clientY - rect.top) / PX_PER_MINUTE;
    return Math.floor(raw / SNAP_MINUTES) * SNAP_MINUTES;
  }

  function isWorkingAt(column, minutes) {
    if (column.classList.contains("is-off")) return false;
    const date = column.dataset.date;
    const schedule = BooklyBookingsSlots.findScheduleForDate(schedulesFor(column.dataset.staffId), date);
    if (!schedule || schedule.is_working !== true) return false;
    return minutes >= toMinutes(schedule.start_time) && minutes < toMinutes(schedule.end_time);
  }

  function handleGridClick(event) {
    const eventButton = event.target.closest(".cal-event");
    if (eventButton) {
      BooklyBookingsUI.openEdit(eventButton.dataset.bookingId);
      return;
    }

    const column = event.target.closest(".cal__col");
    if (!column) return;

    const minutes = minutesAtPoint(column, event.clientY);
    if (!isWorkingAt(column, minutes)) return;

    BooklyBookingsUI.openCreate({
      staffId: column.dataset.staffId,
      date: column.dataset.date,
      startTime: toTime(minutes),
    });
  }

  function handleGridHover(event) {
    hideGhost();
    const column = event.target.closest(".cal__col");
    if (!column || event.target.closest(".cal-event")) return;

    const minutes = minutesAtPoint(column, event.clientY);
    if (!isWorkingAt(column, minutes)) return;

    const ghost = column.querySelector(".cal__ghost");
    if (!ghost) return;
    const rangeStart = Number(column.dataset.rangeStart) || 0;
    ghost.hidden = false;
    ghost.style.top = `${(minutes - rangeStart) * PX_PER_MINUTE}px`;
    ghost.style.height = `${SNAP_MINUTES * 2 * PX_PER_MINUTE}px`;
    ghost.textContent = `+ ${toTime(minutes)}`;
  }

  function hideGhost() {
    els.grid?.querySelectorAll(".cal__ghost").forEach((ghost) => {
      ghost.hidden = true;
    });
  }

  return { init, refresh: () => loadBookings() };
})();
