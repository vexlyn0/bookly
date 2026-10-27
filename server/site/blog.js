/**
 * Jazyl — раздел «Статьи»: /stati (список) и /stati/<slug> (статья).
 * Тексты — server/site/articles.js. Оформление — общий renderPage + стили .article в site.css.
 */

const { ARTICLES, findArticle, articlePaths } = require("./articles");

// render.js сам подключает этот файл (sitePaths) — берём его лениво, чтобы не было цикла.
const site = () => require("./render");

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function formatDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCards(articles) {
  return `
        <div class="article-cards">
          ${articles
            .map(
              (article) => `
          <a class="article-card" href="/stati/${article.slug}">
            <span class="article-card__meta">${article.minutes} мин чтения</span>
            <span class="article-card__title">${escapeHtml(article.h1)}</span>
            <span class="article-card__lead">${escapeHtml(article.lead)}</span>
          </a>`
            )
            .join("")}
        </div>`;
}

function renderArticle(article) {
  const { renderPage, renderFaq, renderCta, breadcrumbSchema, absoluteUrl } = site();
  const path = `/stati/${article.slug}`;
  const related = article.related.map(findArticle).filter(Boolean);

  const body = `
    <section class="page-hero page-hero--legal">
      <div class="container">
        <nav class="crumbs" aria-label="Навигация">
          <a href="/">Главная</a><span>/</span><a href="/stati">Статьи</a><span>/</span><span>${escapeHtml(article.h1)}</span>
        </nav>
        <h1 class="page-hero__title">${escapeHtml(article.h1)}</h1>
        <p class="page-hero__lead">${escapeHtml(article.lead)}</p>
        <p class="legal__updated">${formatDate(article.date)} · ${article.minutes} мин чтения</p>
      </div>
    </section>

    <section class="section section--tight">
      <div class="container">
        <article class="legal article">
          ${article.sections.map(([title, html]) => `<section><h2>${escapeHtml(title)}</h2>${html}</section>`).join("")}
        </article>
      </div>
    </section>

    ${renderFaq(article.faq)}

    <section class="section section--tight">
      <div class="container">
        <h2 class="article-more__title">Читайте также</h2>
        ${renderCards(related)}
      </div>
    </section>

    ${renderCta()}`;

  return renderPage({
    path,
    title: article.title,
    description: article.description,
    body,
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: article.h1,
        description: article.description,
        datePublished: article.date,
        dateModified: article.date,
        inLanguage: "ru",
        mainEntityOfPage: absoluteUrl(path),
        image: absoluteUrl("/og-image.png"),
        author: { "@type": "Organization", name: "Jazyl", url: absoluteUrl("/") },
        publisher: { "@type": "Organization", name: "Jazyl", logo: { "@type": "ImageObject", url: absoluteUrl("/icon-512.png") } },
      },
      breadcrumbSchema([
        ["Jazyl", "/"],
        ["Статьи", "/stati"],
        [article.h1, path],
      ]),
    ],
  });
}

function renderArticlesHub() {
  const { renderPage, renderCta, breadcrumbSchema } = site();
  const body = `
    <section class="page-hero page-hero--legal">
      <div class="container">
        <nav class="crumbs" aria-label="Навигация">
          <a href="/">Главная</a><span>/</span><span>Статьи</span>
        </nav>
        <h1 class="page-hero__title">Статьи для мастеров и салонов</h1>
        <p class="page-hero__lead">Как вести запись клиентов, сделать онлайн-запись в Instagram, найти первых клиентов и выбрать программу — простыми словами, с примерами.</p>
      </div>
    </section>

    <section class="section section--tight">
      <div class="container">
        ${renderCards(ARTICLES)}
      </div>
    </section>

    ${renderCta()}`;

  return renderPage({
    path: "/stati",
    title: "Статьи для мастеров и салонов красоты: запись клиентов, Instagram, продвижение | Jazyl",
    description:
      "Полезные статьи для бьюти-мастеров и салонов Казахстана: как вести запись клиентов, сделать онлайн-запись бесплатно, настроить запись в Instagram и найти первых клиентов.",
    body,
    schema: [breadcrumbSchema([["Jazyl", "/"], ["Статьи", "/stati"]])],
  });
}

module.exports = { ARTICLES, findArticle, articlePaths, renderArticle, renderArticlesHub };
