/**
 * Bookly — страница регистрации
 *   - по почте: имя, почта, пароль (с кнопкой «показать»), затем письмо для подтверждения почты;
 *     пока открыт экран «Проверьте почту», страница сама пробует войти — если письмо
 *     подтвердили на другом устройстве (телефоне), здесь тоже откроется кабинет;
 *   - через Google: почта уже подтверждена Google.
 */

(async () => {
  const page = document.querySelector(".auth-page");
  const form = document.getElementById("register-form");
  const errorEl = document.getElementById("register-error");
  const successEl = document.getElementById("register-success");
  const submitBtn = document.getElementById("register-submit");
  const googleBtn = document.getElementById("register-google");
  const check = document.getElementById("register-check");
  const checkEmail = document.getElementById("register-check-email");
  const checkError = document.getElementById("register-check-error");
  const resendBtn = document.getElementById("register-resend");
  const changeEmailBtn = document.getElementById("register-change-email");
  const switchEl = document.getElementById("register-switch");
  const divider = document.querySelector(".auth-card__divider");

  if (!form) return;

  const firstNameInput = form.elements.namedItem("firstName");
  const emailInput = form.elements.namedItem("email");
  const passwordInput = form.elements.namedItem("password");
  BooklyAuthUI.bindPasswordToggles(form);

  const RESEND_COOLDOWN_SEC = 60;
  // Чаще нельзя: Supabase ограничивает число входов с одного адреса.
  const CONFIRM_POLL_MS = 15000;
  const CONFIRM_POLL_LIMIT_MS = 30 * 60 * 1000;
  let pendingEmail = "";
  let pendingPassword = "";
  let cooldownTimer = null;
  let pollTimer = null;
  let pollUntil = 0;
  let polling = false;

  try {
    const session = await BooklyAuth.waitForSession({ timeoutMs: 5000 });
    if (session) {
      await BooklyOrg.redirectAfterAuth();
      return;
    }
  } catch (error) {
    BooklyAuthErrors.logError("register:init", error);
    BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
  } finally {
    BooklyAuthUI.setPageReady(page);
  }

  // ---------------------------------------------------------------------------
  // «Проверьте почту»
  // ---------------------------------------------------------------------------

  function showCheckEmail(email, password) {
    pendingEmail = email;
    pendingPassword = password;
    checkEmail.textContent = email;
    form.hidden = true;
    if (googleBtn) googleBtn.hidden = true;
    if (divider) divider.hidden = true;
    if (switchEl) switchEl.hidden = true;
    check.hidden = false;
    startCooldown();
    startConfirmPolling();
  }

  // Письмо подтвердили на другом устройстве — пароль уже подходит, входим здесь.
  async function tryEnterAfterConfirm() {
    if (polling || check.hidden || !pendingPassword || document.hidden) return;
    if (Date.now() > pollUntil) return stopConfirmPolling();
    polling = true;
    try {
      const { data } = await BooklyAuth.signIn(pendingEmail, pendingPassword);
      if (data?.session) {
        stopConfirmPolling();
        await BooklyOrg.redirectAfterAuth();
      }
    } catch (error) {
      BooklyAuthErrors.logError("register:confirm-poll", error);
    } finally {
      polling = false;
    }
  }

  function startConfirmPolling() {
    stopConfirmPolling();
    pollUntil = Date.now() + CONFIRM_POLL_LIMIT_MS;
    pollTimer = setInterval(tryEnterAfterConfirm, CONFIRM_POLL_MS);
  }

  function stopConfirmPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Вернулись на вкладку после письма на телефоне — проверяем сразу, не ждём таймер.
  document.addEventListener("visibilitychange", () => {
    if (pollTimer) tryEnterAfterConfirm();
  });
  window.addEventListener("focus", () => {
    if (pollTimer) tryEnterAfterConfirm();
  });

  function startCooldown() {
    let left = RESEND_COOLDOWN_SEC;
    resendBtn.disabled = true;
    clearInterval(cooldownTimer);
    const tick = () => {
      resendBtn.textContent = left > 0 ? `Отправить ещё раз через ${left} с` : "Отправить письмо ещё раз";
      resendBtn.disabled = left > 0;
      left -= 1;
      if (left < 0) clearInterval(cooldownTimer);
    };
    tick();
    cooldownTimer = setInterval(tick, 1000);
  }

  resendBtn?.addEventListener("click", async () => {
    BooklyAuthUI.hideAlert(checkError);
    resendBtn.disabled = true;
    try {
      const { error } = await BooklyAuth.resendConfirmation(pendingEmail);
      if (error) throw error;
      startCooldown();
    } catch (error) {
      resendBtn.disabled = false;
      BooklyAuthUI.showAlert(
        checkError,
        BooklyAuthErrors.isEmailSendRateLimit(error)
          ? "Слишком много писем подряд. Подождите немного и попробуйте снова."
          : BooklyAuthErrors.fromError(error)
      );
    }
  });

  changeEmailBtn?.addEventListener("click", () => {
    clearInterval(cooldownTimer);
    stopConfirmPolling();
    pendingPassword = "";
    check.hidden = true;
    form.hidden = false;
    if (googleBtn) googleBtn.hidden = false;
    if (divider) divider.hidden = false;
    if (switchEl) switchEl.hidden = false;
    emailInput.focus();
  });

  // ---------------------------------------------------------------------------
  // Google
  // ---------------------------------------------------------------------------

  googleBtn?.addEventListener("click", async () => {
    BooklyAuthUI.hideAlert(errorEl);
    googleBtn.disabled = true;
    window.jazylGoal?.("register_google");
    const { error } = await BooklyAuth.signInWithGoogle();
    if (error) {
      googleBtn.disabled = false;
      BooklyAuthUI.showAlert(
        errorEl,
        /provider is not enabled|Unsupported provider/i.test(error.message || "")
          ? "Вход через Google пока не включён. Зарегистрируйтесь по почте."
          : BooklyAuthErrors.fromError(error)
      );
    }
  });

  // ---------------------------------------------------------------------------
  // Регистрация по почте
  // ---------------------------------------------------------------------------

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    BooklyAuthUI.hideAlert(errorEl);
    BooklyAuthUI.hideAlert(successEl);
    BooklyAuthUI.clearFieldErrors(form);

    const firstName = String(firstNameInput.value || "").trim();
    const email = String(emailInput.value || "").trim().toLowerCase();
    const password = String(passwordInput.value || "");

    const firstNameError = BooklyAuthUI.validateRequired(firstName, "Имя");
    const emailError = BooklyAuthUI.validateEmail(email);
    const passwordError = BooklyAuthUI.validatePassword(password, 8);

    if (firstNameError) BooklyAuthUI.setFieldError(firstNameInput, firstNameError);
    if (emailError) BooklyAuthUI.setFieldError(emailInput, emailError);
    if (passwordError) BooklyAuthUI.setFieldError(passwordInput, passwordError);
    if (firstNameError || emailError || passwordError) return;

    BooklyAuthUI.setFormDisabled(form, true);
    BooklyAuthUI.setButtonLoading(submitBtn, true, "Создание…", "Создать аккаунт");

    try {
      const { data, error } = await BooklyAuth.signUp(email, password, {
        first_name: firstName,
        full_name: firstName,
      });

      if (error) {
        BooklyAuthErrors.logError("register:submit", error);
        BooklyAuthUI.showAlert(
          errorEl,
          BooklyAuthErrors.isEmailSendRateLimit(error)
            ? "Сейчас не получается отправить письмо — слишком много регистраций подряд. Попробуйте через несколько минут."
            : BooklyAuthErrors.fromError(error)
        );
        return;
      }

      window.jazylGoal?.("register");

      // Подтверждение почты выключено в Supabase — сразу внутрь.
      if (data?.session) {
        await BooklyOrg.redirectAfterAuth();
        return;
      }

      // Подтверждение включено (или почта уже зарегистрирована — Supabase
      // намеренно не говорит об этом): просим открыть письмо.
      showCheckEmail(email, password);
    } catch (error) {
      BooklyAuthErrors.logError("register:exception", error);
      BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
    } finally {
      BooklyAuthUI.setFormDisabled(form, false);
      BooklyAuthUI.setButtonLoading(submitBtn, false, "Создание…", "Создать аккаунт");
    }
  });
})();
