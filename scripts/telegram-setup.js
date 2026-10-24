/**
 * Регистрирует webhook и команды Telegram-бота.
 * Секреты не печатаются.
 *
 * Использование:
 *   npm run telegram:setup -- https://your-app.onrender.com
 *   npm run telegram:setup -- --info      (только показать состояние webhook)
 */

const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const arg = String(process.argv[2] || "").trim();

function fail(message) {
  console.error(`[error] ${message}`);
  process.exit(1);
}

async function callApi(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => null);
  if (!data?.ok) {
    fail(`${method}: ${data?.description || response.status}`);
  }
  return data.result;
}

async function printInfo() {
  const info = await callApi("getWebhookInfo");
  console.log("[info] webhook url:", info.url || "(не задан)");
  console.log("[info] pending updates:", info.pending_update_count);
  if (info.last_error_message) {
    console.log("[info] last error:", info.last_error_message);
  }
}

async function main() {
  if (!token) fail("TELEGRAM_BOT_TOKEN не задан в .env");

  const me = await callApi("getMe");
  console.log(`[ok] Бот: @${me.username}`);

  if (arg === "--info") {
    await printInfo();
    return;
  }

  if (!secret) fail("TELEGRAM_WEBHOOK_SECRET не задан в .env");
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
    fail("TELEGRAM_WEBHOOK_SECRET: 16–256 символов, только A-Z a-z 0-9 _ -");
  }

  let baseUrl;
  try {
    baseUrl = new URL(arg);
  } catch {
    fail("Укажите публичный https-адрес приложения: npm run telegram:setup -- https://your-app.onrender.com");
  }
  if (baseUrl.protocol !== "https:") fail("Telegram принимает webhook только по https");

  const webhookUrl = new URL("/api/telegram/webhook", baseUrl).toString();

  await callApi("setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  console.log(`[ok] Webhook: ${webhookUrl}`);

  await callApi("setMyCommands", {
    commands: [
      { command: "start", description: "Подключить уведомления Jazyl" },
      { command: "stop", description: "Отключить уведомления" },
    ],
  });
  console.log("[ok] Команды бота обновлены");

  if (process.env.TELEGRAM_BOT_USERNAME && process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, "") !== me.username) {
    console.warn(`[warn] TELEGRAM_BOT_USERNAME не совпадает с @${me.username}`);
  }

  await printInfo();
}

main().catch((error) => fail(error.message));
