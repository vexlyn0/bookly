/**
 * Bookly — страница регистрации
 */

(async () => {
  const page = document.querySelector(".auth-page");
  const form = document.getElementById("register-form");
  const errorEl = document.getElementById("register-error");
  const successEl = document.getElementById("register-success");
  const submitBtn = document.getElementById("register-submit");

  if (!form) return;

  const firstNameInput = form.elements.namedItem("firstName");
  const lastNameInput = form.elements.namedItem("lastName");
  const emailInput = form.elements.namedItem("email");
  const passwordInput = form.elements.namedItem("password");

  try {
    BooklyAuth.log("register: checking existing session");
    const session = await BooklyAuth.waitForSession({ timeoutMs: 5000 });

    if (session) {
      BooklyAuth.log("register: already authenticated, checking organization");
      await BooklyOrg.redirectAfterAuth();
      return;
    }
  } catch (error) {
    BooklyAuthErrors.logError("register:init", error);
    BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
  } finally {
    BooklyAuthUI.setPageReady(page);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    BooklyAuthUI.hideAlert(errorEl);
    BooklyAuthUI.hideAlert(successEl);
    BooklyAuthUI.clearFieldErrors(form);

    const firstName = String(firstNameInput.value || "").trim();
    const lastName = String(lastNameInput.value || "").trim();
    const email = String(emailInput.value || "").trim();
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
      const { data, error, step } = await BooklyAuth.signUpAndEnter(email, password, {
        first_name: firstName,
        last_name: lastName,
        full_name: [firstName, lastName].filter(Boolean).join(" "),
      });

      BooklyAuth.log("register: signUpAndEnter finished", { step, hasSession: !!data?.session });

      if (error) {
        BooklyAuthErrors.logError("register:submit", error);
      }

      if (data?.session) {
        BooklyAuth.log("register: session ready, checking organization");
        await BooklyOrg.redirectAfterAuth();
        return;
      }

      if (error && BooklyAuthErrors.isEmailSendRateLimit(error)) {
        BooklyAuthUI.showAlert(
          successEl,
          "Аккаунт может быть создан, но письмо не отправлено — лимит Supabase. Попробуйте войти.",
          "success"
        );
        form.reset();
        return;
      }

      if (error) {
        BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
        return;
      }

      BooklyAuthUI.showAlert(
        successEl,
        "Аккаунт создан. Войдите с вашим email и паролем.",
        "success"
      );
      form.reset();
    } catch (error) {
      BooklyAuthErrors.logError("register:exception", error);
      BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
    } finally {
      BooklyAuthUI.setFormDisabled(form, false);
      BooklyAuthUI.setButtonLoading(submitBtn, false, "Создание…", "Создать аккаунт");
    }
  });
})();
