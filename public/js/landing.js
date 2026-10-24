/**
 * Bookly — главная страница
 */

(() => {
  // Ссылки из писем Supabase (сброс пароля, вход по ссылке, подтверждение почты),
  // если они открылись на главной, переносим туда, где их обработают.
  const authHash = window.location.hash.slice(1);
  if (/(^|&)type=recovery(&|$)/.test(authHash)) {
    window.location.replace(`/reset-password${window.location.hash}`);
    return;
  }
  if (/(^|&)(access_token|error_code)=/.test(authHash)) {
    window.location.replace(`/login${window.location.hash}`);
    return;
  }

  const header = document.getElementById("header");
  const burger = document.getElementById("burger");
  const nav = document.getElementById("nav");
  const faqList = document.getElementById("faq-list");

  /* Шапка при скролле */
  const onScroll = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Мобильное меню */
  if (burger && nav) {
    burger.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("is-open");
      burger.classList.toggle("is-open", isOpen);
      burger.setAttribute("aria-expanded", String(isOpen));
    });

    // Пункт с выпадающим списком (.nav__trigger) меню не закрывает — он раскрывает список.
    nav.querySelectorAll(".nav__link:not(.nav__trigger), .nav__item").forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("is-open");
        burger.classList.remove("is-open");
        burger.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* FAQ-аккордеон */
  if (faqList) {
    faqList.addEventListener("click", (event) => {
      const button = event.target.closest(".faq-item__question");
      if (!button) return;

      const item = button.closest(".faq-item");
      const isOpen = item.classList.contains("is-open");

      faqList.querySelectorAll(".faq-item").forEach((faqItem) => {
        faqItem.classList.remove("is-open");
        faqItem.querySelector(".faq-item__question")?.setAttribute("aria-expanded", "false");
      });

      if (!isOpen) {
        item.classList.add("is-open");
        button.setAttribute("aria-expanded", "true");
      }
    });
  }

  /* Reveal при скролле */
  const revealElements = document.querySelectorAll(".reveal");

  if (revealElements.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    revealElements.forEach((el) => observer.observe(el));
  } else {
    revealElements.forEach((el) => el.classList.add("is-visible"));
  }
})();
