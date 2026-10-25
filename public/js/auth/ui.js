/**
 * Bookly — UI-утилиты для форм авторизации
 */
window.BooklyAuthUI = (() => {
  const SPINNER_SVG = `
    <svg class="btn__spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.25"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

  function setPageReady(pageEl) {
    pageEl?.classList.remove("auth-page--checking");
  }

  function setFormDisabled(form, disabled) {
    if (!form) return;
    form.querySelectorAll("input, button, select, textarea").forEach((el) => {
      el.disabled = disabled;
    });
  }

  function setButtonLoading(button, isLoading, loadingText, defaultText) {
    if (!button) return;

    if (isLoading) {
      if (!button.dataset.defaultHtml) {
        button.dataset.defaultHtml = button.innerHTML;
      }
      button.disabled = true;
      button.innerHTML = `${SPINNER_SVG}${loadingText}`;
      button.classList.add("is-loading");
      return;
    }

    button.disabled = false;
    button.innerHTML = button.dataset.defaultHtml || defaultText;
    button.classList.remove("is-loading");
  }

  function showAlert(alertEl, message, type = "error") {
    if (!alertEl) return;

    alertEl.textContent = message;
    alertEl.hidden = false;
    alertEl.classList.remove("alert--error", "alert--info", "alert--success");
    alertEl.classList.add(`alert--${type}`);
  }

  function hideAlert(alertEl) {
    if (!alertEl) return;
    alertEl.hidden = true;
    alertEl.textContent = "";
  }

  function setFieldError(input, message) {
    if (!input) return;

    const field = input.closest(".field");
    if (!field) return;

    field.classList.add("field--error");

    let errorEl = field.querySelector(".field__error");
    if (!errorEl) {
      errorEl = document.createElement("span");
      errorEl.className = "field__error";
      errorEl.setAttribute("role", "alert");
      field.appendChild(errorEl);
    }

    errorEl.textContent = message;
  }

  function clearFieldErrors(form) {
    if (!form) return;

    form.querySelectorAll(".field--error").forEach((field) => {
      field.classList.remove("field--error");
    });

    form.querySelectorAll(".field__error").forEach((el) => el.remove());
  }

  function validateEmail(value) {
    const email = String(value || "").trim();
    if (!email) return "Введите email.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Укажите корректный email.";
    return null;
  }

  function validatePassword(value, minLength = 8) {
    const password = String(value || "");
    if (!password) return "Введите пароль.";
    if (password.length < minLength) {
      return `Пароль должен содержать не менее ${minLength} символов.`;
    }
    return null;
  }

  function validateRequired(value, label) {
    if (!String(value || "").trim()) return `Поле «${label}» обязательно.`;
    return null;
  }

  /** Кнопки «показать пароль» ([data-toggle-password]) внутри .field__password. */
  function bindPasswordToggles(root = document) {
    root.querySelectorAll("[data-toggle-password]").forEach((button) => {
      const input = button.closest(".field__password")?.querySelector("input");
      if (!input) return;
      button.addEventListener("click", () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        button.setAttribute("aria-pressed", String(show));
        button.setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
        input.focus();
      });
    });
  }

  return {
    setPageReady,
    bindPasswordToggles,
    setFormDisabled,
    setButtonLoading,
    showAlert,
    hideAlert,
    setFieldError,
    clearFieldErrors,
    validateEmail,
    validatePassword,
    validateRequired,
  };
})();
