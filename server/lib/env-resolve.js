/**
 * Чистое разрешение env-флагов Bookly (без dotenv и без логов секретов).
 * Используется config.js и тестами.
 */

function normalizeSupabaseUrl(raw) {
  let url = String(raw || "").trim();
  if (!url) return "";
  url = url.replace(/\/rest\/v1\/?$/i, "");
  url = url.replace(/\/+$/, "");
  return url;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
function resolveSupabaseConfig(env = process.env) {
  const url = normalizeSupabaseUrl(env.SUPABASE_URL);
  const anonKey = firstNonEmpty(env.SUPABASE_ANON_KEY, env.SUPABASE_PUBLISHABLE_KEY);
  const serviceRoleKey = firstNonEmpty(
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.SUPABASE_SECRET_KEY
  );

  return {
    url,
    anonKey,
    serviceRoleKey,
    /** Публичный клиент: URL + anon/publishable */
    isPublicConfigured: Boolean(url && anonKey),
    /** Сервер: URL + anon + service role */
    isConfigured: Boolean(url && anonKey && serviceRoleKey),
  };
}

/**
 * Kaspi считается настроенным только если заданы ВСЕ три переменные.
 * @param {NodeJS.ProcessEnv} env
 */
function resolveKaspiConfig(env = process.env) {
  const recipient = String(env.KASPI_PAYMENT_RECIPIENT || "").trim();
  const phone = String(env.KASPI_PAYMENT_PHONE || "").trim();
  const instructions = String(env.KASPI_PAYMENT_INSTRUCTIONS || "").trim();
  const isConfigured = Boolean(recipient && phone && instructions);

  return {
    recipient: isConfigured ? recipient : "",
    phone: isConfigured ? phone : "",
    instructions: isConfigured ? instructions : "",
    isConfigured,
  };
}

/**
 * Telegram включён, если задан TELEGRAM_BOT_TOKEN.
 * Webhook дополнительно требует TELEGRAM_WEBHOOK_SECRET.
 * @param {NodeJS.ProcessEnv} env
 */
function resolveTelegramConfig(env = process.env) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const webhookSecret = String(env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  const botUsername = String(env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");

  return {
    token,
    webhookSecret,
    botUsername,
    isConfigured: Boolean(token),
  };
}

/**
 * Имена обязательных production-переменных, которых не хватает.
 * Возвращает канонические имена (не алиасы).
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function getMissingRequiredEnvNames(env = process.env) {
  const missing = [];
  if (!String(env.SUPABASE_URL || "").trim()) {
    missing.push("SUPABASE_URL");
  }

  const hasAnon = Boolean(
    String(env.SUPABASE_ANON_KEY || "").trim() ||
      String(env.SUPABASE_PUBLISHABLE_KEY || "").trim()
  );
  if (!hasAnon) {
    missing.push("SUPABASE_ANON_KEY");
  }

  const hasService = Boolean(
    String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim() ||
      String(env.SUPABASE_SECRET_KEY || "").trim()
  );
  if (!hasService) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  return missing;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function getMissingKaspiEnvNames(env = process.env) {
  const missing = [];
  if (!String(env.KASPI_PAYMENT_RECIPIENT || "").trim()) {
    missing.push("KASPI_PAYMENT_RECIPIENT");
  }
  if (!String(env.KASPI_PAYMENT_PHONE || "").trim()) {
    missing.push("KASPI_PAYMENT_PHONE");
  }
  if (!String(env.KASPI_PAYMENT_INSTRUCTIONS || "").trim()) {
    missing.push("KASPI_PAYMENT_INSTRUCTIONS");
  }
  return missing;
}

const REQUIRED_ENV_NAMES = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const OPTIONAL_KASPI_ENV_NAMES = [
  "KASPI_PAYMENT_RECIPIENT",
  "KASPI_PAYMENT_PHONE",
  "KASPI_PAYMENT_INSTRUCTIONS",
];
const OPTIONAL_TELEGRAM_ENV_NAMES = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_BOT_USERNAME",
];

module.exports = {
  normalizeSupabaseUrl,
  resolveSupabaseConfig,
  resolveKaspiConfig,
  resolveTelegramConfig,
  OPTIONAL_TELEGRAM_ENV_NAMES,
  getMissingRequiredEnvNames,
  getMissingKaspiEnvNames,
  REQUIRED_ENV_NAMES,
  OPTIONAL_KASPI_ENV_NAMES,
};
