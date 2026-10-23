/**
 * API записей кабинета
 * POST /api/bookings/notify — уведомить мастера в Telegram об изменении записи
 */

const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const { notifyBookingChange } = require("../lib/booking-notify-service");

const router = Router();

const notifyLimiter =
  process.env.BOOKLY_DISABLE_BOOKING_RATE_LIMIT === "1"
    ? (req, res, next) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id || req.ip,
        handler: (req, res) => {
          res.status(429).json({ ok: false, code: "TOO_MANY_REQUESTS", message: "Слишком много запросов" });
        },
      });

router.post("/notify", requireAuth, notifyLimiter, async (req, res) => {
  try {
    const result = await notifyBookingChange(req.user.id, req.body || {});
    return res.json({ ok: true, ...result });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error("[bookings] notify", error.code || "INTERNAL_ERROR");
    return res.status(status).json({
      ok: false,
      code: error.code || "INTERNAL_ERROR",
      message: status >= 500 ? "Не удалось отправить уведомление" : error.message,
    });
  }
});

module.exports = router;
