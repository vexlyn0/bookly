/**
 * Bookly — создание компании (onboarding)
 */

(async () => {
  const page = document.querySelector(".onboarding-page");
  const form = document.getElementById("onboarding-form");
  const errorEl = document.getElementById("onboarding-error");
  const submitBtn = document.getElementById("onboarding-submit");
  const businessTypeSelect = document.getElementById("business-type");
  const timezoneSelect = document.getElementById("timezone");

  if (!form) return;

  BooklyOrgConstants.populateBusinessTypeSelect(businessTypeSelect);
  BooklyOrgConstants.populateTimezoneSelect(timezoneSelect);

  try {
    const session = await BooklyAuth.waitForSession({ timeoutMs: 8000 });

    if (!session) {
      BooklyAuth.redirectToLogin(booklyPath("/onboarding"));
      return;
    }

    const org = await BooklyOrg.getMyOrganization();
    if (org) {
      BooklyAuth.log("onboarding: org exists, redirect to app");
      window.location.replace(booklyPath("/app"));
      return;
    }
  } catch (error) {
    BooklyAuthErrors.logError("onboarding:init", error);
    BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
  } finally {
    page?.classList.remove("onboarding-page--checking");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    BooklyAuthUI.hideAlert(errorEl);
    BooklyAuthUI.clearFieldErrors(form);

    const nameInput = form.elements.namedItem("name");
    const name = String(nameInput.value || "").trim();
    const businessType = String(form.elements.namedItem("businessType").value || "");
    const timezone = String(form.elements.namedItem("timezone").value || "Asia/Almaty");

    const nameError = BooklyAuthUI.validateRequired(name, "Название компании");
    if (name.length > 0 && name.length < 2) {
      BooklyAuthUI.setFieldError(nameInput, "Название должно содержать минимум 2 символа.");
    } else if (nameError) {
      BooklyAuthUI.setFieldError(nameInput, nameError);
    }

    if (nameError || name.length < 2) return;

    BooklyAuthUI.setFormDisabled(form, true);
    BooklyAuthUI.setButtonLoading(submitBtn, true, "Создание…", "Создать компанию");

    try {
      const { data, error } = await BooklyOrg.createOrganization({
        name,
        businessType,
        timezone,
      });

      if (error) {
        BooklyAuthErrors.logError("onboarding:create", error);

        if (error.code === "23505" || /already belongs/i.test(error.message)) {
          window.location.replace(booklyPath("/app"));
          return;
        }

        BooklyAuthUI.showAlert(errorEl, error.message || BooklyAuthErrors.fromError(error));
        return;
      }

      if (data) {
        BooklyAuth.log("onboarding: created, redirect to app", data.name);
        window.location.replace(booklyPath("/app"));
      }
    } catch (error) {
      BooklyAuthErrors.logError("onboarding:exception", error);
      BooklyAuthUI.showAlert(errorEl, BooklyAuthErrors.fromError(error));
    } finally {
      BooklyAuthUI.setFormDisabled(form, false);
      BooklyAuthUI.setButtonLoading(submitBtn, false, "Создание…", "Создать компанию");
    }
  });
})();
