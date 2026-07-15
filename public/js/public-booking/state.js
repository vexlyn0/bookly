window.PublicBookingState = (() => {
  const STEPS = [
    { id: "service", label: "Услуга" },
    { id: "staff", label: "Сотрудник" },
    { id: "date", label: "Дата" },
    { id: "time", label: "Время" },
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
    return date.toISOString().slice(0, 10);
  }

  function getTodayString() {
    return new Date().toISOString().slice(0, 10);
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
  };
})();
