/**
 * Jazyl — страницы сайта (не кабинета): общая шапка с меню, подвал, страницы разделов.
 *
 * Страницы собираются на сервере — поисковики видят готовый текст.
 * Шапка и подвал главной (public/index.html) подставляются отсюда же,
 * чтобы меню было одно на весь сайт.
 */

const config = require("../config");
const { AUDIENCES } = require("./audiences");
const { FEATURES } = require("./features");
const { TOOLS } = require("./tools");
const { findLegal, LEGAL_PATHS, CONTACTS } = require("./legal");

const LOGO_MARK =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<rect x="4" y="5.5" width="16" height="14.5" rx="3.5" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M8.5 3.5v3.5M15.5 3.5v3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M8.5 13.2l2.6 2.6 4.6-5.2" stroke="#F0997B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
  "</svg>";

const CHEVRON =
  '<svg class="nav__chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Меню сайта. Пункт с items — выпадающий список. */
function menu() {
  return [
    {
      label: "Возможности",
      items: FEATURES.map((f) => ({ label: f.menu, hint: f.menuHint, href: `/vozmozhnosti/${f.slug}` })),
    },
    {
      label: "Кому подойдёт",
      items: AUDIENCES.map((a) => ({ label: a.menu, hint: a.menuHint, href: `/dlya/${a.slug}` })),
    },
    {
      label: "Инструменты",
      items: TOOLS.map((t) => ({ label: t.menu, hint: t.menuHint, href: `/instrumenty/${t.slug}` })),
    },
    { label: "Цены", href: "/#pricing" },
    { label: "Вопросы", href: "/#faq" },
  ];
}

function renderHeader(currentPath = "/") {
  const nav = menu()
    .map((item, index) => {
      if (!item.items) {
        return `<a href="${item.href}" class="nav__link">${escapeHtml(item.label)}</a>`;
      }
      const active = item.items.some((sub) => sub.href === currentPath);
      return `
        <div class="nav__group">
          <button type="button" class="nav__link nav__trigger${active ? " is-current" : ""}" aria-expanded="false" aria-controls="nav-panel-${index}">${escapeHtml(item.label)}${CHEVRON}</button>
          <div class="nav__panel" id="nav-panel-${index}">
            ${item.items
              .map(
                (sub) => `
              <a href="${sub.href}" class="nav__item${sub.href === currentPath ? " is-current" : ""}">
                <span class="nav__item-title">${escapeHtml(sub.label)}</span>
                <span class="nav__item-hint">${escapeHtml(sub.hint)}</span>
              </a>`
              )
              .join("")}
          </div>
        </div>`;
    })
    .join("");

  return `
  <header class="header" id="header">
    <div class="container header__inner">
      <a href="/" class="logo" aria-label="Jazyl — на главную">
        <span class="logo__mark">${LOGO_MARK}</span>
        Jazyl
      </a>

      <nav class="nav" id="nav" aria-label="Основная навигация">
        ${nav}
        <a href="/register" class="nav__link nav__link--mobile nav__link--cta" data-guest>Начать бесплатно</a>
        <a href="/login" class="nav__link nav__link--mobile" data-guest>Войти</a>
        <a href="/app" class="nav__link nav__link--mobile" data-user hidden>Мой кабинет</a>
      </nav>

      <div class="header__actions">
        <a href="/login" class="btn btn--ghost btn--sm header__login" data-guest>Войти</a>
        <a href="/register" class="btn btn--light btn--sm" data-guest>Начать бесплатно</a>
        <a href="/app" class="btn btn--light btn--sm" data-user hidden>Мой кабинет →</a>
      </div>

      <button class="burger" id="burger" type="button" aria-label="Открыть меню" aria-expanded="false" aria-controls="nav">
        <span class="burger__icon" aria-hidden="true"><span class="burger__line"></span><span class="burger__line"></span></span>
        <span class="burger__text">Меню</span>
      </button>
    </div>
  </header>`;
}

/** Контакты в подвале — только заполненные в contacts.js. */
function footerContacts() {
  const items = [];
  if (CONTACTS.instagram) {
    items.push(`<a href="https://instagram.com/${escapeHtml(CONTACTS.instagram)}" target="_blank" rel="noopener">Instagram</a>`);
  }
  if (CONTACTS.whatsapp) {
    items.push(`<a href="https://wa.me/${CONTACTS.whatsapp.replace(/\D/g, "")}" target="_blank" rel="noopener">WhatsApp ${escapeHtml(CONTACTS.whatsapp)}</a>`);
  }
  if (CONTACTS.telegram) {
    items.push(`<a href="https://t.me/${escapeHtml(CONTACTS.telegram)}" target="_blank" rel="noopener">Telegram</a>`);
  }
  if (CONTACTS.email) items.push(`<a href="mailto:${escapeHtml(CONTACTS.email)}">${escapeHtml(CONTACTS.email)}</a>`);
  return items.length ? `<nav class="footer__links footer__links--contacts" aria-label="Контакты">${items.join("")}</nav>` : "";
}

function renderFooter() {
  const audiences = AUDIENCES.map((a) => `<a href="/dlya/${a.slug}">${escapeHtml(a.menu)}</a>`).join("");
  const features = FEATURES.map((f) => `<a href="/vozmozhnosti/${f.slug}">${escapeHtml(f.menu)}</a>`).join("");
  const tools = TOOLS.map((t) => `<a href="/instrumenty/${t.slug}">${escapeHtml(t.menu)}</a>`).join("");
  return `
  <footer class="footer">
    <div class="container footer__inner">
      <a href="/" class="logo">
        <span class="logo__mark">${LOGO_MARK}</span>
        Jazyl
      </a>
      <nav class="footer__links" aria-label="Подвал">
        <a href="/#features">Возможности</a>
        <a href="/#pricing">Цены</a>
        <a href="/#faq">Вопросы</a>
        <a href="/login">Войти</a>
      </nav>
      <nav class="footer__links footer__links--wide" aria-label="Возможности">
        ${features}
      </nav>
      <nav class="footer__links footer__links--wide" aria-label="Инструменты">
        ${tools}
      </nav>
      <nav class="footer__links footer__links--wide" aria-label="Кому подойдёт">
        ${audiences}
      </nav>
      ${footerContacts()}
      <div class="footer__bottom">
        <p class="footer__copy">© 2026 Jazyl · Онлайн-запись для салонов и мастеров Казахстана</p>
        <nav class="footer__legal" aria-label="Документы">
          <a href="/privacy">Политика конфиденциальности</a>
          <a href="/terms">Пользовательское соглашение</a>
        </nav>
      </div>
    </div>
  </footer>`;
}

function absoluteUrl(path) {
  return config.publicUrl ? `${config.publicUrl.replace(/\/$/, "")}${path}` : path;
}

function renderPage({ path, title, description, body, scripts = [], fonts = "" }) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(absoluteUrl(path))}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta name="theme-color" content="#0d0c14">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800${fonts}&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="/css/landing.css">
  <link rel="stylesheet" href="/css/site.css">
</head>
<body>
${renderHeader(path)}

  <main>
${body}
  </main>
${renderFooter()}

  <script src="/js/landing.js"></script>
  <script src="/js/site.js"></script>
${scripts.map((src) => `  <script src="${src}"></script>`).join("\n")}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Общие блоки страниц
// ---------------------------------------------------------------------------

function renderFaq(items) {
  return `
    <section class="section">
      <div class="container container--narrow">
        <div class="section__header">
          <p class="eyebrow reveal">Вопросы</p>
          <h2 class="section__title reveal">Частые вопросы</h2>
        </div>
        <div class="faq" id="faq-list">
          ${items
            .map(
              ([q, a]) => `
          <div class="faq-item">
            <button class="faq-item__question" type="button" aria-expanded="false">${escapeHtml(q)}<span class="faq-item__icon" aria-hidden="true"></span></button>
            <div class="faq-item__answer"><div class="faq-item__answer-inner"><p>${escapeHtml(a)}</p></div></div>
          </div>`
            )
            .join("")}
        </div>
      </div>
    </section>`;
}

function renderCta() {
  return `
    <section class="cta">
      <div class="container">
        <div class="cta__card reveal">
          <h2 class="cta__title">Запись 24/7 — без звонков и переписки</h2>
          <p class="cta__text">Бесплатно навсегда до 5 мастеров. Настройка — 10 минут.</p>
          <div class="cta__actions">
            <a href="/register" class="btn btn--light btn--lg" data-guest>Начать бесплатно</a>
            <a href="/app" class="btn btn--light btn--lg" data-user hidden>Мой кабинет</a>
          </div>
        </div>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// «Кому подойдёт»
// ---------------------------------------------------------------------------

/** Пример страницы записи в цвете салона — как его увидит клиент. */
function renderDemo(demo) {
  const days = [
    ["пн", 21],
    ["вт", 22],
    ["ср", 23],
    ["чт", 24],
    ["вс", 27],
  ];
  const slots = ["10:00", "11:45", demo.time, "17:00"];
  return `
    <div class="demo-book" aria-label="Пример страницы записи">
      <p class="demo-book__url">jazyl.kz/book/…</p>
      <p class="demo-book__name">${escapeHtml(demo.name)}</p>
      <p class="demo-book__sub">${escapeHtml(demo.sub)}</p>
      <p class="demo-book__label">Услуга</p>
      ${demo.services
        .map(
          ([name, duration, price], i) => `
        <div class="demo-book__service${i === 0 ? " is-selected" : ""}">
          <span><b>${escapeHtml(name)}</b><i>${escapeHtml(duration)}</i></span>
          <span class="demo-book__price">${escapeHtml(price)}</span>
        </div>`
        )
        .join("")}
      <p class="demo-book__label">Мастер: ${escapeHtml(demo.master)}</p>
      <div class="demo-book__days">
        ${days
          .map(
            ([w, d], i) =>
              `<span class="${i === 1 ? "is-selected" : ""}${i === 4 ? " is-off" : ""}"><i>${w}</i>${d}</span>`
          )
          .join("")}
      </div>
      <div class="demo-book__slots">
        ${slots
          .map((t, i) => `<span class="${t === demo.time ? "is-selected" : ""}${i === 1 ? " is-busy" : ""}">${t}</span>`)
          .join("")}
      </div>
      <div class="demo-book__cta">Записаться · вт, 22 · ${escapeHtml(demo.time)}</div>
    </div>`;
}

function renderAudience(audience) {
  const others = AUDIENCES.filter((a) => a.slug !== audience.slug);
  const body = `
    <section class="page-hero">
      <div class="container page-hero__inner">
        <div class="page-hero__text">
          <nav class="crumbs" aria-label="Навигация">
            <a href="/">Главная</a><span>/</span><span>Кому подойдёт</span><span>/</span><span>${escapeHtml(audience.menu)}</span>
          </nav>
          <p class="eyebrow">${escapeHtml(audience.eyebrow)}</p>
          <h1 class="page-hero__title">${escapeHtml(audience.h1)}</h1>
          <p class="page-hero__lead">${escapeHtml(audience.lead)}</p>
          <div class="page-hero__actions">
            <a href="/register" class="btn btn--primary btn--lg" data-guest>Создать ссылку для записи</a>
            <a href="/app" class="btn btn--primary btn--lg" data-user hidden>Открыть мой кабинет</a>
          </div>
          <p class="page-hero__note">Бесплатно до 5 мастеров · клиенту не нужна регистрация</p>
        </div>
        <div class="page-hero__demo">
          ${renderDemo(audience.demo)}
          <p class="page-hero__caption">Пример страницы записи · услуги и цены задаёт мастер</p>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section__header">
          <p class="eyebrow reveal">Знакомо?</p>
          <h2 class="section__title reveal">Что мешает принимать больше клиентов</h2>
        </div>
        <div class="pain__grid">
          ${audience.pains
            .map(
              ([problem, solution], i) => `
          <article class="pain-card reveal${i ? ` reveal--delay-${i}` : ""}">
            <p class="pain-card__problem">${escapeHtml(problem)}</p>
            <p class="pain-card__solution"><span>Jazyl</span>${escapeHtml(solution)}</p>
          </article>`
            )
            .join("")}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section__header">
          <p class="eyebrow reveal">Как начать</p>
          <h2 class="section__title reveal">Первая онлайн-запись — сегодня</h2>
        </div>
        <ol class="steps">
          ${audience.steps
            .map(
              ([title, text], i) => `
          <li class="step reveal${i ? ` reveal--delay-${i}` : ""}">
            <span class="step__num">${i + 1}</span>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(text)}</p>
          </li>`
            )
            .join("")}
        </ol>
      </div>
    </section>

    ${renderFaq(audience.faq)}

    <section class="section section--tight">
      <div class="container">
        <p class="eyebrow">Jazyl подойдёт и для других</p>
        <div class="also">
          ${others.map((a) => `<a class="also__link" href="/dlya/${a.slug}">${escapeHtml(a.menu)} →</a>`).join("")}
        </div>
      </div>
    </section>

    ${renderCta()}`;

  return renderPage({
    path: `/dlya/${audience.slug}`,
    title: audience.title,
    description: audience.description,
    body,
  });
}

// ---------------------------------------------------------------------------
// «Возможности»
// ---------------------------------------------------------------------------

function renderTelegramVisual(visual) {
  const [first, ...rest] = visual.lines;
  return `
    <div class="demo-tg" aria-label="Пример сообщения в Telegram">
      <div class="demo-tg__head"><span class="logo__mark">${LOGO_MARK}</span><b>Jazyl</b><i>бот</i></div>
      <div class="demo-tg__bubble">
        <p><b>${escapeHtml(first)}</b></p>
        ${rest.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
      </div>
      <div class="demo-tg__buttons">${visual.buttons.map((b) => `<span>${escapeHtml(b)}</span>`).join("")}</div>
    </div>`;
}

function renderListVisual(visual) {
  return `
    <div class="demo-list">
      <p class="demo-list__title">${escapeHtml(visual.title)}</p>
      ${visual.rows
        .map(
          ([title, hint]) => `
        <div class="demo-list__row">
          <span class="demo-list__dot" aria-hidden="true"></span>
          <span><b>${escapeHtml(title)}</b><i>${escapeHtml(hint)}</i></span>
        </div>`
        )
        .join("")}
    </div>`;
}

const SAMPLE_BOOKING = {
  name: "Aura Beauty",
  sub: "Салон в Алматы · запись онлайн",
  master: "Айгерим",
  services: [
    ["Маникюр с покрытием", "1 ч 30 мин", "8 000 ₸"],
    ["Мужская стрижка", "45 мин", "5 000 ₸"],
    ["Коррекция бровей", "45 мин", "5 000 ₸"],
  ],
  time: "15:00",
};

function renderVisual(visual) {
  if (visual.type === "telegram") return renderTelegramVisual(visual);
  if (visual.type === "list") return renderListVisual(visual);
  return renderDemo(SAMPLE_BOOKING);
}

function renderFeature(feature) {
  const others = FEATURES.filter((f) => f.slug !== feature.slug);
  const body = `
    <section class="page-hero">
      <div class="container page-hero__inner">
        <div class="page-hero__text">
          <nav class="crumbs" aria-label="Навигация">
            <a href="/">Главная</a><span>/</span><span>Возможности</span><span>/</span><span>${escapeHtml(feature.menu)}</span>
          </nav>
          <p class="eyebrow">Возможности${feature.pro ? ' <span class="pro-badge">Pro</span>' : ""}</p>
          <h1 class="page-hero__title">${escapeHtml(feature.h1)}</h1>
          <p class="page-hero__lead">${escapeHtml(feature.lead)}</p>
          <div class="page-hero__actions">
            <a href="/register" class="btn btn--primary btn--lg" data-guest>${feature.pro ? "Попробовать Pro бесплатно" : "Начать бесплатно"}</a>
            <a href="/app" class="btn btn--primary btn--lg" data-user hidden>Открыть мой кабинет</a>
          </div>
          <p class="page-hero__note">${
            feature.pro
              ? "Тариф Pro · первые 14 дней бесплатно, без карты"
              : "Есть на бесплатном тарифе · без карты"
          }</p>
        </div>
        <div class="page-hero__demo">
          ${renderVisual(feature.visual)}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section__header">
          <p class="eyebrow reveal">Как это работает</p>
          <h2 class="section__title reveal">${escapeHtml(feature.menu)}</h2>
        </div>
        <div class="points">
          ${feature.points
            .map(
              ([title, text], i) => `
          <article class="feature reveal${i % 3 ? ` reveal--delay-${i % 3}` : ""}">
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(text)}</p>
          </article>`
            )
            .join("")}
        </div>
      </div>
    </section>

    ${renderFaq(feature.faq)}

    <section class="section section--tight">
      <div class="container">
        <p class="eyebrow">Ещё в Jazyl</p>
        <div class="also">
          ${others.map((f) => `<a class="also__link" href="/vozmozhnosti/${f.slug}">${escapeHtml(f.menu)} →</a>`).join("")}
        </div>
      </div>
    </section>

    ${renderCta()}`;

  return renderPage({
    path: `/vozmozhnosti/${feature.slug}`,
    title: feature.title,
    description: feature.description,
    body,
  });
}

function findFeature(slug) {
  return FEATURES.find((f) => f.slug === slug) || null;
}

// ---------------------------------------------------------------------------
// «Инструменты»
// ---------------------------------------------------------------------------

/** Переключатель из кнопок: [[значение, подпись], ...]. Состояние ведёт скрипт инструмента. */
function segmented(group, options) {
  return `<div class="tool__seg" role="group">${options
    .map(([value, label]) => `<button type="button" data-${group}="${value}" aria-pressed="false">${escapeHtml(label)}</button>`)
    .join("")}</div>`;
}

const TOOL_FORMS = {
  "svobodnye-okoshki": () => `
    <form class="tool__form" onsubmit="return false" autocomplete="off">
      <div class="tool__field">
        <span class="tool__label">Когда свободно</span>
        <div class="tool__presets">
          <button type="button" data-preset="today">Сегодня</button>
          <button type="button" data-preset="tomorrow">Завтра</button>
          <button type="button" data-preset="week">Неделя</button>
        </div>
        <div class="ok-days" id="okoshki-days"></div>
        <button type="button" class="tool__add" data-action="add-day">+ Добавить день</button>
      </div>

      <div class="tool__pair">
        <label class="tool__field">
          <span class="tool__label">Услуга</span>
          <select class="tool__input" name="service">
            <option value="">Без подписи</option>
            <option value="manicure">Маникюр</option>
            <option value="pedicure">Педикюр</option>
            <option value="lashes">Ресницы</option>
            <option value="brows">Брови</option>
            <option value="haircut">Стрижка</option>
            <option value="barber">Барбер</option>
            <option value="coloring">Окрашивание</option>
            <option value="hair">Волосы</option>
            <option value="massage">Массаж</option>
            <option value="cosmetology">Косметология</option>
            <option value="sugaring">Шугаринг</option>
            <option value="tattoo">Тату</option>
            <option value="custom">Свой вариант…</option>
          </select>
        </label>
        <label class="tool__field" id="okoshki-service-custom" hidden>
          <span class="tool__label">Своя услуга</span>
          <input class="tool__input" name="serviceCustom" maxlength="24" placeholder="Педикюр + маникюр">
        </label>
      </div>

      <div class="tool__field">
        <span class="tool__label">Фон и стиль</span>
        <div class="ok-styles" id="okoshki-styles"></div>
      </div>

      <div class="tool__pair">
        <div class="tool__field">
          <span class="tool__label">Формат</span>
          ${segmented("format", [["story", "Сторис 9:16"], ["post", "Пост 4:5"]])}
        </div>
        <div class="tool__field">
          <span class="tool__label">Текст на картинке</span>
          ${segmented("lang", [["ru", "Русский"], ["kk", "Қазақша"]])}
        </div>
      </div>

      <label class="tool__field">
        <span class="tool__label">Имя или @ник</span>
        <input class="tool__input" name="nick" maxlength="32" placeholder="@aigerim.nails">
      </label>

      <div class="tool__field">
        <span class="tool__label">Как записаться</span>
        ${segmented("how", [["link", "Ссылка в шапке профиля"], ["direct", "Пишите в директ"], ["whatsapp", "WhatsApp"], ["custom", "Свой текст"]])}
        <input class="tool__input" id="okoshki-whatsapp" name="whatsapp" maxlength="24" placeholder="+7 701 000 00 00" inputmode="tel" hidden>
        <input class="tool__input" id="okoshki-custom" name="custom" maxlength="60" placeholder="Запись по телефону +7 701 000 00 00" hidden>
      </div>

      <label class="tool__field">
        <span class="tool__label">Акция <span class="tool__optional">— необязательно</span></span>
        <input class="tool__input" name="promo" maxlength="32" placeholder="−10% на эти окошки">
      </label>
    </form>

    <div class="tool__preview">
      <p class="tool__preview-title">Предпросмотр</p>
      <canvas class="tool__canvas" id="okoshki-canvas" width="1080" height="1920" aria-label="Предпросмотр картинки"></canvas>
      <button type="button" class="btn btn--primary btn--full" id="okoshki-download">Скачать картинку</button>
      <div class="tool__actions">
        <button type="button" class="btn btn--ghost" id="okoshki-share" hidden>Поделиться</button>
        <button type="button" class="btn btn--ghost" id="okoshki-copy">Скопировать текст</button>
      </div>
      <p class="tool__privacy">Картинка собирается прямо в браузере — мы ничего не сохраняем и никуда не отправляем.</p>
    </div>`,

  "zapis-otkryta": () => `
    <form class="tool__form" onsubmit="return false" autocomplete="off">
      <label class="tool__field">
        <span class="tool__label">Месяц</span>
        <select class="tool__input" name="month"></select>
      </label>

      <div class="tool__field">
        <span class="tool__label">Рабочие дни</span>
        <div class="tool__presets">
          <button type="button" data-days="weekdays" aria-pressed="false">Пн–Пт</button>
          <button type="button" data-days="six" aria-pressed="false">Пн–Сб</button>
          <button type="button" data-days="all" aria-pressed="false">Каждый день</button>
          <button type="button" data-days="twotwo" aria-pressed="false">2 через 2</button>
          <button type="button" data-days="none" aria-pressed="false">Очистить</button>
        </div>
        <div class="zc" id="zapis-calendar"></div>
        <span class="tool__hint">Нажмите на день, чтобы отметить или убрать его.</span>
      </div>

      <div class="tool__pair">
        <label class="tool__field">
          <span class="tool__label">Услуга или имя</span>
          <input class="tool__input" name="label" maxlength="40" placeholder="Маникюр">
        </label>
        <label class="tool__field">
          <span class="tool__label">Заголовок</span>
          <input class="tool__input" name="title" maxlength="40" placeholder="Запись открыта">
        </label>
      </div>

      <label class="tool__field">
        <span class="tool__label">Акция <span class="tool__optional">— необязательно</span></span>
        <input class="tool__input" name="promo" maxlength="40" placeholder="−10% на первые 3 записи">
      </label>

      <div class="tool__field">
        <span class="tool__label">Фон и стиль</span>
        <div class="ok-styles" id="zapis-styles"></div>
      </div>

      <div class="tool__pair">
        <div class="tool__field">
          <span class="tool__label">Формат</span>
          ${segmented("format", [["story", "Сторис 9:16"], ["post", "Пост 4:5"]])}
        </div>
        <div class="tool__field">
          <span class="tool__label">Текст на картинке</span>
          ${segmented("lang", [["ru", "Русский"], ["kk", "Қазақша"]])}
        </div>
      </div>

      <label class="tool__field">
        <span class="tool__label">Имя или @ник</span>
        <input class="tool__input" name="nick" maxlength="32" placeholder="@aigerim.nails">
      </label>

      <div class="tool__field">
        <span class="tool__label">Как записаться</span>
        ${segmented("how", [["link", "Ссылка в шапке профиля"], ["direct", "Пишите в директ"], ["whatsapp", "WhatsApp"], ["custom", "Свой текст"]])}
        <input class="tool__input" id="zapis-whatsapp" name="whatsapp" maxlength="24" placeholder="+7 701 000 00 00" inputmode="tel" hidden>
        <input class="tool__input" id="zapis-custom" name="custom" maxlength="60" placeholder="Запись по телефону +7 701 000 00 00" hidden>
      </div>

      <label class="tool__field">
        <span class="tool__label">QR-код на запись <span class="tool__optional">— необязательно</span></span>
        <input class="tool__input" name="qr" maxlength="200" placeholder="Ссылка на запись, @instagram или номер WhatsApp">
      </label>
    </form>

    <div class="tool__preview">
      <p class="tool__preview-title">Предпросмотр</p>
      <canvas class="tool__canvas" id="zapis-canvas" width="1080" height="1920" aria-label="Предпросмотр картинки"></canvas>
      <button type="button" class="btn btn--primary btn--full" id="zapis-download">Скачать картинку</button>
      <div class="tool__actions">
        <button type="button" class="btn btn--ghost" id="zapis-share" hidden>Поделиться</button>
        <button type="button" class="btn btn--ghost" id="zapis-copy">Скопировать текст</button>
      </div>
      <p class="tool__privacy">Картинка собирается прямо в браузере — мы ничего не сохраняем и никуда не отправляем.</p>
    </div>`,

  "podarochnyy-sertifikat": () => `
    <form class="tool__form" onsubmit="return false" autocomplete="off">
      <label class="tool__field">
        <span class="tool__label">Название салона или мастера</span>
        <input class="tool__input" name="salon" maxlength="40" placeholder="Nail studio Aru">
      </label>

      <div class="tool__field">
        <span class="tool__label">Что дарят</span>
        ${segmented("kind", [["amount", "Сумму"], ["service", "Услугу"]])}
        <input class="tool__input" id="sertifikat-amount" name="amount" maxlength="9" placeholder="10000" inputmode="numeric" aria-label="Сумма, ₸">
        <input class="tool__input" id="sertifikat-service" name="service" maxlength="60" placeholder="Маникюр + покрытие" aria-label="Услуга" hidden>
      </div>

      <div class="tool__pair">
        <label class="tool__field">
          <span class="tool__label">Кому <span class="tool__optional">— необязательно</span></span>
          <input class="tool__input" name="to" maxlength="30" placeholder="Айгерим">
        </label>
        <label class="tool__field">
          <span class="tool__label">От кого <span class="tool__optional">— необязательно</span></span>
          <input class="tool__input" name="from" maxlength="30" placeholder="Данияр">
        </label>
      </div>

      <label class="tool__field">
        <span class="tool__label">Пожелание <span class="tool__optional">— необязательно</span></span>
        <input class="tool__input" name="wish" maxlength="100" placeholder="С днём рождения!">
      </label>

      <div class="tool__pair">
        <div class="tool__field">
          <span class="tool__label">Действует до</span>
          <input class="tool__input" type="date" name="until" aria-label="Действует до">
          <div class="tool__presets">
            <button type="button" data-months="1">1 мес</button>
            <button type="button" data-months="3">3 мес</button>
            <button type="button" data-months="6">6 мес</button>
            <button type="button" data-months="12">Год</button>
            <button type="button" data-months="0">Без срока</button>
          </div>
        </div>
        <div class="tool__field">
          <span class="tool__label">Номер сертификата</span>
          <div class="ok-day__custom">
            <input class="tool__input" name="number" maxlength="12" aria-label="Номер сертификата">
            <button type="button" class="tool__chip-btn" data-action="new-number">Новый</button>
          </div>
          <span class="tool__hint">Запишите номер у себя — так видно, какой сертификат уже использовали.</span>
        </div>
      </div>

      <label class="tool__field">
        <span class="tool__label">Куда ведёт QR-код</span>
        <input class="tool__input" name="qr" maxlength="200" placeholder="Ссылка на запись, @instagram или номер WhatsApp">
        <span class="tool__hint" id="sertifikat-qr-hint"></span>
      </label>

      <label class="tool__field">
        <span class="tool__label">Адрес и телефон <span class="tool__optional">— необязательно</span></span>
        <input class="tool__input" name="contacts" maxlength="80" placeholder="Алматы, Абая 10 · +7 701 000 00 00">
      </label>

      <div class="tool__field">
        <span class="tool__label">Фон и стиль</span>
        <div class="ok-styles" id="sertifikat-styles"></div>
      </div>

      <div class="tool__pair">
        <div class="tool__field">
          <span class="tool__label">Формат</span>
          ${segmented("format", [["wide", "Для печати 2:1"], ["post", "WhatsApp / пост"], ["story", "Сторис"]])}
        </div>
        <div class="tool__field">
          <span class="tool__label">Текст на сертификате</span>
          ${segmented("lang", [["ru", "Русский"], ["kk", "Қазақша"]])}
        </div>
      </div>
    </form>

    <div class="tool__preview">
      <p class="tool__preview-title">Предпросмотр</p>
      <canvas class="tool__canvas tool__canvas--auto" id="sertifikat-canvas" width="2000" height="1000" aria-label="Предпросмотр сертификата"></canvas>
      <button type="button" class="btn btn--primary btn--full" id="sertifikat-download">Скачать сертификат</button>
      <div class="tool__actions">
        <button type="button" class="btn btn--ghost" id="sertifikat-share" hidden>Поделиться</button>
        <button type="button" class="btn btn--ghost" id="sertifikat-copy">Скопировать текст</button>
      </div>
      <p class="tool__privacy">Сертификат собирается прямо в браузере — мы ничего не сохраняем и никуда не отправляем. Печать: формат 2:1 — это 21 × 10,5 см.</p>
    </div>`,

  "prays-list": () => `
    <form class="tool__form" onsubmit="return false" autocomplete="off">
      <div class="tool__pair">
        <label class="tool__field">
          <span class="tool__label">Название салона или имя</span>
          <input class="tool__input" name="name" maxlength="40" placeholder="Nail studio Aru">
        </label>
        <label class="tool__field">
          <span class="tool__label">Заголовок</span>
          <input class="tool__input" name="title" maxlength="40" placeholder="Прайс-лист">
        </label>
      </div>

      <div class="tool__field">
        <span class="tool__label">Услуги и цены</span>
        <span class="tool__hint">Цена — числом: <b>5000</b> или <b>5000-7000</b>. Галочка «от» — «от 5 000 ₸». Длительность — по желанию.</span>
        <div class="pl-sections" id="prays-sections"></div>
        <button type="button" class="tool__add" data-action="add-section">+ Раздел</button>
      </div>

      <div class="tool__field">
        <span class="tool__label">Фон и стиль</span>
        <div class="ok-styles" id="prays-styles"></div>
      </div>

      <div class="tool__pair">
        <div class="tool__field">
          <span class="tool__label">Формат</span>
          ${segmented("format", [["story", "Сторис"], ["post", "Пост"], ["a4", "A4 для печати"]])}
        </div>
        <div class="tool__field">
          <span class="tool__label">Текст на картинке</span>
          ${segmented("lang", [["ru", "Русский"], ["kk", "Қазақша"]])}
        </div>
      </div>

      <label class="tool__field">
        <span class="tool__label">Примечание <span class="tool__optional">— необязательно</span></span>
        <input class="tool__input" name="note" maxlength="120" placeholder="Цены действительны с 1 ноября">
      </label>

      <label class="tool__field">
        <span class="tool__label">Имя или @ник</span>
        <input class="tool__input" name="nick" maxlength="32" placeholder="@aigerim.nails">
      </label>

      <div class="tool__field">
        <span class="tool__label">Как записаться</span>
        ${segmented("how", [["link", "Ссылка в шапке профиля"], ["direct", "Пишите в директ"], ["whatsapp", "WhatsApp"], ["custom", "Свой текст"]])}
        <input class="tool__input" id="prays-whatsapp" name="whatsapp" maxlength="24" placeholder="+7 701 000 00 00" inputmode="tel" hidden>
        <input class="tool__input" id="prays-custom" name="custom" maxlength="60" placeholder="Запись по телефону +7 701 000 00 00" hidden>
      </div>
    </form>

    <div class="tool__preview">
      <p class="tool__preview-title">Предпросмотр</p>
      <canvas class="tool__canvas" id="prays-canvas" width="1080" height="1920" aria-label="Предпросмотр прайс-листа"></canvas>
      <button type="button" class="btn btn--primary btn--full" id="prays-download">Скачать картинку</button>
      <div class="tool__actions">
        <button type="button" class="btn btn--ghost" id="prays-share" hidden>Поделиться</button>
        <button type="button" class="btn btn--ghost" id="prays-copy">Скопировать текст</button>
      </div>
      <p class="tool__privacy">Картинка собирается прямо в браузере. Прайс запоминается только на этом устройстве — в следующий раз поменяете цены за минуту.</p>
    </div>`,
};

function renderTool(tool) {
  const others = TOOLS.filter((t) => t.slug !== tool.slug);
  const body = `
    <section class="page-hero page-hero--tool">
      <div class="container">
        <nav class="crumbs" aria-label="Навигация">
          <a href="/">Главная</a><span>/</span><span>Бесплатные инструменты</span><span>/</span><span>${escapeHtml(tool.menu)}</span>
        </nav>
        <p class="eyebrow">Бесплатный инструмент · без регистрации</p>
        <h1 class="page-hero__title">${escapeHtml(tool.h1)}</h1>
        <p class="page-hero__lead">${escapeHtml(tool.lead)}</p>
      </div>
    </section>

    <section class="section section--tool">
      <div class="container">
        <div class="tool" id="${escapeHtml(tool.rootId)}">${TOOL_FORMS[tool.slug]()}</div>
      </div>
    </section>

    ${
      tool.examples
        ? `<section class="section">
      <div class="container">
        <div class="section__header">
          <p class="eyebrow reveal">Примеры</p>
          <h2 class="section__title reveal">Готовые варианты — нажмите и поменяйте под себя</h2>
        </div>
        <div class="examples${tool.examplesWide ? " examples--wide" : ""}">
          ${tool.examples
            .map(
              ([title, text], i) => `
          <article class="example" data-example="${i}">
            <canvas class="example__img" width="${tool.examplesWide ? 600 : 324}" height="${tool.examplesWide ? 300 : 576}" aria-label="${escapeHtml(title)}"></canvas>
            <h3 class="example__title">${escapeHtml(title)}</h3>
            <p class="example__text">${escapeHtml(text)}</p>
            <button type="button" class="example__use" data-use-example>${tool.useLabel || "Сделать такую"} →</button>
          </article>`
            )
            .join("")}
        </div>
      </div>
    </section>`
        : ""
    }

    <section class="section">
      <div class="container">
        <div class="section__header">
          <p class="eyebrow reveal">Как сделать</p>
          <h2 class="section__title reveal">Три шага — и картинка готова</h2>
        </div>
        <ol class="steps">
          ${tool.steps
            .map(
              ([title, text], i) => `
          <li class="step reveal${i ? ` reveal--delay-${i}` : ""}">
            <span class="step__num">${i + 1}</span>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(text)}</p>
          </li>`
            )
            .join("")}
        </ol>
      </div>
    </section>

    <section class="section section--tight">
      <div class="container">
        <div class="tool-promo reveal">
          <div>
            <p class="eyebrow">А если клиенты будут записываться сами?</p>
            <p class="tool-promo__text">Страница записи Jazyl показывает свободное время сама — картинку не нужно обновлять после каждой записи. Бесплатно до 5 мастеров.</p>
          </div>
          <a href="/register" class="btn btn--light btn--lg" data-guest>Создать ссылку для записи</a>
          <a href="/app" class="btn btn--light btn--lg" data-user hidden>Мой кабинет</a>
        </div>
      </div>
    </section>

    ${renderFaq(tool.faq)}

    ${
      others.length
        ? `<section class="section section--tight">
      <div class="container">
        <p class="eyebrow">Ещё бесплатные инструменты</p>
        <div class="also">
          ${others.map((t) => `<a class="also__link" href="/instrumenty/${t.slug}">${escapeHtml(t.menu)} →</a>`).join("")}
        </div>
      </div>
    </section>`
        : ""
    }`;

  return renderPage({
    path: `/instrumenty/${tool.slug}`,
    title: tool.title,
    description: tool.description,
    body,
    scripts: ["/js/tools/kit.js", ...(tool.vendor || []), tool.script],
    // Шрифт с засечками для стилей картинки (кириллица и казахские буквы)
    fonts: "&family=Lora:wght@600;700",
  });
}

function renderLegal(page) {
  const body = `
    <section class="page-hero page-hero--legal">
      <div class="container">
        <nav class="crumbs" aria-label="Навигация">
          <a href="/">Главная</a><span>/</span><span>${escapeHtml(page.h1)}</span>
        </nav>
        <h1 class="page-hero__title">${escapeHtml(page.h1)}</h1>
        <p class="page-hero__lead">${escapeHtml(page.lead)}</p>
        <p class="legal__updated">Редакция от ${escapeHtml(page.updated)}</p>
      </div>
    </section>

    <section class="section section--tight">
      <div class="container">
        <article class="legal">
          ${page.sections.map(([title, html]) => `<section><h2>${escapeHtml(title)}</h2>${html}</section>`).join("")}
        </article>
      </div>
    </section>`;

  return renderPage({ path: page.path, title: page.title, description: page.description, body });
}

/** 404 и «что-то пошло не так» — в общем оформлении сайта. */
function renderNotFound({ error = false } = {}) {
  const body = `
    <section class="page-hero page-hero--legal">
      <div class="container">
        <p class="eyebrow">${error ? "Ошибка" : "404"}</p>
        <h1 class="page-hero__title">${error ? "Что-то пошло не так" : "Такой страницы нет"}</h1>
        <p class="page-hero__lead">${
          error
            ? "Мы уже видим ошибку. Обновите страницу через минуту или вернитесь на главную."
            : "Возможно, ссылка устарела или в адресе опечатка. Если вы искали страницу записи салона — попросите у салона свежую ссылку."
        }</p>
        <div class="page-hero__actions">
          <a href="/" class="btn btn--light btn--lg">На главную</a>
          <a href="/app" class="btn btn--ghost btn--lg">Мой кабинет</a>
        </div>
      </div>
    </section>`;
  return renderPage({
    path: "/",
    title: error ? "Что-то пошло не так | Jazyl" : "Страница не найдена | Jazyl",
    description: "Онлайн-запись для салонов и мастеров Казахстана.",
    body,
  });
}

function findTool(slug) {
  return TOOLS.find((t) => t.slug === slug) || null;
}

function findAudience(slug) {
  return AUDIENCES.find((a) => a.slug === slug) || null;
}

/** Все страницы сайта — для sitemap.xml. */
function sitePaths() {
  return [
    "/",
    ...FEATURES.map((f) => `/vozmozhnosti/${f.slug}`),
    ...AUDIENCES.map((a) => `/dlya/${a.slug}`),
    ...TOOLS.map((t) => `/instrumenty/${t.slug}`),
    ...LEGAL_PATHS,
  ];
}

module.exports = {
  renderHeader,
  renderFooter,
  renderAudience,
  findAudience,
  renderFeature,
  findFeature,
  renderTool,
  findTool,
  renderLegal,
  findLegal,
  renderNotFound,
  sitePaths,
  absoluteUrl,
};
