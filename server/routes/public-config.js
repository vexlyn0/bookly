/**
 * GET /api/public-config
 * Публичная конфигурация для клиента (Supabase Auth)
 */

const { Router } = require("express");
const config = require("../config");

const router = Router();

router.get("/", (req, res) => {
  if (!config.supabase.isConfigured) {
    return res.status(503).json({
      ok: false,
      message: "Supabase не настроен. Заполните SUPABASE_URL и SUPABASE_ANON_KEY в .env",
    });
  }

  return res.json({
    ok: true,
    supabaseUrl: config.supabase.url,
    supabaseAnonKey: config.supabase.anonKey,
  });
});

module.exports = router;
