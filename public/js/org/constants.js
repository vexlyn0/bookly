/**
 * Bookly — типы бизнеса и часовые пояса
 */
window.BooklyOrgConstants = (() => {
  const BUSINESS_TYPES = [
    { value: "coffee_shop", label: "Кофейня" },
    { value: "restaurant", label: "Ресторан" },
    { value: "barbershop", label: "Барбершоп" },
    { value: "beauty_salon", label: "Салон красоты" },
    { value: "auto_service", label: "Автосервис" },
    { value: "dental", label: "Стоматология" },
    { value: "other", label: "Другое" },
  ];

  const TIMEZONES = [
    { value: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
    { value: "Europe/Moscow", label: "Москва (UTC+3)" },
    { value: "Europe/Samara", label: "Самара (UTC+4)" },
    { value: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
    { value: "Asia/Omsk", label: "Омск (UTC+6)" },
    { value: "Asia/Krasnoyarsk", label: "Красноярск (UTC+7)" },
    { value: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
    { value: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
    { value: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
    { value: "Asia/Magadan", label: "Магадан (UTC+11)" },
    { value: "Asia/Kamchatka", label: "Камчатка (UTC+12)" },
  ];

  const BUSINESS_TYPE_LABELS = Object.fromEntries(
    BUSINESS_TYPES.map((item) => [item.value, item.label])
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
    selectEl.value = "Europe/Moscow";
  }

  return {
    BUSINESS_TYPES,
    TIMEZONES,
    getBusinessTypeLabel,
    populateBusinessTypeSelect,
    populateTimezoneSelect,
  };
})();
