/**
 * Серверная конфигурация Bookly
 */

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

if (fs.existsSync(ENV_PATH)) {
  const result = dotenv.config({ path: ENV_PATH, override: true });
  if (result.error) {
    console.error(`[error] Не удалось загрузить .env: ${result.error.message}`);
  } else {
    console.log(`[env] loaded: ${ENV_PATH}`);
  }
} else {
  console.warn(`[warn] Файл .env не найден: ${ENV_PATH}`);
}

/**
 * Нормализует Project URL Supabase.
 * Пользователи часто копируют REST endpoint (/rest/v1/) вместо базового URL.
 */
function normalizeSupabaseUrl(raw) {
  let url = String(raw || "").trim();

  if (!url) return "";

  // Убираем хвост REST API, если скопировали не тот URL
  url = url.replace(/\/rest\/v1\/?$/i, "");
  url = url.replace(/\/+$/, "");

  return url;
}

const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const supabaseAnonKey = String(
  process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    ""
).trim();
const supabaseServiceRoleKey = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ""
).trim();

const config = {
  rootDir: ROOT_DIR,
  publicDir: PUBLIC_DIR,
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  supabase: {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    serviceRoleKey: supabaseServiceRoleKey,
  },
};

config.supabase.isConfigured = Boolean(config.supabase.url && config.supabase.anonKey);
config.supabase.serverKey =
  config.supabase.serviceRoleKey || config.supabase.anonKey;

if (process.env.SUPABASE_URL && /\/rest\/v1\/?$/i.test(process.env.SUPABASE_URL.trim())) {
  console.warn(
    "[warn] SUPABASE_URL содержит /rest/v1/ — это REST endpoint, не Project URL."
  );
  console.warn(`[warn] Используется нормализованный URL: ${config.supabase.url}`);
}

if (config.supabase.isConfigured) {
  console.log(`[supabase] url: ${config.supabase.url}`);
  console.log(
    `[supabase] key: ${config.supabase.anonKey.startsWith("sb_publishable_") ? "publishable" : "anon"} (${config.supabase.anonKey.slice(0, 12)}…)`,
  );
} else {
  console.warn("[warn] Supabase не настроен — заполните SUPABASE_URL и SUPABASE_ANON_KEY в .env");
}

module.exports = config;
