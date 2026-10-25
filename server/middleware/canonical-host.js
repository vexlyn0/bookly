/**
 * Один адрес для каждой страницы (чтобы поисковик не видел дублей):
 *   - старый адрес Render (*.onrender.com) → PUBLIC_APP_URL (app.vibesales.kz), тот же путь;
 *   - страницы сайта (главная, «Возможности», …) на адресе приложения → PUBLIC_SITE_URL (vibesales.kz).
 * API (/api/*: Telegram-бот, cron, кабинет) не трогаем. Работает только для GET/HEAD.
 */

const config = require("../config");

/** Страницы, которые живут на сайте (Cloudflare Pages), а не в приложении. */
const SITE_PAGE = /^\/(?:$|index\.html$|dlya\/|vozmozhnosti\/|instrumenty\/|privacy$|terms$|sitemap\.xml$)/;

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

module.exports = function canonicalHost(req, res, next) {
  if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api/")) return next();

  const host = String(req.headers.host || "").toLowerCase();
  const appUrl = config.publicUrl;
  const siteUrl = config.siteUrl;

  // Страница сайта → сайт (и с адреса приложения, и со старого адреса Render)
  if (siteUrl && SITE_PAGE.test(req.path) && host !== hostOf(siteUrl)) {
    return res.redirect(301, `${siteUrl}${req.originalUrl === "/index.html" ? "/" : req.originalUrl}`);
  }

  // Старый адрес Render → адрес приложения
  if (appUrl && host.endsWith(".onrender.com") && host !== hostOf(appUrl)) {
    return res.redirect(301, `${appUrl}${req.originalUrl}`);
  }

  return next();
};

module.exports.SITE_PAGE = SITE_PAGE;
