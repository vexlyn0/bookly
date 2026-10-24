/**
 * Bookly — валидация услуг
 */
window.BooklyServicesValidation = (() => {
  const MIN_NAME_LENGTH = 2;
  const MIN_DURATION = 5;
  const MAX_DURATION = 1440;

  function validate(payload) {
    const errors = {};
    const name = String(payload.name || "").trim();
    const description = String(payload.description || "").trim();
    const priceRaw = payload.price;
    const durationRaw = payload.duration_minutes;
    const category = String(payload.category || "").trim();
    const prepayType = ["fixed", "percent"].includes(payload.prepay_type) ? payload.prepay_type : "none";
    const prepayValue = Number.parseInt(String(payload.prepay_value ?? ""), 10);

    if (name.length < MIN_NAME_LENGTH) {
      errors.name = `Название должно содержать минимум ${MIN_NAME_LENGTH} символа.`;
    }

    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price < 0) {
      errors.price = "Цена не может быть отрицательной.";
    }

    const duration = Number.parseInt(String(durationRaw), 10);
    if (!Number.isFinite(duration) || duration < MIN_DURATION || duration > MAX_DURATION) {
      errors.duration_minutes = `Длительность: от ${MIN_DURATION} до ${MAX_DURATION} минут.`;
    }

    if (prepayType === "fixed" && !(prepayValue >= 100 && prepayValue <= 1000000)) {
      errors.prepay_value = "Предоплата — от 100 ₸.";
    }
    if (prepayType === "percent" && !(prepayValue >= 1 && prepayValue <= 100)) {
      errors.prepay_value = "Процент — от 1 до 100.";
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      data: {
        name,
        description: description || null,
        price: Number.isFinite(price) ? Math.round(price) : 0,
        duration_minutes: Number.isFinite(duration) ? duration : MIN_DURATION,
        category: category ? category.slice(0, 40) : null,
        is_active: payload.is_active !== false,
        is_popular: payload.is_popular === true,
        prepay_type: prepayType,
        prepay_value: prepayType === "none" ? null : prepayValue,
        photo_url: /^https:\/\//.test(String(payload.photo_url || "")) ? payload.photo_url : null,
      },
    };
  }

  return { validate, MIN_NAME_LENGTH, MIN_DURATION, MAX_DURATION };
})();
