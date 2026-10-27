/**
 * Один адрес для каждой страницы (чтобы поисковик не видел дублей):
 *   - старый адрес Render (*.onrender.com) → PUBLIC_APP_URL (app.vibesales.kz), тот же путь;
 *   - страницы сайта (главная, «Возможности», …) на адресе приложения → PUBLIC_SITE_URL (vibesales.kz).
 * API (/api/*: Telegram-бот, cron, кабинет) не трогаем. Работает только для GET/HEAD.
 */

const config = require("../config");

/** Страницы, которые живут на сайте (Cloudflare Pages), а не в приложении. */
const SITE_PAGE = /^\/(?:$|index\.html$|dlya\/|vozmozhnosti\/|instrumenty|studiya|stati|privacy$|terms$|sitemap\.xml$)/;

/**
 * Адрес из переменной окружения годится, только если он целиком латиницей и разбирается как URL.
 * Защита от опечатки вроде «https://vibesales.kzф» (не та раскладка) — иначе все уйдут на несуществующий сайт.
 */
function safeUrl(raw, name) {
  if (!raw) return "";
  let ok = !/[^\x21-\x7e]/.test(raw);
  try {
    ok = ok && /^https?:$/.test(new URL(raw).protocol);
  } catch {
    ok = false;
  }
  if (!ok) console.warn(`[warn] ${name} задан с ошибкой — переадресация отключена. Проверьте значение в Render → Environment.`);
  return ok ? raw : "";
}

const APP_URL = safeUrl(config.publicUrl, "PUBLIC_APP_URL");
// Без переменной или с опечаткой в ней — всё равно vibesales.kz: иначе поисковик видит дубли.
const SITE_URL = safeUrl(config.siteUrl, "PUBLIC_SITE_URL") || "https://vibesales.kz";

/** localhost, 127.0.0.1, [::1], *.localhost — локальный запуск, без переадресаций. */
function isLocal(host) {
  const name = host.replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]" || name.endsWith(".localhost");
}

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
  const appUrl = APP_URL;
  const siteUrl = SITE_URL;

  // Страница сайта → сайт (и с адреса приложения, и со старого адреса Render)
  if (SITE_PAGE.test(req.path) && host !== hostOf(siteUrl) && !isLocal(host)) {
    return res.redirect(301, `${siteUrl}${req.originalUrl === "/index.html" ? "/" : req.originalUrl}`);
  }

  // Старый адрес Render → адрес приложения
  if (appUrl && host.endsWith(".onrender.com") && host !== hostOf(appUrl)) {
    return res.redirect(301, `${appUrl}${req.originalUrl}`);
  }

  return next();
};

module.exports.SITE_PAGE = SITE_PAGE;
