/**
 * GET /api/public-config
 * Публичная конфигурация для клиента (Supabase Auth)
 */

const { Router } = require("express");
const config = require("../config");

const router = Router();

router.get("/", (req, res) => {
  if (!config.supabase.isPublicConfigured) {
    return res.status(503).json({
      ok: false,
      code: "SUPABASE_NOT_CONFIGURED",
      message: "Сервис авторизации временно недоступен. Попробуйте позже.",
    });
  }

  return res.json({
    ok: true,
    supabaseUrl: config.supabase.url,
    supabaseAnonKey: config.supabase.anonKey,
  });
});

module.exports = router;
