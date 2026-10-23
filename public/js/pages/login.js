/**
 * Bookly — страница входа
 */

(async () => {
  const page = document.querySelector(".auth-page");
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");

  if (!form) return;

  // Адрес возврата (например, /admin) сохраняем и для «Забыли пароль?».
  const next = new URLSearchParams(window.location.search).get("next");
  const forgotLink = document.getElementById("login-forgot-link");
  if (next && forgotLink) forgotLink.href = `/forgot-password?next=${encodeURIComponent(next)}`;

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
