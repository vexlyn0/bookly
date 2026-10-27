/**
 * Jazyl Студия — страницы редакторов (/studiya/<slug>), витрина (/studiya) и блок для главной.
 *
 * Логика редактора: 1) шаблон из ленты сверху → 2) правки в свёрнутых группах справа →
 * 3) превью в рамке телефона и «Скачать». Поведение — в public/js/tools/<script>.js.
 */

const { TOOLS } = require("./tools");
const { VARIANTS } = require("./studio-variants");

function site() {
  return require("./render");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ICONS = {
  clock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  list: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  gift: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8S10 3 7.5 4.5 9 8 12 8zM12 8s2-5 4.5-3.5S15 8 12 8z"/></svg>',
  calendar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
};

// ---------------------------------------------------------------------------
// Элементы формы
// ---------------------------------------------------------------------------

/** Переключатель-кнопки: [[значение, подпись], ...]. */
function seg(group, options) {
  return `<div class="st-seg" role="group">${options
    .map(([value, label]) => `<button type="button" data-${group}="${value}" aria-pressed="false">${escapeHtml(label)}</button>`)
    .join("")}</div>`;
}

function group(title, body, open = false) {
  return `<details class="st-group"${open ? " open" : ""}><summary>${escapeHtml(title)}</summary><div class="st-group__body">${body}</div></details>`;
}

function field(label, control, hint = "") {
  return `<label class="st-field"><span class="st-label">${label}</span>${control}${hint ? `<span class="st-hint">${hint}</span>` : ""}</label>`;
}

const input = (name, attrs = "") => `<input class="st-input" name="${name}" ${attrs}>`;

function looks(id, formats) {
  return group(
    "Цвет, формат, язык",
    `<div class="st-swatches" id="${id}-styles"></div>
     <div class="st-row">
       <div class="st-field"><span class="st-label">Формат</span>${seg("format", formats)}</div>
       <div class="st-field"><span class="st-label">Язык картинки</span>${seg("lang", [["ru", "Русский"], ["kk", "Қазақша"]])}</div>
     </div>`
  );
}

function contacts(id, extra = "") {
  return group(
    "Контакты",
    `${field("Имя или @ник", input("nick", 'maxlength="32" placeholder="@aigerim.nails"'))}
     <div class="st-field"><span class="st-label">Как записаться</span>
       ${seg("how", [["link", "Ссылка в профиле"], ["direct", "Директ"], ["whatsapp", "WhatsApp"], ["custom", "Свой текст"]])}
       <input class="st-input" id="${id}-whatsapp" name="whatsapp" maxlength="24" placeholder="+7 701 000 00 00" inputmode="tel" hidden>
       <input class="st-input" id="${id}-custom" name="custom" maxlength="60" placeholder="Запись по телефону +7 701 000 00 00" hidden>
     </div>
     ${extra}`
  );
}

const FORMS = {
  okoshki: () => `
    ${group(
      "Когда и во сколько",
      `<div class="st-quick">
         <button type="button" data-preset="today">Сегодня</button>
         <button type="button" data-preset="tomorrow">Завтра</button>
         <button type="button" data-preset="week">5 дней</button>
       </div>
       <div class="st-days" id="okoshki-days"></div>
       <button type="button" class="st-add" data-action="add-day">+ день</button>
       <p class="st-hint">Пишите время как в директ: <b>10, 13:30, 17-19</b>. «17-19» — это 17:00, 18:00 и 19:00.</p>`,
      true
    )}
    ${group(
      "Подпись и акция",
      `${field("Наклейка сверху", input("label", 'maxlength="24" placeholder="Маникюр"'), "Услуга или ваше имя — крупно не нужно, это наклейка.")}
       ${field("Акция", input("promo", 'maxlength="24" placeholder="−10% на эти окошки"'), "Необязательно. Станет яркой наклейкой рядом с заголовком.")}`
    )}
    ${contacts("okoshki")}
    ${looks("okoshki", [["story", "Сторис"], ["post", "Пост"]])}`,

  prays: () => `
    ${group(
      "Прайс текстом",
      `<textarea class="st-input st-textarea" name="text" rows="12" spellcheck="false"></textarea>
       <p class="st-hint">Каждая строка — <b>услуга и цена</b>: «Маникюр — 5000», «Наращивание от 9000», «Стрижка 4000 60 мин». Строка <b># Педикюр</b> — новый раздел.</p>
       <p class="st-parsed" id="prays-parsed"></p>`,
      true
    )}
    ${group(
      "Заголовок",
      `${field("Наклейка сверху", input("name", 'maxlength="40" placeholder="Nail studio Aru"'))}
       ${field("Заголовок", input("title", 'maxlength="30" placeholder="Прайс"'))}
       ${field("Примечание", input("note", 'maxlength="100" placeholder="Цены действительны с 1 ноября"'), "Необязательно.")}`
    )}
    ${contacts("prays")}
    ${looks("prays", [["story", "Сторис"], ["post", "Пост"], ["a4", "A4"]])}`,

  sertifikat: () => `
    ${group(
      "Подарок",
      `<div class="st-field"><span class="st-label">Что дарят</span>${seg("kind", [["amount", "Сумму"], ["service", "Услугу"]])}</div>
       <div class="st-field" id="sertifikat-amount-box"><span class="st-label">Номинал</span>
         <div class="st-quick">
           <button type="button" data-amount="5000">5 000</button>
           <button type="button" data-amount="10000">10 000</button>
           <button type="button" data-amount="15000">15 000</button>
           <button type="button" data-amount="20000">20 000</button>
           <button type="button" data-amount="30000">30 000</button>
         </div>
         <input class="st-input" name="amount" maxlength="9" inputmode="numeric" placeholder="Своя сумма, ₸">
       </div>
       <div id="sertifikat-service-box" hidden>${field("Услуга", input("service", 'maxlength="60" placeholder="Массаж спины, 60 минут"'))}</div>
       <div class="st-row">
         ${field("Кому", input("to", 'maxlength="30" placeholder="Айгерим"'))}
         ${field("От кого", input("from", 'maxlength="30" placeholder="Данияр"'))}
       </div>
       ${field("Пожелание", input("wish", 'maxlength="90" placeholder="С днём рождения!"'), "Необязательно.")}`,
      true
    )}
    ${group(
      "QR, номер и срок",
      `${field("QR ведёт на", input("qr", 'maxlength="200" placeholder="Ссылка на запись, @instagram или номер WhatsApp"'), '<span id="sertifikat-qr-hint"></span>')}
       <div class="st-row">
         <div class="st-field"><span class="st-label">Номер</span>
           <span class="st-inline">${input("number", 'maxlength="12"')}<button type="button" class="st-add" data-action="new-number">Новый</button></span>
         </div>
         ${field("Действует до", input("until", 'type="date"'))}
       </div>
       <div class="st-quick">
         <button type="button" data-months="3">3 месяца</button>
         <button type="button" data-months="6">Полгода</button>
         <button type="button" data-months="12">Год</button>
         <button type="button" data-months="0">Без срока</button>
       </div>`
    )}
    ${group(
      "Салон",
      `${field("Название", input("salon", 'maxlength="40" placeholder="Nail studio Aru"'))}
       ${field("Адрес и телефон", input("contacts", 'maxlength="80" placeholder="Алматы, Абая 10 · +7 701 000 00 00"'), "Необязательно.")}`
    )}
    ${looks("sertifikat", [["wide", "Печать 2:1"], ["post", "WhatsApp"], ["story", "Сторис"]])}`,

  anons: () => `
    ${group(
      "Месяц и рабочие дни",
      `${field("Месяц", '<select class="st-input" name="month"></select>')}
       <div class="st-quick">
         <button type="button" data-days="six">Пн–Сб</button>
         <button type="button" data-days="weekdays">Пн–Пт</button>
         <button type="button" data-days="twotwo">2 через 2</button>
         <button type="button" data-days="all">Без выходных</button>
         <button type="button" data-days="none">Очистить</button>
       </div>
       <div class="st-cal" id="zapis-calendar"></div>
       <p class="st-hint">Нажмите на день, чтобы убрать или добавить его.</p>`,
      true
    )}
    ${group(
      "Текст",
      `${field("Наклейка сверху", input("label", 'maxlength="30" placeholder="Маникюр · Aigerim"'))}
       ${field("Заголовок", input("title", 'maxlength="30" placeholder="Открыта запись"'))}
       ${field("Акция", input("promo", 'maxlength="30" placeholder="−10% на первую неделю"'), "Необязательно.")}`
    )}
    ${contacts("zapis", field("QR на запись", input("qr", 'maxlength="200" placeholder="Ссылка, @instagram или номер WhatsApp"'), "Необязательно — появится в правом нижнем углу."))}
    ${looks("zapis", [["story", "Сторис"], ["post", "Пост"]])}`,
};

// ---------------------------------------------------------------------------
// Страница редактора
// ---------------------------------------------------------------------------

/** Варианты инструмента (страницы под конкретные запросы). */
function variantsOf(tool) {
  return VARIANTS[tool.slug] || [];
}

/** Ссылки «Популярные шаблоны»: главная инструмента и все его варианты. */
function renderVariantLinks(tool, current) {
  const links = [{ href: `/studiya/${tool.slug}`, name: "Все шаблоны", active: !current }, ...variantsOf(tool).map((v) => ({
    href: `/studiya/${tool.slug}/${v.slug}`,
    name: v.name,
    active: current?.slug === v.slug,
  }))];
  if (links.length < 2) return "";
  return `
    <section class="section section--tight">
      <div class="container">
        <p class="eyebrow">Популярные шаблоны · ${escapeHtml(tool.menu)}</p>
        <nav class="st-variants" aria-label="Шаблоны">
          ${links
            .map((l) => (l.active ? `<span class="st-variant is-current">${escapeHtml(l.name)}</span>` : `<a class="st-variant" href="${l.href}">${escapeHtml(l.name)}</a>`))
            .join("")}
        </nav>
      </div>
    </section>`;
}

/**
 * Страница редактора. variant — страница под конкретный запрос (studio-variants.js):
 * свои заголовок, текст, вопросы, стартовый шаблон (data-preset) и лента примеров (data-templates).
 */
function renderStudioTool(tool, variant = null) {
  const { renderPage, renderFaq, breadcrumbSchema } = site();
  const others = TOOLS.filter((t) => t.slug !== tool.slug);
  const thumb = tool.wide ? 'width="240" height="120"' : 'width="120" height="214"';
  const page = variant || tool;
  const ribbon = variant ? variant.templates.map((t) => t.tpl) : tool.templates;
  const pageData = variant
    ? ` data-preset="${escapeHtml(JSON.stringify(variant.preset || {}))}" data-templates="${escapeHtml(
        JSON.stringify(variant.templates.map(({ tpl, ...preset }) => preset))
      )}"`
    : "";

  const body = `
    <section class="st-hero">
      <div class="container">
        <nav class="crumbs" aria-label="Навигация">
          <a href="/">Главная</a><span>/</span><a href="/studiya">Студия</a><span>/</span>${
            variant
              ? `<a href="/studiya/${tool.slug}">${escapeHtml(tool.menu)}</a><span>/</span><span>${escapeHtml(variant.name)}</span>`
              : `<span>${escapeHtml(tool.menu)}</span>`
          }
        </nav>
        <div class="st-hero__row">
          <span class="st-hero__icon" aria-hidden="true">${ICONS[tool.icon] || ""}</span>
          <div>
            <p class="eyebrow">Студия Jazyl · бесплатно, без регистрации</p>
            <h1 class="st-hero__title">${escapeHtml(page.h1)}</h1>
          </div>
        </div>
        <p class="st-hero__lead">${escapeHtml(page.lead)}</p>
      </div>
    </section>

    <section class="st-editor" id="${escapeHtml(tool.rootId)}"${pageData}>
      <div class="container">
        <div class="st-templates">
          <p class="st-step"><b>1</b> Выберите шаблон</p>
          <div class="st-ribbon${tool.wide ? " st-ribbon--wide" : ""}">
            ${ribbon
              .map(
                (name, i) => `
            <button type="button" class="st-template" data-template="${i}" aria-pressed="false">
              <canvas ${thumb} aria-hidden="true"></canvas>
              <span>${escapeHtml(name)}</span>
            </button>`
              )
              .join("")}
          </div>
        </div>

        <div class="st-workspace${tool.wide ? " st-workspace--wide" : ""}">
          <div class="st-stage">
            <div class="st-device${tool.wide ? " st-device--wide" : ""}">
              <canvas class="st-canvas" id="${escapeHtml(tool.rootId)}-canvas" width="1080" height="1920" aria-label="Предпросмотр"></canvas>
            </div>
            <div class="st-actions">
              <button type="button" class="btn btn--primary btn--full" id="${escapeHtml(tool.rootId)}-download">Скачать PNG</button>
              <div class="st-actions__row">
                <button type="button" class="btn btn--ghost" id="${escapeHtml(tool.rootId)}-share" hidden>Поделиться</button>
                <button type="button" class="btn btn--ghost" id="${escapeHtml(tool.rootId)}-copy">Текст для WhatsApp</button>
              </div>
              <p class="st-privacy">Картинка собирается прямо в браузере — мы ничего не сохраняем и никуда не отправляем.</p>
            </div>
          </div>

          <form class="st-panel" onsubmit="return false" autocomplete="off">
            <p class="st-step"><b>2</b> Поменяйте под себя</p>
            ${FORMS[tool.slug]()}
            <p class="st-step st-step--last"><b>3</b> Скачайте картинку — кнопка под превью</p>
          </form>
        </div>
      </div>
    </section>

    <section class="section section--tight">
      <div class="container">
        <ol class="st-how">
          ${tool.steps.map(([title, text], i) => `<li><span>${i + 1}</span><b>${escapeHtml(title)}</b><p>${escapeHtml(text)}</p></li>`).join("")}
        </ol>
      </div>
    </section>

    ${
      variant?.about
        ? `<section class="section section--tight">
      <div class="container st-about">
        <h2 class="st-about__title">${escapeHtml(variant.h1)}: как сделать</h2>
        ${variant.about.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
      </div>
    </section>`
        : ""
    }

    ${renderFaq(page.faq || tool.faq)}

    ${renderVariantLinks(tool, variant)}

    <section class="section section--tight">
      <div class="container">
        <p class="eyebrow">Ещё в Студии</p>
        ${renderStudioCards(others, { compact: true })}
      </div>
    </section>

    <section class="section section--tight">
      <div class="container">
        <div class="st-promo">
          <div>
            <b>Картинку можно не обновлять</b>
            <p>Страница записи Jazyl сама показывает свободное время — клиенты записываются по ссылке из шапки профиля. Бесплатно до 5 мастеров.</p>
          </div>
          <a href="/register" class="btn btn--light btn--lg" data-guest>Создать ссылку для записи</a>
          <a href="/app" class="btn btn--light btn--lg" data-user hidden>Мой кабинет</a>
        </div>
      </div>
    </section>`;

  return renderPage({
    path: variant ? `/studiya/${tool.slug}/${variant.slug}` : `/studiya/${tool.slug}`,
    title: page.title,
    description: page.description,
    body,
    scripts: ["/js/tools/kit.js", ...(tool.vendor || []), tool.script],
    fonts: ";900",
    styles: ["/css/studio.css"],
    // Казахская страница («Сыйлық сертификаты») — lang="kk" для поисковиков
    lang: variant?.preset?.lang === "kk" ? "kk" : "ru",
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: page.h1 || tool.h1,
        description: page.description,
        applicationCategory: "DesignApplication",
        operatingSystem: "Web",
        browserRequirements: "Работает в браузере, без регистрации",
        offers: { "@type": "Offer", price: "0", priceCurrency: "KZT" },
        publisher: { "@type": "Organization", name: "Jazyl" },
      },
      breadcrumbSchema([
        ["Jazyl", "/"],
        ["Студия", "/studiya"],
        [tool.h1, `/studiya/${tool.slug}`],
        ...(variant ? [[variant.name, `/studiya/${tool.slug}/${variant.slug}`]] : []),
      ]),
    ],
  });
}

// ---------------------------------------------------------------------------
// Карточки Студии (витрина, главная, «ещё в Студии»)
// ---------------------------------------------------------------------------

function renderStudioCards(tools = TOOLS, { compact = false } = {}) {
  return `<div class="st-cards${compact ? " st-cards--compact" : ""}">
    ${tools
      .map(
        (t) => `
      <a class="st-card st-card--${escapeHtml(t.icon)}" href="/studiya/${t.slug}">
        <span class="st-card__art" aria-hidden="true">
          <span class="st-card__ticket"></span><span class="st-card__ticket"></span><span class="st-card__sticker"></span>
        </span>
        <span class="st-card__icon" aria-hidden="true">${ICONS[t.icon] || ""}</span>
        <b class="st-card__title">${escapeHtml(t.menu)}</b>
        <span class="st-card__text">${escapeHtml(t.menuHint)}</span>
        <span class="st-card__go">Открыть →</span>
      </a>`
      )
      .join("")}
  </div>`;
}

/** Блок «Студия» для главной (подставляется вместо <!--STUDIO_SECTION--> в index.html). */
function renderStudioSection() {
  return `
    <section class="section" id="studio">
      <div class="container">
        <div class="section__header">
          <p class="eyebrow reveal">Студия Jazyl · бесплатно</p>
          <h2 class="section__title reveal">Сторис для салона за минуту</h2>
          <p class="section__subtitle reveal">Свободные окошки, прайс, сертификат и анонс месяца — в фирменном стиле «талонов». Без регистрации и без Canva.</p>
        </div>
        ${renderStudioCards()}
      </div>
    </section>`;
}

/** Витрина /studiya. */
function renderStudioHub() {
  const { renderPage } = site();
  const body = `
    <section class="st-hero st-hero--hub">
      <div class="container">
        <nav class="crumbs" aria-label="Навигация"><a href="/">Главная</a><span>/</span><span>Студия</span></nav>
        <p class="eyebrow">Бесплатно · без регистрации · на русском и казахском</p>
        <h1 class="st-hero__title">Студия Jazyl</h1>
        <p class="st-hero__lead">Четыре редактора картинок для Instagram и WhatsApp. Выберите шаблон, впишите своё — и скачайте PNG.</p>
      </div>
    </section>
    <section class="section section--tight">
      <div class="container">${renderStudioCards()}</div>
    </section>`;
  return renderPage({
    path: "/studiya",
    title: "Студия Jazyl — шаблоны сторис для салона красоты бесплатно",
    description:
      "Бесплатные шаблоны для салонов и мастеров: свободные окошки, прайс-лист, подарочный сертификат с QR и анонс записи на месяц. Без регистрации, на русском и казахском.",
    body,
    styles: ["/css/studio.css"],
  });
}

function findTool(slug) {
  return TOOLS.find((t) => t.slug === slug) || null;
}

function findVariant(tool, slug) {
  return variantsOf(tool).find((v) => v.slug === slug) || null;
}

/** Все адреса Студии — для sitemap. */
function studioPaths() {
  return [
    "/studiya",
    ...TOOLS.flatMap((t) => [`/studiya/${t.slug}`, ...variantsOf(t).map((v) => `/studiya/${t.slug}/${v.slug}`)]),
  ];
}

/** Старый адрес /instrumenty/<old> → новый slug. */
function slugFromOld(oldSlug) {
  return TOOLS.find((t) => t.oldSlug === oldSlug)?.slug || null;
}

module.exports = {
  renderStudioTool,
  renderStudioHub,
  renderStudioSection,
  renderStudioCards,
  findTool,
  findVariant,
  studioPaths,
  slugFromOld,
  TOOLS,
};
