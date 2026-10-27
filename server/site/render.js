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
const { versionAssets } = require("./assets");

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
    { label: "Студия", href: "/studiya" },
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
  const tools = [`<a href="/studiya">Студия Jazyl</a>`, ...TOOLS.map((t) => `<a href="/studiya/${t.slug}">${escapeHtml(t.menu)}</a>`)].join("");
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
        <a href="/stati">Статьи</a>
        <a href="/login">Войти</a>
      </nav>
      <nav class="footer__links footer__links--wide" aria-label="Возможности">
        ${features}
      </nav>
      <nav class="footer__links footer__links--wide" aria-label="Студия">
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

/** Полный адрес страницы сайта — всегда на домене сайта (vibesales.kz), а не приложения. */
function absoluteUrl(path) {
  const base = config.siteUrl || config.publicUrl;
  return base ? `${base.replace(/\/$/, "")}${path}` : path;
}

/**
 * Разметка для поисковиков (schema.org, JSON-LD): Google и Яндекс понимают, что это за
 * страница, и могут показать в выдаче вопросы-ответы, «хлебные крошки», цену «бесплатно».
 */
function jsonLd(data) {
  // «<» экранируем, чтобы текст не закрыл тег <script>
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

const SITE_NAME = "Jazyl";

function organizationSchema() {
  const sameAs = [CONTACTS.instagram && `https://instagram.com/${CONTACTS.instagram}`].filter(Boolean);
  return {
    "@type": "Organization",
    "@id": absoluteUrl("/#organization"),
    name: SITE_NAME,
    url: absoluteUrl("/"),
    logo: absoluteUrl("/icon-512.png"),
    ...(sameAs.length ? { sameAs } : {}),
    ...(CONTACTS.whatsapp
      ? { contactPoint: { "@type": "ContactPoint", telephone: CONTACTS.whatsapp.replace(/[^\d+]/g, ""), contactType: "customer support", availableLanguage: ["ru", "kk"] } }
      : {}),
  };
}

/** «Главная › Студия › Прайс» — [[название, путь], …], первая — главная. */
function breadcrumbSchema(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, itemPath], index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: absoluteUrl(itemPath),
    })),
  };
}

function faqSchema(items) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(([q, a]) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

/** Главная: сам сервис, организация, сайт и вопросы из блока FAQ в index.html. */
function homeSchema(html) {
  const faq = [];
  const re = /faq-item__question[^>]*>([\s\S]*?)<span[\s\S]*?faq-item__answer-inner"><p>([\s\S]*?)<\/p>/g;
  const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  for (let m; (m = re.exec(html)); ) faq.push([strip(m[1]), strip(m[2])]);
  return [
    jsonLd({
      "@context": "https://schema.org",
      "@graph": [
        organizationSchema(),
        { "@type": "WebSite", "@id": absoluteUrl("/#website"), name: SITE_NAME, url: absoluteUrl("/"), inLanguage: "ru", publisher: { "@id": absoluteUrl("/#organization") } },
        {
          "@type": "SoftwareApplication",
          name: "Jazyl — онлайн-запись для салонов",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          url: absoluteUrl("/"),
          description: "Бесплатная онлайн-запись для салонов красоты и мастеров Казахстана: страница записи, уведомления в Telegram, напоминания клиентам.",
          offers: { "@type": "Offer", price: "0", priceCurrency: "KZT", description: "Бесплатно до 5 мастеров" },
          publisher: { "@id": absoluteUrl("/#organization") },
        },
      ],
    }),
    faq.length ? jsonLd(faqSchema(faq)) : "",
  ].join("\n  ");
}

/** Главная: статичный public/index.html + общие шапка, подвал, блок Студии и разметка. */
function renderHome(html) {
  return versionAssets(
    html
      .replace("<!--SITE_HEADER-->", renderHeader("/"))
      .replace("<!--STUDIO_SECTION-->", require("./studio").renderStudioSection())
      .replace("<!--SITE_FOOTER-->", renderFooter())
      .replace("</head>", `  ${homeSchema(html)}\n</head>`)
  );
}

const DEFAULT_IMAGE = { src: "/og-image.png", width: 1200, height: 630 };

function renderPage({ path, title, description, body, scripts = [], fonts = "", styles = [], lang = "ru", schema = [], image = DEFAULT_IMAGE }) {
  return versionAssets(`<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48">
  <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(absoluteUrl(path))}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${escapeHtml(absoluteUrl(image.src))}">
  <meta property="og:image:width" content="${image.width}">
  <meta property="og:image:height" content="${image.height}">
  <meta property="og:site_name" content="Jazyl">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#0d0c14">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800${fonts}&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="/css/landing.css">
  <link rel="stylesheet" href="/css/site.css">
${styles.map((href) => `  <link rel="stylesheet" href="${href}">`).join("\n")}
  <script src="/js/metrika.js" data-webvisor="1" async></script>
${schema.map((data) => `  ${jsonLd(data)}`).join("\n")}
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
`);
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
      ${jsonLd(faqSchema(items))}
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

function findAudience(slug) {
  return AUDIENCES.find((a) => a.slug === slug) || null;
}

/** Все страницы сайта — для sitemap.xml. */
function sitePaths() {
  return [
    "/",
    ...FEATURES.map((f) => `/vozmozhnosti/${f.slug}`),
    ...AUDIENCES.map((a) => `/dlya/${a.slug}`),
    ...require("./studio").studioPaths(),
    ...require("./articles").articlePaths(),
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
  renderPage,
  renderFaq,
  renderHome,
  renderCta,
  absoluteUrl,
  breadcrumbSchema,
  renderLegal,
  findLegal,
  renderNotFound,
  sitePaths,
  absoluteUrl,
};
