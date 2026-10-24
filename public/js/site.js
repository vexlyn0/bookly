/**
 * Jazyl — общее для страниц сайта: выпадающее меню и кнопка «Мой кабинет» для вошедших.
 */
(() => {
  // Вошёл в кабинет на этом устройстве — вместо «Войти / Начать бесплатно» показываем «Мой кабинет».
  // Сессию не трогаем: просто читаем, есть ли она (ключ задан в public/js/auth/client.js).
  function hasSession() {
    try {
      const raw = localStorage.getItem("bookly-auth");
      if (!raw) return false;
      const session = JSON.parse(raw);
      return Boolean(session?.refresh_token || session?.currentSession?.refresh_token);
    } catch {
      return false;
    }
  }

  if (hasSession()) {
    document.querySelectorAll("[data-guest]").forEach((el) => {
      el.hidden = true;
    });
    document.querySelectorAll("[data-user]").forEach((el) => {
      el.hidden = false;
    });
  }

  // Выпадающие пункты меню: на компьютере открываются и при наведении (CSS), клик — для телефона и клавиатуры.
  const groups = [...document.querySelectorAll(".nav__group")];

  function closeAll(except) {
    groups.forEach((group) => {
      if (group === except) return;
      group.classList.remove("is-open");
      group.querySelector(".nav__trigger")?.setAttribute("aria-expanded", "false");
    });
  }

  groups.forEach((group) => {
    const trigger = group.querySelector(".nav__trigger");
    trigger?.addEventListener("click", () => {
      const open = !group.classList.contains("is-open");
      closeAll(group);
      group.classList.toggle("is-open", open);
      trigger.setAttribute("aria-expanded", String(open));
    });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".nav__group")) closeAll();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
})();
