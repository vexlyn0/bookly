window.PublicBookingErrors = (() => {
  const I18n = window.PublicBookingI18n;

  /** Тексты общих ошибок на текущем языке: MESSAGES.GENERIC, MESSAGES.NETWORK_ERROR… */
  const MESSAGES = new Proxy({}, { get: (_, code) => I18n.error(String(code)) });

  function fromResponse(payload, fallback = "GENERIC") {
    if (!payload) return I18n.error(fallback);
    return I18n.error(payload.code || fallback, payload.message);
  }

  return { MESSAGES, fromResponse };
})();
