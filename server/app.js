/**
 * Bookly — Express-приложение
 */

const path = require("path");
const express = require("express");
const cors = require("cors");
const config = require("./config");
const routes = require("./routes");
const siteRoutes = require("./routes/site");

const app = express();

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use(cors());
app.use(express.json({ limit: "32kb" }));

app.use(routes);

// Страницы сайта (главная с общим меню, разделы) — до статики, чтобы «/» собирался с шапкой.
app.use(siteRoutes);

app.use(express.static(config.publicDir, { index: false }));

app.get("/login", (req, res) => {
  res.sendFile(path.join(config.publicDir, "login.html"));
});

app.get("/register", (req, res) => {
  res.sendFile(path.join(config.publicDir, "register.html"));
});

app.get("/forgot-password", (req, res) => {
  res.sendFile(path.join(config.publicDir, "forgot-password.html"));
});

app.get("/reset-password", (req, res) => {
  res.sendFile(path.join(config.publicDir, "reset-password.html"));
});

app.get(["/onboarding", "/onboarding/"], (req, res) => {
  res.sendFile(path.join(config.publicDir, "onboarding", "index.html"));
});

app.get(["/app", "/app/"], (req, res) => {
  res.sendFile(path.join(config.publicDir, "app", "index.html"));
});

app.get(["/admin", "/admin/"], (req, res) => {
  res.sendFile(path.join(config.publicDir, "admin", "index.html"));
});

app.get("/book/:slug", (req, res) => {
  res.sendFile(path.join(config.publicDir, "book", "index.html"));
});

// Личная ссылка клиента на запись (отмена / перенос)
app.get("/b/:token", (req, res) => {
  res.sendFile(path.join(config.publicDir, "book", "manage.html"));
});

// Не найдено: API — JSON, страницы — обычная страница сайта с меню.
app.use((req, res) => {
  if (req.path.startsWith("/api/") || !req.accepts("html")) {
    return res.status(404).json({ ok: false, message: "Страница не найдена." });
  }
  return res.status(404).type("html").send(require("./site/render").renderNotFound());
});

// Любая неожиданная ошибка: в лог — коротко, посетителю — без технических подробностей.
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  console.error("[server] unhandled", req.method, req.path, error?.code || error?.name || "error");
  if (res.headersSent) return;
  if (req.path.startsWith("/api/") || !req.accepts("html")) {
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: "Что-то пошло не так. Попробуйте ещё раз." });
  }
  return res.status(500).type("html").send(require("./site/render").renderNotFound({ error: true }));
});

module.exports = app;
