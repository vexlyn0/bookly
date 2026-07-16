/**
 * Bookly — человекочитаемые сообщения об ошибках Supabase Auth
 */
window.BooklyAuthErrors = (() => {
  /**
   * Сообщения по коду ошибки Supabase (приоритетный источник)
   * @see https://github.com/supabase/auth/blob/master/internal/api/errors.go
   */
  const CODE_MESSAGES = {
    invalid_credentials: "Неверный email или пароль.",
    email_not_confirmed: "Подтвердите email — проверьте почту и перейдите по ссылке.",
    user_not_found: "Пользователь с таким email не найден.",
    user_already_exists: "Аккаунт с таким email уже зарегистрирован.",
    email_exists: "Аккаунт с таким email уже зарегистрирован.",
    weak_password: "Пароль слишком простой. Используйте не менее 8 символов.",
    signup_disabled: "Регистрация временно отключена.",
    email_address_invalid: "Укажите корректный email.",
    email_address_not_authorized: "Этот email-адрес не разрешён для регистрации.",
    over_request_rate_limit:
      "Слишком много запросов к серверу. Подождите 1–2 минуты и попробуйте снова.",
    over_email_send_rate_limit:
      "Достигнут лимит отправки писем Supabase. Аккаунт может быть уже создан — попробуйте войти. Повторная отправка письма возможна через несколько минут.",
    over_sms_send_rate_limit:
      "Достигнут лимит отправки SMS. Попробуйте позже.",
    session_expired: "Сессия истекла. Войдите снова.",
    user_banned: "Аккаунт заблокирован. Обратитесь в поддержку.",
    captcha_failed: "Проверка CAPTCHA не пройдена. Попробуйте снова.",
    validation_failed: "Данные не прошли проверку. Проверьте введённые поля.",
  };

  const FALLBACK = "Произошла ошибка. Попробуйте ещё раз.";

  /**
   * Извлекает структурированные данные из ошибки Supabase
   */
  function toDetails(error) {
    if (!error) {
      return { message: "unknown error" };
    }

    if (typeof error === "string") {
      return { message: error };
    }

    return {
      name: error.name || null,
      message: error.message || null,
      status: error.status ?? null,
      code: error.code || null,
    };
  }

  /**
   * Выводит полный текст ошибки Supabase в консоль
   */
  function logError(context, error) {
    const details = toDetails(error);
    console.error(`[auth:${context}] Supabase error:`, details);

    if (error && typeof error === "object") {
      try {
        console.error(`[auth:${context}] raw:`, JSON.stringify(error, null, 2));
      } catch {
        console.error(`[auth:${context}] raw:`, error);
      }
    }

    return details;
  }

  /**
   * Возвращает сообщение для пользователя
   */
  function fromError(error) {
    if (!error) return FALLBACK;

    if (typeof error === "string") {
      return error.trim() || FALLBACK;
    }

    const code = String(error.code || "").trim();
    if (code === "SUPABASE_NOT_CONFIGURED" || code === "CONFIG_PARSE_ERROR") {
      return "Сервис авторизации временно недоступен. Попробуйте позже.";
    }
    if (code === "SDK_MISSING") {
      return "Не удалось загрузить модуль авторизации. Обновите страницу.";
    }

    // 1. Точное совпадение по коду Supabase
    if (code && CODE_MESSAGES[code]) {
      return CODE_MESSAGES[code];
    }

    const message = String(error.message || error.error_description || "").trim();
    const lower = message.toLowerCase();

    if (
      lower.includes("invalid api key") ||
      (lower.includes("jwt") && lower.includes("invalid")) ||
      error.status === 401
    ) {
      return "Ошибка конфигурации авторизации. Обратитесь в поддержку.";
    }

    if (
      lower.includes("failed to fetch") ||
      lower.includes("networkerror") ||
      lower.includes("network request failed") ||
      code === "NETWORK_ERROR"
    ) {
      return "Ошибка сети. Проверьте соединение и попробуйте снова.";
    }

    // 2. Оригинальное сообщение от Supabase (без подмены regex)
    if (message) {
      // Не показываем технические подсказки про .env пользователю
      if (lower.includes(".env") || lower.includes("service_role") || lower.includes("anon_key")) {
        return "Сервис авторизации временно недоступен. Попробуйте позже.";
      }
      return message;
    }

    return FALLBACK;
  }

  /**
   * Ошибка отправки письма — аккаунт мог быть создан
   */
  function isEmailSendRateLimit(error) {
    return error?.code === "over_email_send_rate_limit";
  }

  return {
    fromError,
    logError,
    toDetails,
    isEmailSendRateLimit,
    CODE_MESSAGES,
  };
})();
