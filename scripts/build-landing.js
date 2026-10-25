/**
 * Jazyl — статическая сборка сайта (главная, «Возможности», «Кому подойдёт», «Студия», правовые страницы)
 * для Cloudflare Pages. Кабинет и запись остаются на Render: ссылки на них ведут на APP_URL.
 *
 * Usage: node scripts/build-landing.js
 *   SITE_URL — адрес сайта (по умолчанию https://vibesales.kz)
 *   APP_URL  — адрес приложения на Render (по умолчанию https://app.vibesales.kz)
 *   Результат — папка dist/landing (её и публикует Cloudflare Pages).
 */

const fs = require("fs");
const path = require("path");

const SITE_URL = (process.env.SITE_URL || "https://vibesales.kz").replace(/\/+$/, "");
const APP_URL = (process.env.APP_URL || "https://app.vibesales.kz").replace(/\/+$/, "");

const config = require("../server/config");

// canonical и sitemap должны указывать на сайт, а не на Render (после загрузки .env, который мог задать свой адрес)
config.publicUrl = SITE_URL;
const site = require("../server/site/render");
const studio = require("../server/site/studio");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "dist", "landing");

// Пути приложения: на статическом сайте их нет — уводим на Render
const APP_PATHS = ["register", "login", "app", "onboarding", "admin", "book", "b", "forgot-password", "reset-password"];
const appLink = new RegExp(`(href=["']|location\\.replace\\(\`)/(${APP_PATHS.join("|")})(?=[/"'?#\`$])`, "g");

function toApp(text) {
  return text.replace(appLink, `$1${APP_URL}/$2`);
}

function write(relPath, content) {
  const file = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyDir(rel) {
  fs.cpSync(path.join(config.publicDir, rel), path.join(OUT, rel), { recursive: true });
}

function renderPath(p) {
  if (p === "/") {
    return fs
      .readFileSync(path.join(config.publicDir, "index.html"), "utf8")
      .replace("<!--SITE_HEADER-->", site.renderHeader("/"))
      .replace("<!--STUDIO_SECTION-->", studio.renderStudioSection())
      .replace("<!--SITE_FOOTER-->", site.renderFooter());
  }
  const [, section, slug] = p.split("/");
  if (section === "vozmozhnosti") return site.renderFeature(site.findFeature(slug));
  if (section === "dlya") return site.renderAudience(site.findAudience(slug));
  if (section === "studiya") return slug ? studio.renderStudioTool(studio.findTool(slug)) : studio.renderStudioHub();
  return site.renderLegal(site.findLegal(p));
}

fs.rmSync(OUT, { recursive: true, force: true });

const paths = site.sitePaths();
for (const p of paths) {
  write(p === "/" ? "index.html" : `${p.slice(1)}.html`, toApp(renderPath(p)));
}

copyDir("css");
copyDir(path.join("js", "tools"));
copyDir(path.join("js", "vendor"));
for (const file of ["config.js", "site.js", "landing-i18n.js"]) copyDir(path.join("js", file));
write(path.join("js", "landing.js"), toApp(fs.readFileSync(path.join(config.publicDir, "js", "landing.js"), "utf8")));
copyDir("favicon.svg");

const urls = paths.map((p) => `  <url><loc>${site.absoluteUrl(p)}</loc></url>`).join("\n");
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
);
// Набрали vibesales.kz/app и т.п. — переадресуем в приложение (иначе Pages покажет главную)
write(
  "_redirects",
  [
    ...APP_PATHS.flatMap((p) => [`/${p} ${APP_URL}/${p} 301`, `/${p}/* ${APP_URL}/${p}/:splat 301`]),
    // Старые адреса «Инструментов» → Студия
    ...studio.TOOLS.map((t) => `/instrumenty/${t.oldSlug} /studiya/${t.slug} 301`),
    "/instrumenty /studiya 301",
  ].join("\n") + "\n"
);
write("404.html", toApp(site.renderNotFound()));
write("robots.txt", ["User-agent: *", "Allow: /", `Sitemap: ${SITE_URL}/sitemap.xml`, ""].join("\n"));

console.log(`Сайт собран: ${paths.length} страниц → ${path.relative(ROOT, OUT)} (приложение: ${APP_URL})`);
