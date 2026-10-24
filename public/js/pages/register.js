/**
 * Bookly — страница регистрации
 *   - по почте: пароль дважды, затем письмо для подтверждения почты;
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
  const lastNameInput = form.elements.namedItem("lastName");
  const emailInput = form.elements.namedItem("email");
  const passwordInput = form.elements.namedItem("password");
  const confirmInput = form.elements.namedItem("passwordConfirm");

  const RESEND_COOLDOWN_SEC = 60;
  let pendingEmail = "";
  let cooldownTimer = null;

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

  function showCheckEmail(email) {
    pendingEmail = email;
    checkEmail.textContent = email;
    form.hidden = true;
    if (googleBtn) googleBtn.hidden = true;
    if (divider) divider.hidden = true;
    if (switchEl) switchEl.hidden = true;
    check.hidden = false;
    startCooldown();
  }

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
    const lastName = String(lastNameInput.value || "").trim();
    const email = String(emailInput.value || "").trim().toLowerCase();
    const password = String(passwordInput.value || "");
    const confirm = String(confirmInput.value || "");

    const firstNameError = BooklyAuthUI.validateRequired(firstName, "Имя");
    const emailError = BooklyAuthUI.validateEmail(email);
    const passwordError = BooklyAuthUI.validatePassword(password, 8);
    const confirmError = !passwordError && password !== confirm ? "Пароли не совпадают." : "";

    if (firstNameError) BooklyAuthUI.setFieldError(firstNameInput, firstNameError);
    if (emailError) BooklyAuthUI.setFieldError(emailInput, emailError);
    if (passwordError) BooklyAuthUI.setFieldError(passwordInput, passwordError);
    if (confirmError) BooklyAuthUI.setFieldError(confirmInput, confirmError);
    if (firstNameError || emailError || passwordError || confirmError) return;

    BooklyAuthUI.setFormDisabled(form, true);
    BooklyAuthUI.setButtonLoading(submitBtn, true, "Создание…", "Создать аккаунт");

    try {
      const { data, error } = await BooklyAuth.signUp(email, password, {
        first_name: firstName,
        last_name: lastName,
        full_name: [firstName, lastName].filter(Boolean).join(" "),
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

      // Подтверждение почты выключено в Supabase — сразу внутрь.
      if (data?.session) {
        await BooklyOrg.redirectAfterAuth();
        return;
      }

      // Подтверждение включено (или почта уже зарегистрирована — Supabase
      // намеренно не говорит об этом): просим открыть письмо.
      showCheckEmail(email);
    } catch (error) {
      BooklyAuthErrors.logError("register:exception", error);
      BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
    } finally {
      BooklyAuthUI.setFormDisabled(form, false);
      BooklyAuthUI.setButtonLoading(submitBtn, false, "Создание…", "Создать аккаунт");
    }
  });
})();
