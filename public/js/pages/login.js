/**
 * Bookly — страница входа
 */

(async () => {
  BooklyAuthUI.bindPasswordToggles(document);
  const page = document.querySelector(".auth-page");
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");

  if (!form) return;

  // Адрес возврата (например, /admin) сохраняем и для «Забыли пароль?».
  const next = new URLSearchParams(window.location.search).get("next");
  const forgotLink = document.getElementById("login-forgot-link");
  if (next && forgotLink) forgotLink.href = `/forgot-password?next=${encodeURIComponent(next)}`;

  const infoEl = document.getElementById("login-info");
  const resendBtn = document.getElementById("login-resend");
  const googleBtn = document.getElementById("login-google");

  // Вернулись по ссылке из письма, но сессия не создалась (ссылка устарела)
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (hashParams.get("error_code") === "otp_expired") {
    BooklyAuthUI.showAlert(errorEl, "Ссылка из письма устарела. Войдите — и мы отправим новую.");
  }

  const emailInput = form.elements.namedItem("email");
  const passwordInput = form.elements.namedItem("password");

  try {
    BooklyAuth.log("login: checking existing session");
    const session = await BooklyAuth.waitForSession({ timeoutMs: 5000 });

    if (session) {
      BooklyAuth.log("login: already authenticated, checking organization");
      await BooklyOrg.redirectAfterAuth();
      return;
    }
  } catch (error) {
    BooklyAuthErrors.logError("login:init", error);
    BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
  } finally {
    BooklyAuthUI.setPageReady(page);
  }

  googleBtn?.addEventListener("click", async () => {
    BooklyAuthUI.hideAlert(errorEl);
    googleBtn.disabled = true;
    const { error } = await BooklyAuth.signInWithGoogle();
    if (error) {
      googleBtn.disabled = false;
      BooklyAuthUI.showAlert(
        errorEl,
        /provider is not enabled|Unsupported provider/i.test(error.message || "")
          ? "Вход через Google пока не включён. Войдите по почте."
          : BooklyAuthErrors.fromError(error)
      );
    }
  });

  resendBtn?.addEventListener("click", async () => {
    const email = String(emailInput.value || "").trim();
    if (!email) return;
    resendBtn.disabled = true;
    BooklyAuthUI.hideAlert(errorEl);
    const { error } = await BooklyAuth.resendConfirmation(email);
    if (error) {
      resendBtn.disabled = false;
      BooklyAuthUI.showAlert(
        errorEl,
        BooklyAuthErrors.isEmailSendRateLimit(error)
          ? "Слишком много писем подряд. Подождите немного."
          : BooklyAuthErrors.fromError(error)
      );
      return;
    }
    resendBtn.hidden = true;
    infoEl.textContent = `Письмо отправлено на ${email}. Откройте ссылку — и вы сразу войдёте.`;
    infoEl.hidden = false;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    BooklyAuthUI.hideAlert(errorEl);
    BooklyAuthUI.clearFieldErrors(form);

    const email = String(emailInput.value || "").trim();
    const password = String(passwordInput.value || "");

    const emailError = BooklyAuthUI.validateEmail(email);
    const passwordError = BooklyAuthUI.validatePassword(password, 1);

    if (emailError) BooklyAuthUI.setFieldError(emailInput, emailError);
    if (passwordError) BooklyAuthUI.setFieldError(passwordInput, passwordError);
    if (emailError || passwordError) return;

    BooklyAuthUI.setFormDisabled(form, true);
    BooklyAuthUI.setButtonLoading(submitBtn, true, "Вход…", "Войти");

    try {
      const { data, error } = await BooklyAuth.signIn(email, password);

      if (error) {
        BooklyAuthErrors.logError("signIn", error);
        BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
        const notConfirmed = error.code === "email_not_confirmed" || /not confirmed/i.test(error.message || "");
        if (resendBtn) {
          resendBtn.hidden = !notConfirmed;
          resendBtn.disabled = false;
        }
        return;
      }

      if (data?.session) {
        BooklyAuth.log("login: success, checking organization");
        await BooklyOrg.redirectAfterAuth();
        return;
      }

      BooklyAuthUI.showAlert(errorEl, "Не удалось создать сессию. Попробуйте снова.");
    } catch (error) {
      BooklyAuthErrors.logError("signIn:exception", error);
      BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
    } finally {
      BooklyAuthUI.setFormDisabled(form, false);
      BooklyAuthUI.setButtonLoading(submitBtn, false, "Вход…", "Войти");
    }
  });
})();
