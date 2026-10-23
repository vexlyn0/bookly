/**
 * Bookly — навигация панели
 */
window.BooklyAppShell = (() => {
  const SECTIONS = {
    dashboard: { title: "Обзор", subtitle: "Обзор" },
    services: { title: "Услуги", subtitle: "Услуги" },
    staff: { title: "Сотрудники", subtitle: "Сотрудники" },
    bookings: { title: "Записи", subtitle: "Записи" },
    "public-booking": { title: "Онлайн-запись", subtitle: "Онлайн-запись" },
    clients: { title: "Клиенты", subtitle: "Клиенты" },
    analytics: { title: "Аналитика", subtitle: "Аналитика" },
    subscription: { title: "Тариф и оплата", subtitle: "Тариф и оплата" },
  };

  function init() {
    const navLinks = document.querySelectorAll(".sidebar__link[data-section]");
    const panels = document.querySelectorAll(".panel");
    const pageTitle = document.getElementById("page-title");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");

    const closeSidebar = () => {
      sidebar?.classList.remove("is-open");
      if (overlay) overlay.hidden = true;
    };

    navLinks.forEach((link) => {
      link.addEventListener("click", () => {
        if (link.disabled) return;

        const section = link.dataset.section;
        if (!section || !SECTIONS[section]) return;

        navLinks.forEach((item) => item.classList.toggle("is-active", item === link));
        panels.forEach((panel) => {
          panel.hidden = panel.dataset.section !== section;
        });

        if (pageTitle) {
          pageTitle.textContent = SECTIONS[section].subtitle;
        }

        closeSidebar();
      });
    });

    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-open-section]");
      if (trigger) open(trigger.dataset.openSection);
    });
  }

  function open(section) {
    document.querySelector(`.sidebar__link[data-section="${section}"]`)?.click();
  }

  return { init, open };
})();
