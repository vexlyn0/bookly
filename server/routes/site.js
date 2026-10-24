/**
 * Jazyl — страницы сайта: главная (с общей шапкой), «Возможности», «Кому подойдёт», sitemap.xml, robots.txt
 */

const fs = require("fs");
const path = require("path");
const express = require("express");
const config = require("../config");
const site = require("../site/render");

const router = express.Router();

// Главная: статичный index.html + общие шапка и подвал. В продакшене собираем один раз.
let landingHtml = null;
function landing() {
  if (!landingHtml || process.env.NODE_ENV !== "production") {
    landingHtml = fs
      .readFileSync(path.join(config.publicDir, "index.html"), "utf8")
      .replace("<!--SITE_HEADER-->", site.renderHeader("/"))
      .replace("<!--SITE_FOOTER-->", site.renderFooter());
  }
  return landingHtml;
}

router.get(["/", "/index.html"], (req, res) => {
  res.type("html").send(landing());
});

router.get("/dlya/:slug", (req, res, next) => {
  const audience = site.findAudience(req.params.slug);
  if (!audience) return next();
  res.type("html").send(site.renderAudience(audience));
});

router.get("/vozmozhnosti/:slug", (req, res, next) => {
  const feature = site.findFeature(req.params.slug);
  if (!feature) return next();
  res.type("html").send(site.renderFeature(feature));
});

router.get("/sitemap.xml", (req, res) => {
  const urls = site
    .sitePaths()
    .map((p) => `  <url><loc>${site.absoluteUrl(p)}</loc></url>`)
    .join("\n");
  res
    .type("application/xml")
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

router.get("/robots.txt", (req, res) => {
  res
    .type("text/plain")
    .send(
      [
        "User-agent: *",
        "Disallow: /app",
        "Disallow: /admin",
        "Disallow: /onboarding",
        "Disallow: /b/",
        "Disallow: /api/",
        `Sitemap: ${site.absoluteUrl("/sitemap.xml")}`,
        "",
      ].join("\n")
    );
});

module.exports = router;
