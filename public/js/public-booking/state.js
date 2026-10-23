window.PublicBookingState = (() => {
  const STEPS = [
    { id: "service", label: "Услуга" },
    { id: "staff", label: "Мастер" },
    { id: "time", label: "Дата и время" },
    { id: "client", label: "Контакты" },
    { id: "confirm", label: "Подтверждение" },
  ];

  const MAX_DAYS_AHEAD = 60;

  function createInitialState() {
    return {
      step: "service",
      organization: null,
      services: [],
      staff: [],
      slots: [],
      slotsLoading: false,
      loading: false,
      error: "",
      selection: {
        serviceId: "",
        staffId: "",
        bookingDate: "",
        startTime: "",
        endTime: "",
        clientName: "",
        clientPhone: "",
        clientEmail: "",
        clientComment: "",
        consent: false,
      },
      result: null,
      /** Подтверждение номера в Telegram: { token, botUrl, phone, status } */
      verification: null,
    };
  }

  function getStepIndex(step) {
    return STEPS.findIndex((item) => item.id === step);
  }

  function getSelectedService(state) {
    return state.services.find((item) => item.id === state.selection.serviceId) || null;
  }

  function getSelectedStaff(state) {
    return state.staff.find((item) => item.id === state.selection.staffId) || null;
  }

  function getSelectedSlot(state) {
    return state.slots.find((item) => item.start_time === state.selection.startTime) || null;
  }

  function getMaxDateString() {
    const date = new Date();
    date.setDate(date.getDate() + MAX_DAYS_AHEAD);
    return toDateString(date);
  }

  /** Дата YYYY-MM-DD по местному времени (toISOString дал бы UTC — вчера до 5 утра в Алматы). */
  function toDateString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function getTodayString() {
    return toDateString(new Date());
  }

  function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return toDateString(new Date(y, m - 1, d + days));
  }

  return {
    STEPS,
    MAX_DAYS_AHEAD,
    createInitialState,
    getStepIndex,
    getSelectedService,
    getSelectedStaff,
    getSelectedSlot,
    getMaxDateString,
    getTodayString,
    addDays,
  };
})();
