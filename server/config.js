/**
 * Серверная конфигурация Bookly
 */

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const {
  resolveSupabaseConfig,
  resolveKaspiConfig,
  resolveTelegramConfig,
  getMissingRequiredEnvNames,
} = require("./lib/env-resolve");

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

const supabase = resolveSupabaseConfig(process.env);
const kaspi = resolveKaspiConfig(process.env);
const telegram = resolveTelegramConfig(process.env);

const config = {
  rootDir: ROOT_DIR,
  publicDir: PUBLIC_DIR,
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  /** Адрес сайта для ссылок в сообщениях бота. Render задаёт RENDER_EXTERNAL_URL сам. */
  publicUrl: String(process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || "")
    .trim()
    .replace(/\/+$/, ""),
  supabase: {
    url: supabase.url,
    anonKey: supabase.anonKey,
    serviceRoleKey: supabase.serviceRoleKey,
    isPublicConfigured: supabase.isPublicConfigured,
    /** Полная серверная конфигурация (URL + anon + service role) */
    isConfigured: supabase.isConfigured,
  },
  telegram: {
    /** Может быть дозаполнен через getMe при старте (telegram-service.init) */
    botUsername: telegram.botUsername,
    token: telegram.token,
    webhookSecret: telegram.webhookSecret,
    isConfigured: telegram.isConfigured,
  },
  kaspi: {
    recipient: kaspi.recipient,
    phone: kaspi.phone,
    instructions: kaspi.instructions,
    isConfigured: kaspi.isConfigured,
  },
};

if (process.env.SUPABASE_URL && /\/rest\/v1\/?$/i.test(process.env.SUPABASE_URL.trim())) {
  console.warn(
    "[warn] SUPABASE_URL содержит /rest/v1/ — это REST endpoint, не Project URL."
  );
  console.warn("[warn] URL нормализован (хвост /rest/v1 удалён).");
}

if (config.supabase.isConfigured) {
  console.log("[supabase] configured");
} else if (config.supabase.isPublicConfigured) {
  console.warn(
    "[warn] Supabase публичный ключ есть, но SUPABASE_SERVICE_ROLE_KEY не задан"
  );
} else {
  console.warn(
    "[warn] Supabase не настроен — нужны SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"
  );
}

if (config.kaspi.isConfigured) {
  console.log("[kaspi] payment details configured");
} else {
  console.warn("[warn] Kaspi payment details not fully configured (optional)");
}

/**
 * Проверяет обязательные env. При отсутствии — логирует только ИМЕНА и завершает процесс.
 * Не печатает значения секретов.
 */
function assertRequiredEnvOrExit() {
  const missing = getMissingRequiredEnvNames(process.env);
  if (!missing.length) return;

  for (const name of missing) {
    console.error(`[env] Missing required variable: ${name}`);
  }
  process.exit(1);
}

config.assertRequiredEnvOrExit = assertRequiredEnvOrExit;

module.exports = config;
