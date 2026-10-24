/**
 * Bookly — модальное окно рабочего графика
 */
window.BooklyScheduleUI = (() => {
  let organization = null;
  let currentStaff = null;
  let scheduleRows = [];

  const els = {};

  function cacheElements() {
    els.modal = document.getElementById("schedule-modal");
    els.title = document.getElementById("schedule-modal-title");
    els.subtitle = document.getElementById("schedule-modal-subtitle");
    els.form = document.getElementById("schedule-form");
    els.days = document.getElementById("schedule-days");
    els.error = document.getElementById("schedule-form-error");
    els.submit = document.getElementById("schedule-form-submit");
    els.timeOff = document.getElementById("schedule-time-off");
  }

  function init(org) {
    organization = org;
    cacheElements();
    if (!els.modal) return;

    els.form?.addEventListener("submit", handleSubmit);
    els.timeOff?.addEventListener("click", handleTimeOffClick);
    els.timeOff?.addEventListener("change", handleTimeOffKind);

    els.modal.addEventListener("click", (event) => {
      if (event.target === els.modal) close();
    });

    document.querySelectorAll("[data-close-schedule-modal]").forEach((btn) => {
      btn.addEventListener("click", close);
    });
  }

  async function open(staffMember) {
    if (!staffMember || !els.modal) return;

    currentStaff = staffMember;
    hideError();

    if (els.title) {
      els.title.textContent = "Рабочий график";
    }

    if (els.subtitle) {
      els.subtitle.textContent = staffMember.name;
    }

    els.modal.classList.add("is-open");
    els.modal.setAttribute("aria-hidden", "false");

    if (els.days) {
      els.days.innerHTML = '<p class="schedule-days__loading">Загрузка графика…</p>';
    }

    try {
      scheduleRows = await BooklySchedules.ensureDefaults(organization.id, staffMember.id);
      renderDays();
      loadTimeOff();
    } catch (error) {
      BooklyAuthErrors.logError("schedule:load", error);
      if (els.days) {
        els.days.innerHTML = `<p class="schedule-days__error">${escapeHtml(error.message || "Не удалось загрузить график.")}</p>`;
      }
    }
  }

  function close() {
    els.modal?.classList.remove("is-open");
    els.modal?.setAttribute("aria-hidden", "true");
    currentStaff = null;
    scheduleRows = [];
    hideError();
  }

  function renderDays() {
    if (!els.days) return;

    const byDay = new Map(scheduleRows.map((row) => [row.day_of_week, row]));

    els.days.innerHTML = BooklyScheduleConstants.DAYS.map((dayMeta) => {
      const row = byDay.get(dayMeta.day_of_week) || {
        day_of_week: dayMeta.day_of_week,
        is_working: false,
        start_time: null,
        end_time: null,
      };
      const isWorking = row.is_working === true;
      const startValue = BooklyScheduleValidation.formatTimeForInput(row.start_time);
      const endValue = BooklyScheduleValidation.formatTimeForInput(row.end_time);
      const breakStartValue = BooklyScheduleValidation.formatTimeForInput(row.break_start);
      const breakEndValue = BooklyScheduleValidation.formatTimeForInput(row.break_end);

      return `
        <div class="schedule-day" data-day="${dayMeta.day_of_week}">
          <div class="schedule-day__header">
            <p class="schedule-day__label">${dayMeta.label}</p>
            <label class="field field--checkbox schedule-day__toggle">
              <input type="checkbox" name="is_working" data-day="${dayMeta.day_of_week}" ${isWorking ? "checked" : ""}>
              <span>Рабочий день</span>
            </label>
          </div>
          <div class="schedule-day__times ${isWorking ? "" : "is-disabled"}">
            <label class="field schedule-day__time">
              <span class="field__label">Начало</span>
              <input class="field__input" type="time" name="start_time" data-day="${dayMeta.day_of_week}" value="${startValue}" ${isWorking ? "" : "disabled"}>
            </label>
            <span class="schedule-day__sep" aria-hidden="true">—</span>
            <label class="field schedule-day__time">
              <span class="field__label">Окончание</span>
              <input class="field__input" type="time" name="end_time" data-day="${dayMeta.day_of_week}" value="${endValue}" ${isWorking ? "" : "disabled"}>
            </label>
          </div>
          <div class="schedule-day__times schedule-day__break ${isWorking ? "" : "is-disabled"}">
            <label class="field schedule-day__time">
              <span class="field__label">Перерыв с</span>
              <input class="field__input" type="time" name="break_start" data-day="${dayMeta.day_of_week}" value="${breakStartValue}" ${isWorking ? "" : "disabled"}>
            </label>
            <span class="schedule-day__sep" aria-hidden="true">—</span>
            <label class="field schedule-day__time">
              <span class="field__label">до</span>
              <input class="field__input" type="time" name="break_end" data-day="${dayMeta.day_of_week}" value="${breakEndValue}" ${isWorking ? "" : "disabled"}>
            </label>
          </div>
          <p class="schedule-day__error field__error" data-day-error="${dayMeta.day_of_week}" hidden></p>
        </div>
      `;
    }).join("");

    els.days.querySelectorAll('input[name="is_working"]').forEach((input) => {
      input.addEventListener("change", handleWorkingToggle);
    });
  }

  function handleWorkingToggle(event) {
    const day = Number(event.currentTarget.dataset.day);
    const dayEl = els.days?.querySelector(`.schedule-day[data-day="${day}"]`);
    if (!dayEl) return;

    const isWorking = event.currentTarget.checked;
    dayEl.querySelectorAll(".schedule-day__times").forEach((el) => el.classList.toggle("is-disabled", !isWorking));
    dayEl.querySelectorAll('input[type="time"]').forEach((input) => {
      input.disabled = !isWorking;
    });

    clearDayError(day);
  }

  function collectDaysFromForm() {
    return BooklyScheduleConstants.DAYS.map((dayMeta) => {
      const dayEl = els.days?.querySelector(`.schedule-day[data-day="${dayMeta.day_of_week}"]`);
      const isWorkingInput = dayEl?.querySelector('input[name="is_working"]');
      const startInput = dayEl?.querySelector('input[name="start_time"]');
      const endInput = dayEl?.querySelector('input[name="end_time"]');
      const breakStartInput = dayEl?.querySelector('input[name="break_start"]');
      const breakEndInput = dayEl?.querySelector('input[name="break_end"]');
      const existing = scheduleRows.find((row) => row.day_of_week === dayMeta.day_of_week);

      return {
        id: existing?.id,
        day_of_week: dayMeta.day_of_week,
        is_working: Boolean(isWorkingInput?.checked),
        start_time: startInput?.value || null,
        end_time: endInput?.value || null,
        break_start: breakStartInput?.value || null,
        break_end: breakEndInput?.value || null,
      };
    });
  }

  function clearDayErrors() {
    els.days?.querySelectorAll("[data-day-error]").forEach((el) => {
      el.hidden = true;
      el.textContent = "";
    });
  }

  function clearDayError(day) {
    const el = els.days?.querySelector(`[data-day-error="${day}"]`);
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
  }

  function showDayError(day, message) {
    const el = els.days?.querySelector(`[data-day-error="${day}"]`);
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    hideError();
    clearDayErrors();

    if (!currentStaff) return;

    const days = collectDaysFromForm();
    const result = BooklyScheduleValidation.validateSchedule(days);

    if (!result.valid) {
      const message = result.errors.time || "Проверьте рабочие дни и время.";
      showError(message);

      result.data.forEach((day) => {
        const dayResult = BooklyScheduleValidation.validateDay(day);
        if (!dayResult.valid && dayResult.errors.time) {
          showDayError(day.day_of_week, dayResult.errors.time);
        }
      });
      return;
    }

    BooklyAuthUI.setButtonLoading(els.submit, true, "Сохранение…", "Сохранить");

    try {
      scheduleRows = await BooklySchedules.save(organization.id, currentStaff.id, result.data);
      close();
    } catch (error) {
      BooklyAuthErrors.logError("schedule:save", error);
      showError(BooklySubscription.mapDbError(error) || error.message || "Не удалось сохранить график.");
    } finally {
      BooklyAuthUI.setButtonLoading(els.submit, false, "Сохранение…", "Сохранить");
    }
  }

  // ---------------------------------------------------------------------------
  // Выходные, отпуска, другие часы и блоки времени (сохраняются сразу)
  // ---------------------------------------------------------------------------

  const TIME_OFF_KINDS = {
    off: "Выходной / отпуск",
    hours: "Другие часы",
    block: "Занято",
  };

  let timeOffRows = [];

  function todayString() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function formatDate(value) {
    const [y, m, d] = String(value).split("-");
    return `${d}.${m}.${y}`;
  }

  function describeTimeOff(row) {
    const time = (v) => BooklyScheduleValidation.formatTimeForInput(v);
    const dates = row.date_to && row.date_to !== row.date_from
      ? `${formatDate(row.date_from)} — ${formatDate(row.date_to)}`
      : formatDate(row.date_from);
    if (row.kind === "off") return dates;
    return `${dates}, ${time(row.start_time)}–${time(row.end_time)}`;
  }

  async function loadTimeOff() {
    if (!els.timeOff || !currentStaff) return;
    const staffId = currentStaff.id;
    try {
      const rows = await BooklySchedules.listTimeOff(organization.id, { staffId, from: todayString() });
      if (currentStaff?.id !== staffId) return;
      timeOffRows = rows;
      renderTimeOff();
    } catch (error) {
      BooklyAuthErrors.logError("schedule:time-off", error);
      els.timeOff.innerHTML = `<p class="schedule-days__error">Не удалось загрузить выходные и исключения.</p>`;
    }
  }

  function renderTimeOff(message = "") {
    if (!els.timeOff) return;
    const today = todayString();

    const list = timeOffRows.length
      ? `<ul class="time-off__list">${timeOffRows
          .map(
            (row) => `
          <li class="time-off__item time-off__item--${row.kind}">
            <span class="time-off__kind">${TIME_OFF_KINDS[row.kind] || row.kind}</span>
            <span class="time-off__when">${describeTimeOff(row)}</span>
            ${row.note ? `<span class="time-off__note">${escapeHtml(row.note)}</span>` : ""}
            <button class="time-off__remove" type="button" data-time-off-remove="${row.id}" aria-label="Удалить">×</button>
          </li>`
          )
          .join("")}</ul>`
      : `<p class="time-off__empty">Нет исключений — работает обычный график.</p>`;

    els.timeOff.innerHTML = `
      <div class="time-off__head">
        <p class="schedule-day__label">Выходные и исключения</p>
        <p class="time-off__hint">Отпуск, больничный, другие часы на конкретный день или «занято» на пару часов. Сохраняется сразу.</p>
      </div>
      ${list}
      <div class="time-off__form" data-kind="off">
        <label class="field">
          <span class="field__label">Что</span>
          <select class="field__input" name="time_off_kind">
            <option value="off">Выходной / отпуск</option>
            <option value="hours">Другие часы работы</option>
            <option value="block">Занято (блок времени)</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label" data-time-off-date-label>С</span>
          <input class="field__input" type="date" name="time_off_from" min="${today}" value="${today}">
        </label>
        <label class="field" data-time-off-only="off">
          <span class="field__label">По</span>
          <input class="field__input" type="date" name="time_off_to" min="${today}" value="${today}">
        </label>
        <label class="field" data-time-off-only="time">
          <span class="field__label">С</span>
          <input class="field__input" type="time" name="time_off_start" value="10:00">
        </label>
        <label class="field" data-time-off-only="time">
          <span class="field__label">До</span>
          <input class="field__input" type="time" name="time_off_end" value="12:00">
        </label>
        <label class="field time-off__note-field">
          <span class="field__label">Комментарий</span>
          <input class="field__input" type="text" name="time_off_note" maxlength="200" placeholder="Например: отпуск">
        </label>
        <button class="btn btn--ghost" type="button" data-time-off-add>Добавить</button>
      </div>
      <p class="field__error time-off__error" ${message ? "" : "hidden"}>${escapeHtml(message)}</p>
    `;
    syncTimeOffKind();
  }

  function syncTimeOffKind() {
    const form = els.timeOff?.querySelector(".time-off__form");
    if (!form) return;
    const kind = form.querySelector('[name="time_off_kind"]').value;
    form.dataset.kind = kind;
    form.querySelectorAll('[data-time-off-only="off"]').forEach((el) => {
      el.hidden = kind !== "off";
    });
    form.querySelectorAll('[data-time-off-only="time"]').forEach((el) => {
      el.hidden = kind === "off";
    });
    const dateLabel = form.querySelector("[data-time-off-date-label]");
    if (dateLabel) dateLabel.textContent = kind === "off" ? "С" : "Дата";
  }

  function handleTimeOffKind(event) {
    if (event.target.name === "time_off_kind") syncTimeOffKind();
    if (event.target.name === "time_off_from") {
      const to = els.timeOff.querySelector('[name="time_off_to"]');
      if (to && to.value < event.target.value) to.value = event.target.value;
    }
  }

  async function handleTimeOffClick(event) {
    const removeBtn = event.target.closest("[data-time-off-remove]");
    if (removeBtn) {
      const id = removeBtn.dataset.timeOffRemove;
      removeBtn.disabled = true;
      try {
        await BooklySchedules.removeTimeOff(id);
        timeOffRows = timeOffRows.filter((row) => row.id !== id);
        renderTimeOff();
        document.dispatchEvent(new CustomEvent("bookly:time-off-changed"));
      } catch (error) {
        BooklyAuthErrors.logError("schedule:time-off-remove", error);
        renderTimeOff("Не удалось удалить. Попробуйте ещё раз.");
      }
      return;
    }

    const addBtn = event.target.closest("[data-time-off-add]");
    if (!addBtn || !currentStaff) return;

    const form = els.timeOff.querySelector(".time-off__form");
    const value = (name) => form.querySelector(`[name="${name}"]`)?.value || "";
    const payload = {
      staff_id: currentStaff.id,
      kind: value("time_off_kind"),
      date_from: value("time_off_from"),
      date_to: value("time_off_to"),
      start_time: value("time_off_start"),
      end_time: value("time_off_end"),
      note: value("time_off_note"),
    };

    const error = validateTimeOff(payload);
    if (error) {
      showTimeOffError(error);
      return;
    }

    addBtn.disabled = true;
    try {
      const row = await BooklySchedules.addTimeOff(organization.id, payload);
      timeOffRows = [...timeOffRows, row].sort((a, b) =>
        `${a.date_from} ${a.start_time || ""}`.localeCompare(`${b.date_from} ${b.start_time || ""}`)
      );
      renderTimeOff();
      document.dispatchEvent(new CustomEvent("bookly:time-off-changed"));
    } catch (err) {
      BooklyAuthErrors.logError("schedule:time-off-add", err);
      addBtn.disabled = false;
      showTimeOffError(BooklySubscription.mapDbError(err) || "Не удалось сохранить. Попробуйте ещё раз.");
    }
  }

  function validateTimeOff(payload) {
    if (!payload.date_from) return "Укажите дату.";
    if (payload.kind === "off") {
      if (payload.date_to && payload.date_to < payload.date_from) return "Дата «по» не может быть раньше даты «с».";
      return "";
    }
    const start = BooklyScheduleValidation.timeToMinutes(payload.start_time);
    const end = BooklyScheduleValidation.timeToMinutes(payload.end_time);
    if (start === null || end === null) return "Укажите время «с» и «до».";
    if (end <= start) return "Время «до» должно быть позже «с».";
    return "";
  }

  function showTimeOffError(message) {
    const el = els.timeOff?.querySelector(".time-off__error");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  function showError(message) {
    if (!els.error) return;
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function hideError() {
    if (!els.error) return;
    els.error.textContent = "";
    els.error.hidden = true;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { init, open, close };
})();
