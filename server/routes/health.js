/**
 * GET /api/health
 */

const { Router } = require("express");
const config = require("../config");

const router = Router();

router.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "bookly",
    version: "0.1.0",
    environment: config.nodeEnv,
    supabaseConfigured: config.supabase.isConfigured,
  });
});

module.exports = router;
