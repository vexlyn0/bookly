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
  }

  function init(org) {
    organization = org;
    cacheElements();
    if (!els.modal) return;

    els.form?.addEventListener("submit", handleSubmit);

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
    const timesEl = dayEl.querySelector(".schedule-day__times");
    const startInput = dayEl.querySelector('input[name="start_time"]');
    const endInput = dayEl.querySelector('input[name="end_time"]');

    timesEl?.classList.toggle("is-disabled", !isWorking);

    if (startInput) startInput.disabled = !isWorking;
    if (endInput) endInput.disabled = !isWorking;

    clearDayError(day);
  }

  function collectDaysFromForm() {
    return BooklyScheduleConstants.DAYS.map((dayMeta) => {
      const dayEl = els.days?.querySelector(`.schedule-day[data-day="${dayMeta.day_of_week}"]`);
      const isWorkingInput = dayEl?.querySelector('input[name="is_working"]');
      const startInput = dayEl?.querySelector('input[name="start_time"]');
      const endInput = dayEl?.querySelector('input[name="end_time"]');
      const existing = scheduleRows.find((row) => row.day_of_week === dayMeta.day_of_week);

      return {
        id: existing?.id,
        day_of_week: dayMeta.day_of_week,
        is_working: Boolean(isWorkingInput?.checked),
        start_time: startInput?.value || null,
        end_time: endInput?.value || null,
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
