/**
 * Bookly — Express-приложение
 */

const path = require("path");
const express = require("express");
const cors = require("cors");
const config = require("./config");
const routes = require("./routes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "32kb" }));

app.use(routes);

app.use(express.static(config.publicDir));

app.get("/login", (req, res) => {
  res.sendFile(path.join(config.publicDir, "login.html"));
});

app.get("/register", (req, res) => {
  res.sendFile(path.join(config.publicDir, "register.html"));
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

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: "Страница не найдена.",
  });
});

module.exports = app;
