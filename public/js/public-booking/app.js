window.PublicBookingApp = (() => {
  let slug = "";
  let state = PublicBookingState.createInitialState();
  let submitting = false;
  const t = (key, vars) => PublicBookingI18n.t(key, vars);

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

  const CLIENT_KEY = "bookly:client";

  function readSavedClient() {
    try {
      const saved = JSON.parse(localStorage.getItem(CLIENT_KEY) || "null");
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  }

  function saveClient(name, phone) {
    try {
      localStorage.setItem(CLIENT_KEY, JSON.stringify({ name, phone }));
    } catch {
      // приватный режим — не страшно
    }
  }

  function initialSelection() {
    const saved = readSavedClient();
    return {
      ...PublicBookingState.createInitialState().selection,
      bookingDate: PublicBookingState.getTodayString(),
      clientName: String(saved.name || ""),
      clientPhone: String(saved.phone || ""),
    };
  }

  /** Маска казахстанского номера: +7 (701) 123-45-67. Чужие коды не трогаем. */
  function formatPhone(value) {
    const raw = String(value || "");
    let digits = raw.replace(/\D/g, "");
    if (!digits) return raw.startsWith("+") ? "+" : "";
    if (digits[0] === "8") digits = `7${digits.slice(1)}`;
    if (digits[0] !== "7") return raw;
    digits = digits.slice(0, 11);
    const p = digits.slice(1);
    let out = "+7";
    if (p.length) out += ` (${p.slice(0, 3)}`;
    if (p.length >= 3) out += ")";
    if (p.length > 3) out += ` ${p.slice(3, 6)}`;
    if (p.length > 6) out += `-${p.slice(6, 8)}`;
    if (p.length > 8) out += `-${p.slice(8, 10)}`;
    return out;
  }

  /**
   * Номер без кода страны: «701 123 45 67» маска при наборе читает как +7 (011)…,
   * потому что казахстанские номера сами начинаются с 7. Итог — 10 цифр с первой 7:
   * значит, код не вводили, дописываем его.
   */
  function completePhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length === 10 && digits[0] === "7" ? formatPhone(`7${digits}`) : value;
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
      PublicBookingUI.showError(t("page_unavailable"), t("no_slug"));
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
        selection: initialSelection(),
      };

      PublicBookingUI.renderOrganization(organization);
      PublicBookingUI.showFlow();
      PublicBookingUI.renderPanel(state);
      bindEvents();
    } catch (error) {
      const title =
        error.code === "PUBLIC_BOOKING_DISABLED"
          ? t("booking_unavailable")
          : t("page_unavailable");
      PublicBookingUI.showError(title, error.message || PublicBookingErrors.MESSAGES.GENERIC);
    }
  }

  function bindEvents() {
    PublicBookingUI.els.panel.addEventListener("click", handlePanelClick);
    PublicBookingUI.els.panel.addEventListener("change", (event) => {
      if (event.target.id === "pb-date-input" && event.target.value) selectDay(event.target.value);
    });
    // Поля контактов пишем в состояние без перерисовки — ничего не теряется.
    PublicBookingUI.els.panel.addEventListener("input", (event) => {
      const field = event.target;
      if (field.name === "client_phone") {
        const formatted = formatPhone(field.value);
        if (formatted !== field.value) field.value = formatted;
        state.selection.clientPhone = field.value;
      } else if (field.name === "client_name") {
        state.selection.clientName = field.value;
      } else if (field.name === "client_comment") {
        state.selection.clientComment = field.value;
      }
    });
    // Ушли из поля — сразу показываем номер с дописанным кодом, чтобы клиент увидел итог.
    PublicBookingUI.els.panel.addEventListener("focusout", (event) => {
      const field = event.target;
      if (field.name !== "client_phone") return;
      const completed = completePhone(field.value);
      if (completed !== field.value) field.value = completed;
      state.selection.clientPhone = field.value;
    });
    PublicBookingUI.els.successRestart?.addEventListener("click", restartFlow);

    // Сменили язык — перерисовываем всё, что собрано в JS.
    document.addEventListener("pb:lang", () => {
      PublicBookingUI.renderOrganization(state.organization);
      PublicBookingUI.rerenderPrepay();
      if (state.result && !PublicBookingUI.els.success.hidden) {
        PublicBookingUI.showSuccess(state.result);
      } else {
        PublicBookingUI.renderPanel(state);
      }
    });
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

    if (action === "select-category") {
      // «Все» — "__all"; «Другое» (услуги без категории) — пустая строка
      const category = event.target.closest("[data-category]")?.dataset.category ?? "__all";
      setState({ serviceCategory: category === "__all" ? null : category });
      return;
    }

    if (action === "select-next") {
      const staffId = event.target.closest("[data-id]")?.dataset.id;
      if (staffId) pickNearest(staffId);
      return;
    }

    if (action === "select-any") {
      const earliest = earliestStaff();
      if (earliest) await selectStaff(earliest.id);
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

    if (action === "show-comment") {
      setState({ showComment: true });
      document.querySelector('[name="client_comment"]')?.focus();
      return;
    }

    if (action === "submit-booking") {
      const clientName = String(state.selection.clientName || "").trim();
      const clientPhone = completePhone(String(state.selection.clientPhone || "").trim());
      const digits = clientPhone.replace(/\D/g, "");

      if (clientName.length < 2) {
        setState({ error: t("err_name") });
        return;
      }
      // +7 — Казахстан и Россия: ровно 11 цифр. Чужие коды — хотя бы 10.
      if (digits[0] === "7" ? digits.length !== 11 : digits.length < 10) {
        setState({ error: t("err_phone") });
        return;
      }

      setSelection({ clientName, clientPhone, clientComment: String(state.selection.clientComment || "").trim() });
      await submitBooking();
      return;
    }

    if (action === "retry-verification") {
      await startVerification();
      return;
    }

    if (action === "change-phone") {
      stopPolling();
      setState({ verification: null, error: "" });
      document.querySelector('[name="client_phone"]')?.focus();
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

  /** Мастер, к которому можно попасть раньше всех. */
  function earliestStaff() {
    return state.staff
      .filter((m) => m.next_available)
      .sort((a, b) =>
        `${a.next_available.date} ${a.next_available.start_time}`.localeCompare(
          `${b.next_available.date} ${b.next_available.start_time}`
        )
      )[0];
  }

  /** Нажали «Ближайшее: сегодня 15:00» — сразу к имени и телефону. */
  function pickNearest(staffId) {
    const member = state.staff.find((item) => item.id === staffId);
    const next = member?.next_available;
    if (!next) return;
    const service = PublicBookingState.getSelectedService(state);
    const [h, m] = next.start_time.split(":").map(Number);
    const end = h * 60 + m + (Number(service?.duration_minutes) || 0);
    const endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
    setSelection({ staffId, bookingDate: next.date, startTime: next.start_time, endTime });
    setState({ step: "client", slots: [] });
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
      submitBtn.textContent = t("submitting");
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
      saveClient(state.selection.clientName, state.selection.clientPhone);
      window.jazylGoal?.("demo_booking"); // есть только на демо-салоне
      state.result = result;
      if (result.booking?.prepay) {
        // Услуга с предоплатой: сначала оплата, «Вы записаны» — после подтверждения салоном
        PublicBookingUI.showPrepay(result, () => {
          state.result = { ...result, booking: { ...result.booking, status: "confirmed" } };
          PublicBookingUI.showSuccess(state.result);
        });
      } else {
        PublicBookingUI.showSuccess(result);
      }
    } catch (error) {
      if (error.code === "PHONE_NOT_VERIFIED") {
        // Новый номер у салона с проверкой — подтверждаем в Telegram.
        submitting = false;
        await startVerification();
        return;
      }
      setState({ error: error.message || PublicBookingErrors.MESSAGES.GENERIC });
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = t("submit");
      }
    } finally {
      submitting = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Подтверждение номера в Telegram
  // ---------------------------------------------------------------------------

  let pollTimer = null;

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
    if (!current?.token || current.status !== "waiting" || state.step !== "client") return;

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
    // Пришли сюда быстрым путём (нажали ближайшее время) — время дня ещё не загружено.
    if (target === "time" && !state.slots.length) loadSlots();
  }

  function restartFlow() {
    const organization = state.organization;
    const services = state.services;
    state = {
      ...PublicBookingState.createInitialState(),
      organization,
      services,
      selection: initialSelection(),
    };
    PublicBookingUI.showFlow();
    PublicBookingUI.renderPanel(state);
  }

  document.addEventListener("DOMContentLoaded", init);

  return { init };
})();
