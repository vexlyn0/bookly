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
  });
});

module.exports = router;
