/**
 * Webhook Telegram-бота
 * POST /api/telegram/webhook
 *
 * Telegram передаёт secret_token (см. scripts/telegram-setup.js) в заголовке
 * X-Telegram-Bot-Api-Secret-Token — без него запрос отклоняется.
 */

const { Router } = require("express");
const telegramService = require("../lib/telegram-service");

const router = Router();

router.post("/webhook", async (req, res) => {
  if (!telegramService.isWebhookEnabled()) {
    return res.sendStatus(404);
  }

  if (!telegramService.verifyWebhookSecret(req.get("x-telegram-bot-api-secret-token"))) {
    return res.sendStatus(401);
  }

  try {
    await telegramService.handleUpdate(req.body || {});
  } catch (error) {
    console.error("[telegram] update failed:", error?.code || error?.name || "unknown");
  }

  // Всегда 200: иначе Telegram будет бесконечно повторять доставку обновления.
  return res.sendStatus(200);
});

module.exports = router;
