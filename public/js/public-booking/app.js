window.PublicBookingApp = (() => {
  let slug = "";
  let state = PublicBookingState.createInitialState();
  let submitting = false;

  function setState(patch) {
    const stepChanged = patch.step && patch.step !== state.step;
    state = { ...state, ...patch };
    PublicBookingUI.renderPanel(state);
    if (stepChanged) scrollToPanel();
  }

  function scrollToPanel() {
    const top = PublicBookingUI.els.steps?.getBoundingClientRect().top ?? 0;
    if (top < 0 || top > window.innerHeight * 0.6) {
      window.scrollTo({ top: window.scrollY + top - 12, behavior: "smooth" });
    }
  }

  function setSelection(patch) {
    state = {
      ...state,
      selection: { ...state.selection, ...patch },
      error: "",
    };
    PublicBookingUI.renderPanel(state);
  }

  async function init() {
    PublicBookingUI.cacheElements();
    slug = PublicBookingApi.getSlugFromPath();

    if (!slug) {
      PublicBookingUI.showError("Страница недоступна", "Не указан адрес организации.");
      return;
    }

    PublicBookingUI.showLoader();

    try {
      const [{ organization }, servicesPayload] = await Promise.all([
        PublicBookingApi.getOrganization(slug),
        PublicBookingApi.getServices(slug),
      ]);

      state = {
        ...PublicBookingState.createInitialState(),
        organization,
        services: servicesPayload.services || [],
        selection: {
          ...PublicBookingState.createInitialState().selection,
          bookingDate: PublicBookingState.getTodayString(),
        },
      };

      PublicBookingUI.renderOrganization(organization);
      PublicBookingUI.showFlow();
      PublicBookingUI.renderPanel(state);
      bindEvents();
    } catch (error) {
      const title =
        error.code === "PUBLIC_BOOKING_DISABLED"
          ? "Онлайн-запись недоступна"
          : "Страница недоступна";
      PublicBookingUI.showError(title, error.message || PublicBookingErrors.MESSAGES.GENERIC);
    }
  }

  function bindEvents() {
    PublicBookingUI.els.panel.addEventListener("click", handlePanelClick);
    PublicBookingUI.els.panel.addEventListener("change", (event) => {
      if (event.target.id === "pb-date-input" && event.target.value) selectDay(event.target.value);
    });
    PublicBookingUI.els.successRestart?.addEventListener("click", restartFlow);
  }

  async function handlePanelClick(event) {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;

    if (action === "select-service") {
      const serviceId = event.target.closest("[data-id]")?.dataset.id;
      if (!serviceId) return;
      setSelection({ serviceId, staffId: "", startTime: "", endTime: "" });
      await goToStaff();
      return;
    }

    if (action === "select-staff") {
      const staffId = event.target.closest("[data-id]")?.dataset.id;
      if (staffId) await selectStaff(staffId);
      return;
    }

    if (action === "select-day") {
      const button = event.target.closest("[data-date]");
      if (!button || button.getAttribute("aria-disabled") === "true") return;
      await selectDay(button.dataset.date);
      return;
    }

    if (action === "select-slot") {
      const button = event.target.closest("[data-start]");
      if (!button) return;
      setSelection({
        startTime: button.dataset.start,
        endTime: button.dataset.end,
      });
      setState({ step: "client" });
      return;
    }

    if (action === "continue-client") {
      const form = document.getElementById("pb-client-form");
      if (!form) return;

      const formData = new FormData(form);
      const clientName = String(formData.get("client_name") || "").trim();
      const clientPhone = String(formData.get("client_phone") || "").trim();
      const clientEmail = String(formData.get("client_email") || "").trim();
      const clientComment = String(formData.get("client_comment") || "").trim();
      const consent = formData.get("consent") === "on";

      if (clientName.length < 2) {
        setState({ error: "Имя должно содержать минимум 2 символа." });
        return;
      }
      if (clientPhone.length < 7) {
        setState({ error: "Укажите корректный телефон." });
        return;
      }
      if (!consent) {
        setState({ error: "Нужно согласие на обработку данных." });
        return;
      }

      setSelection({ clientName, clientPhone, clientEmail, clientComment, consent });
      setState({ step: "confirm" });
      return;
    }

    if (action === "submit-booking") {
      if (needsVerification()) {
        await startVerification();
      } else {
        await submitBooking();
      }
      return;
    }

    if (action === "retry-verification") {
      await startVerification();
      return;
    }

    if (action === "change-phone") {
      stopPolling();
      setState({ step: "client", verification: null, error: "" });
      return;
    }

    if (action === "back") {
      goBack();
    }
  }

  async function goToStaff() {
    setState({ loading: true, error: "" });
    try {
      const payload = await PublicBookingApi.getStaff(slug, state.selection.serviceId);
      const staff = payload.staff || [];
      setState({ loading: false, staff, step: "staff" });
      // Один мастер — выбирать нечего, сразу к дате и времени.
      if (staff.length === 1) await selectStaff(staff[0].id);
    } catch (error) {
      setState({
        loading: false,
        error: error.message || PublicBookingErrors.MESSAGES.GENERIC,
      });
    }
  }

  /** Мастер выбран: сразу открываем его ближайший свободный день. */
  async function selectStaff(staffId) {
    const member = state.staff.find((item) => item.id === staffId);
    const bookingDate = member?.next_available?.date || PublicBookingState.getTodayString();
    setSelection({ staffId, bookingDate, startTime: "", endTime: "" });
    setState({ step: "time" });
    await loadSlots();
  }

  async function selectDay(bookingDate) {
    if (bookingDate === state.selection.bookingDate && state.slots.length) return;
    setSelection({ bookingDate, startTime: "", endTime: "" });
    await loadSlots();
  }

  async function loadSlots() {
    const requested = state.selection.bookingDate;
    setState({ slotsLoading: true, error: "", slots: [] });
    try {
      const payload = await PublicBookingApi.getSlots(slug, {
        serviceId: state.selection.serviceId,
        staffId: state.selection.staffId,
        date: requested,
      });
      // Пока грузили, клиент выбрал другой день — этот ответ уже не нужен.
      if (state.selection.bookingDate !== requested) return;
      setState({ slotsLoading: false, slots: payload.slots || [] });
    } catch (error) {
      if (state.selection.bookingDate !== requested) return;
      setState({ slotsLoading: false, error: error.message || PublicBookingErrors.MESSAGES.GENERIC });
    }
  }

  async function submitBooking() {
    if (submitting) return;
    submitting = true;

    const submitBtn = document.getElementById("pb-submit-btn");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Создание записи…";
    }

    setState({ error: "" });

    try {
      const result = await PublicBookingApi.createBooking(slug, {
        service_id: state.selection.serviceId,
        staff_id: state.selection.staffId,
        booking_date: state.selection.bookingDate,
        start_time: state.selection.startTime,
        client_name: state.selection.clientName,
        client_phone: state.selection.clientPhone,
        client_email: state.selection.clientEmail || null,
        client_comment: state.selection.clientComment || null,
        website: "",
        verification_token: state.verification?.token || undefined,
      });

      stopPolling();
      state.result = result;
      PublicBookingUI.showSuccess(result);
    } catch (error) {
      // Подтверждение устарело — пройти заново.
      const verification = error.code === "PHONE_NOT_VERIFIED" ? null : state.verification;
      setState({ error: error.message || PublicBookingErrors.MESSAGES.GENERIC, verification });
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Записаться";
      }
    } finally {
      submitting = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Подтверждение номера в Telegram
  // ---------------------------------------------------------------------------

  let pollTimer = null;

  function needsVerification() {
    if (!state.organization?.phone_verification_required) return false;
    const v = state.verification;
    return !(v && v.status === "verified" && v.phone === state.selection.clientPhone);
  }

  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  async function startVerification() {
    if (submitting) return;
    stopPolling();
    setState({ error: "", verification: { status: "creating", phone: state.selection.clientPhone } });

    try {
      const result = await PublicBookingApi.createPhoneVerification(slug, state.selection.clientPhone);
      setState({
        verification: {
          token: result.token,
          botUrl: result.bot_url,
          phone: state.selection.clientPhone,
          status: "waiting",
        },
      });
      schedulePoll(1500);
    } catch (error) {
      setState({ verification: null, error: error.message || PublicBookingErrors.MESSAGES.GENERIC });
    }
  }

  function schedulePoll(delay = 2500) {
    stopPolling();
    pollTimer = setTimeout(pollVerification, delay);
  }

  async function pollVerification() {
    const current = state.verification;
    if (!current?.token || current.status !== "waiting" || state.step !== "confirm") return;

    try {
      const { status } = await PublicBookingApi.getPhoneVerification(current.token);
      if (state.verification?.token !== current.token) return;

      if (status === "verified") {
        setState({ verification: { ...current, status: "verified" } });
        await submitBooking();
        return;
      }
      if (status === "mismatch" || status === "expired") {
        setState({ verification: { ...current, status } });
        return;
      }
    } catch {
      // сеть пропала — пробуем ещё
    }
    schedulePoll();
  }

  // Вернулись из Telegram — проверить сразу, не дожидаясь таймера.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.verification?.status === "waiting") {
      schedulePoll(0);
    }
  });

  function goBack() {
    const order = PublicBookingState.STEPS.map((step) => step.id);
    const index = order.indexOf(state.step);
    if (index <= 0) return;
    stopPolling();
    const verification = state.verification?.status === "verified" ? state.verification : null;
    let target = order[index - 1];
    // Мастер один и выбран автоматически — шаг «Мастер» пропускаем и назад.
    if (target === "staff" && state.staff.length === 1) target = "service";
    setState({ step: target, error: "", verification });
  }

  function restartFlow() {
    const organization = state.organization;
    const services = state.services;
    state = {
      ...PublicBookingState.createInitialState(),
      organization,
      services,
      selection: {
        ...PublicBookingState.createInitialState().selection,
        bookingDate: PublicBookingState.getTodayString(),
      },
    };
    PublicBookingUI.showFlow();
    PublicBookingUI.renderPanel(state);
  }

  document.addEventListener("DOMContentLoaded", init);

  return { init };
})();
