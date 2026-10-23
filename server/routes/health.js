/**
 * GET /api/health
 * Безопасный статус конфигурации без секретов и реквизитов.
 */

const { Router } = require("express");
const config = require("../config");

const router = Router();

router.get("/", (req, res) => {
  res.json({
    ok: true,
    supabase_configured: Boolean(config.supabase.isConfigured),
    kaspi_configured: Boolean(config.kaspi.isConfigured),
    telegram_configured: Boolean(config.telegram.isConfigured),
    telegram_webhook_configured: Boolean(
      config.telegram.isConfigured && config.telegram.webhookSecret
    ),
  });
});

module.exports = router;
