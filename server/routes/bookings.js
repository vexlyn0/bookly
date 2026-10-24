/**
 * API записей кабинета
 * POST /api/bookings/notify — уведомить мастера в Telegram об изменении записи
 * POST /api/bookings/:id/prepay — владелец подтвердил («paid») или отклонил предоплату
 */

const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const { notifyBookingChange } = require("../lib/booking-notify-service");
const { getSupabaseAdmin } = require("../lib/supabase-admin");
const prepay = require("../lib/prepay-service");

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

router.post("/:id/prepay", requireAuth, notifyLimiter, async (req, res) => {
  try {
    const bookingId = String(req.params.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return res.status(400).json({ ok: false, code: "VALIDATION_ERROR" });

    const booking = await prepay.loadBooking(bookingId);
    const { data: member } = await getSupabaseAdmin()
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", req.user.id)
      .eq("organization_id", booking?.organization_id || "00000000-0000-0000-0000-000000000000")
      .maybeSingle();
    if (!booking || !member) {
      return res.status(404).json({ ok: false, code: "BOOKING_NOT_FOUND", message: "Запись не найдена" });
    }

    const { booking: result, changed } = await prepay.settle(bookingId, req.body?.paid === true);
    return res.json({ ok: true, changed, status: result?.status, prepay_status: result?.prepay_status });
  } catch (error) {
    console.error("[bookings] prepay", error?.code || "INTERNAL_ERROR");
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: "Не удалось сохранить" });
  }
});

module.exports = router;
