/**
 * Bookly — восстановление пароля
 *   /forgot-password — письмо со ссылкой (Supabase resetPasswordForEmail)
 *   /reset-password  — ссылка из письма: новый пароль и вход
 */

(async () => {
  const forgotForm = document.getElementById("forgot-form");
  const resetForm = document.getElementById("reset-form");

  // ---------------------------------------------------------------------------
  // Забыли пароль
  // ---------------------------------------------------------------------------

  if (forgotForm) {
    const emailInput = forgotForm.elements.namedItem("email");
    const errorEl = document.getElementById("forgot-error");
    const successEl = document.getElementById("forgot-success");
    const submitBtn = document.getElementById("forgot-submit");

    // Сохраняем адрес возврата (например, /admin) для ссылки «Войти».
    const next = new URLSearchParams(window.location.search).get("next");
    if (next) {
      document.getElementById("forgot-login-link").href = `/login?next=${encodeURIComponent(next)}`;
    }

    forgotForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      BooklyAuthUI.hideAlert(errorEl);
      successEl.hidden = true;
      BooklyAuthUI.clearFieldErrors(forgotForm);

      const email = String(emailInput.value || "").trim();
      const emailError = BooklyAuthUI.validateEmail(email);
      if (emailError) {
        BooklyAuthUI.setFieldError(emailInput, emailError);
        return;
      }

      BooklyAuthUI.setButtonLoading(submitBtn, true, "Отправляем…", "Отправить ссылку");

      try {
        const supabase = await BooklyAuth.getClient();
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}${booklyPath("/reset-password")}`,
        });

        if (error) {
          const tooMany = error.status === 429 || /rate limit/i.test(error.message || "");
          BooklyAuthUI.showAlert(
            errorEl,
            tooMany
              ? "Слишком много писем подряд. Подождите немного и попробуйте снова."
              : BooklyAuthErrors.fromError(error)
          );
          return;
        }

        // Не сообщаем, есть ли такой аккаунт, — чтобы нельзя было перебирать почты.
        successEl.textContent =
          "Если аккаунт с этой почтой есть, письмо уже отправлено. Откройте ссылку из письма — она действует ограниченное время. Проверьте и папку «Спам».";
        successEl.hidden = false;
      } catch (error) {
        BooklyAuthErrors.logError("forgot", error);
        BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
      } finally {
        BooklyAuthUI.setButtonLoading(submitBtn, false, "Отправляем…", "Отправить ссылку");
      }
    });
    return;
  }

  // ---------------------------------------------------------------------------
  // Новый пароль по ссылке из письма
  // ---------------------------------------------------------------------------

  if (!resetForm) return;

  const subtitle = document.getElementById("reset-subtitle");
  const invalid = document.getElementById("reset-invalid");
  const invalidText = document.getElementById("reset-invalid-text");
  const errorEl = document.getElementById("reset-error");
  const submitBtn = document.getElementById("reset-submit");
  const passwordInput = resetForm.elements.namedItem("password");
  BooklyAuthUI.bindPasswordToggles(resetForm);

  const showInvalid = (message) => {
    subtitle.textContent = "Ссылка не сработала";
    invalidText.textContent = message;
    invalid.hidden = false;
    resetForm.hidden = true;
  };

  // Supabase кладёт ошибку в адрес: #error=access_denied&error_code=otp_expired
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const linkError = hashParams.get("error_code") || queryParams.get("error_code") || hashParams.get("error");
  if (linkError) {
    showInvalid(
      linkError === "otp_expired"
        ? "Ссылка устарела или уже использована. Запросите новую."
        : "Ссылка недействительна. Запросите новую."
    );
    return;
  }

  let session = null;
  try {
    // Клиент сам забирает токен из ссылки (detectSessionInUrl).
    await BooklyAuth.getClient();
    session = await BooklyAuth.waitForSession({ timeoutMs: 6000 });
  } catch (error) {
    BooklyAuthErrors.logError("reset:init", error);
  }

  if (!session) {
    showInvalid("Ссылка недействительна или устарела. Запросите новую.");
    return;
  }

  subtitle.textContent = `Аккаунт ${session.user?.email || ""}. Придумайте новый пароль.`;
  resetForm.hidden = false;
  passwordInput.focus();

  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    BooklyAuthUI.hideAlert(errorEl);
    BooklyAuthUI.clearFieldErrors(resetForm);

    const password = String(passwordInput.value || "");

    // Те же правила, что при регистрации
    const passwordError = BooklyAuthUI.validatePassword(password, 8);
    if (passwordError) {
      BooklyAuthUI.setFieldError(passwordInput, passwordError);
      return;
    }

    BooklyAuthUI.setButtonLoading(submitBtn, true, "Сохраняем…", "Сохранить и войти");

    try {
      const supabase = await BooklyAuth.getClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        const same = /different from the old|same password/i.test(error.message || "");
        BooklyAuthUI.showAlert(
          errorEl,
          same ? "Новый пароль должен отличаться от старого." : BooklyAuthErrors.fromError(error)
        );
        return;
      }

      subtitle.textContent = "Пароль сохранён. Входим…";
      resetForm.hidden = true;
      await BooklyOrg.redirectAfterAuth();
    } catch (error) {
      BooklyAuthErrors.logError("reset:update", error);
      BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
    } finally {
      BooklyAuthUI.setButtonLoading(submitBtn, false, "Сохраняем…", "Сохранить и войти");
    }
  });
})();
