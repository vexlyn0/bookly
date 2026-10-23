/**
 * Bookly — типы бизнеса и часовые пояса
 */
window.BooklyOrgConstants = (() => {
  // Типы, которые предлагаются при регистрации
  const BUSINESS_TYPES = [
    { value: "beauty_salon", label: "Салон красоты" },
    { value: "barbershop", label: "Барбершоп" },
    { value: "nail_studio", label: "Ногтевая студия" },
    { value: "cosmetology", label: "Косметология" },
    { value: "massage", label: "Массаж и SPA" },
    { value: "tattoo", label: "Тату-студия" },
    { value: "dental", label: "Стоматология" },
    { value: "clinic", label: "Клиника" },
    { value: "fitness", label: "Фитнес и йога" },
    { value: "education", label: "Обучение и репетиторы" },
    { value: "auto_service", label: "Автосервис" },
    { value: "other", label: "Другое" },
  ];

  // Устаревшие типы: не предлагаются, но подписываются у уже созданных компаний
  const LEGACY_BUSINESS_TYPES = [
    { value: "coffee_shop", label: "Кофейня" },
    { value: "restaurant", label: "Ресторан" },
  ];

  const TIMEZONES = [
    { value: "Asia/Almaty", label: "Казахстан (UTC+5)" },
    { value: "Asia/Tashkent", label: "Узбекистан (UTC+5)" },
    { value: "Asia/Bishkek", label: "Кыргызстан (UTC+6)" },
    { value: "Europe/Moscow", label: "Москва (UTC+3)" },
    { value: "Europe/Samara", label: "Самара (UTC+4)" },
    { value: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
    { value: "Asia/Omsk", label: "Омск (UTC+6)" },
    { value: "Asia/Novosibirsk", label: "Новосибирск (UTC+7)" },
  ];

  const BUSINESS_TYPE_LABELS = Object.fromEntries(
    [...BUSINESS_TYPES, ...LEGACY_BUSINESS_TYPES].map((item) => [item.value, item.label])
  );

  function getBusinessTypeLabel(value) {
    return BUSINESS_TYPE_LABELS[value] || value || "—";
  }

  function populateBusinessTypeSelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = BUSINESS_TYPES.map(
      (item) => `<option value="${item.value}">${item.label}</option>`
    ).join("");
  }

  function populateTimezoneSelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = TIMEZONES.map(
      (item) => `<option value="${item.value}">${item.label}</option>`
    ).join("");
    selectEl.value = "Asia/Almaty";
  }

  return {
    BUSINESS_TYPES,
    TIMEZONES,
    getBusinessTypeLabel,
    populateBusinessTypeSelect,
    populateTimezoneSelect,
  };
})();
