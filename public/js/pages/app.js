/**
 * Bookly — панель управления (защищена авторизацией и компанией)
 */

(async () => {
  const app = document.body;
  const authLoader = document.getElementById("auth-loader");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const sidebarToggle = document.getElementById("sidebar-toggle");
  const logoutBtn = document.getElementById("logout-btn");

  const userNameEl = document.getElementById("user-name");
  const userEmailEl = document.getElementById("user-email");
  const userAvatarEl = document.getElementById("user-avatar");
  const workspaceNameEl = document.getElementById("workspace-name");
  const workspaceTypeEl = document.getElementById("workspace-type");
  const topbarOrgEl = document.getElementById("topbar-org-name");

  const hideLoader = () => {
    authLoader?.classList.add("is-hidden");
    authLoader?.setAttribute("hidden", "");
    app.classList.remove("is-loading");
    BooklyAuth.log("app: loader hidden");
  };

  const showUser = (user) => {
    const displayName = BooklyAuth.formatUserName(user);
    userNameEl.textContent = displayName;
    userEmailEl.textContent = user.email || "—";
    userAvatarEl.textContent = displayName.charAt(0).toUpperCase();
  };

  const showOrganization = (org) => {
    workspaceNameEl.textContent = org.name;
    workspaceTypeEl.textContent = BooklyOrgConstants.getBusinessTypeLabel(org.business_type);
    topbarOrgEl.textContent = org.name;
    document.title = `${org.name} — Bookly`;
  };

  BooklyAuth.log("app: init start");

  const loaderTimeout = setTimeout(hideLoader, 12000);

  let organization = null;

  try {
    const session = await BooklyAuth.requireSession();
    if (!session) return;

    showUser(session.user);

    organization = await BooklyOrg.requireOrganization();
    if (!organization) return;

    showOrganization(organization);

    BooklyAuth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        BooklyAuth.redirectToLogin(booklyPath("/app"));
      }
      if (event === "SIGNED_IN" && nextSession?.user) {
        showUser(nextSession.user);
      }
    });
  } catch (error) {
    BooklyAuthErrors.logError("app:init", error);
    BooklyAuth.redirectToLogin(booklyPath("/app"));
    return;
  } finally {
    clearTimeout(loaderTimeout);
    hideLoader();
  }

  // Если Pro закончился, мастера сверх лимита Free ставятся на паузу до загрузки списков.
  const pausedStaff = await BooklySubscription.syncPlanLimits(organization.id);
  if (pausedStaff > 0) {
    alert(
      `Pro закончился, и вы вернулись на Free (до 5 активных мастеров). ` +
        `${pausedStaff} мастер(ов) поставлено на паузу — записи сохранены. ` +
        `Выбрать, кто из мастеров активен, можно в разделе «Сотрудники».`
    );
  }

  BooklyAppShell.init();
  BooklyServicesUI.init(organization);
  BooklyStaffUI.init(organization);
  BooklyScheduleUI.init(organization);
  BooklyBookingsUI.init(organization);
  BooklyCalendarUI.init(organization);
  BooklyDashboardUI.init(organization);
  BooklyInsightsUI.init(organization);
  BooklyPublicSettingsUI.init(organization);
  BooklyBlacklist.init(organization);
  BooklySubscriptionUI.init(organization);

  const closeSidebar = () => {
    sidebar?.classList.remove("is-open");
    if (overlay) overlay.hidden = true;
  };

  sidebarToggle?.addEventListener("click", () => {
    sidebar?.classList.add("is-open");
    if (overlay) overlay.hidden = false;
  });

  overlay?.addEventListener("click", closeSidebar);

  logoutBtn?.addEventListener("click", async () => {
    BooklyAuthUI.setButtonLoading(logoutBtn, true, "Выход…", "Выйти");
    await BooklyAuth.signOut({ redirect: true });
  });
})();
