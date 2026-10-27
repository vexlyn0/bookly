/**
 * Jazyl — страницы сайта: главная (с общей шапкой), «Возможности», «Кому подойдёт», «Студия», sitemap.xml, robots.txt
 */

const fs = require("fs");
const path = require("path");
const express = require("express");
const config = require("../config");
const site = require("../site/render");
const studio = require("../site/studio");
const blog = require("../site/blog");

const router = express.Router();

// Главная: статичный index.html + общие шапка и подвал. В продакшене собираем один раз.
let landingHtml = null;
function landing() {
  if (!landingHtml || process.env.NODE_ENV !== "production") {
    landingHtml = site.renderHome(fs.readFileSync(path.join(config.publicDir, "index.html"), "utf8"));
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

router.get("/studiya", (req, res) => {
  res.type("html").send(studio.renderStudioHub());
});

router.get("/studiya/:slug", (req, res, next) => {
  const tool = studio.findTool(req.params.slug);
  if (!tool) return next();
  res.type("html").send(studio.renderStudioTool(tool));
});

router.get("/studiya/:slug/:variant", (req, res, next) => {
  const tool = studio.findTool(req.params.slug);
  const variant = tool && studio.findVariant(tool, req.params.variant);
  if (!variant) return next();
  res.type("html").send(studio.renderStudioTool(tool, variant));
});

router.get("/stati", (req, res) => {
  res.type("html").send(blog.renderArticlesHub());
});

router.get("/stati/:slug", (req, res, next) => {
  const article = blog.findArticle(req.params.slug);
  if (!article) return next();
  res.type("html").send(blog.renderArticle(article));
});

// Старые адреса «Инструментов» → Студия (ссылки уже могли разойтись)
router.get(["/instrumenty", "/instrumenty/:slug"], (req, res) => {
  const slug = req.params.slug ? studio.slugFromOld(req.params.slug) : null;
  res.redirect(301, slug ? `/studiya/${slug}` : "/studiya");
});

router.get(["/privacy", "/terms"], (req, res, next) => {
  const page = site.findLegal(req.path);
  if (!page) return next();
  res.type("html").send(site.renderLegal(page));
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
