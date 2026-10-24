/**
 * Публичные API-маршруты онлайн-записи
 */

const { Router } = require("express");
const {
  requirePublicOrganization,
  toPublicOrganization,
  getPublicProfile,
  getPublicServices,
  getPublicStaff,
  getPublicSlots,
  createPublicBooking,
  createPhoneVerification,
} = require("../lib/public-booking-service");
const { bookingCreateLimiter } = require("../middleware/booking-rate-limit");
const clientManage = require("../lib/client-manage-service");
const phoneVerification = require("../lib/phone-verification-service");

const rateLimit = require("express-rate-limit");

const verificationCreateLimiter =
  process.env.BOOKLY_DISABLE_BOOKING_RATE_LIMIT === "1"
    ? (req, res, next) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
          res.status(429).json({
            ok: false,
            code: "TOO_MANY_BOOKING_ATTEMPTS",
            message: "Слишком много попыток. Попробуйте позже",
          });
        },
      });

/** Адрес сайта для ссылок в сообщениях (Render стоит за прокси). */
function getBaseUrl(req) {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}

const router = Router();

function sendError(res, error) {
  const status = error.status || 500;
  const code = error.code || "VALIDATION_ERROR";
  const message = error.message || "Не удалось выполнить запрос";

  if (status >= 500) {
    console.error("[public-booking]", code);
  } else {
    console.warn("[public-booking]", code);
  }

  return res.status(status).json({
    ok: false,
    code,
    message,
  });
}

router.get("/organizations/:slug", async (req, res) => {
  try {
    const organization = await requirePublicOrganization(req.params.slug);
    return res.json({
      ok: true,
      organization: { ...toPublicOrganization(organization), ...(await getPublicProfile(organization)) },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/organizations/:slug/services", async (req, res) => {
  try {
    const services = await getPublicServices(req.params.slug);
    return res.json({ ok: true, services });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/organizations/:slug/staff", async (req, res) => {
  try {
    const serviceId = String(req.query.service_id || "").trim();
    if (!serviceId) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "service_id обязателен",
      });
    }

    const staff = await getPublicStaff(req.params.slug, serviceId);
    return res.json({ ok: true, staff });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/organizations/:slug/slots", async (req, res) => {
  try {
    const result = await getPublicSlots(req.params.slug, {
      serviceId: String(req.query.service_id || "").trim(),
      staffId: String(req.query.staff_id || "").trim(),
      date: String(req.query.date || "").trim(),
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(
  "/organizations/:slug/bookings",
  bookingCreateLimiter,
  async (req, res) => {
    try {
      const honeypotFilled = Boolean(String(req.body?.website || "").trim());
      const result = await createPublicBooking(req.params.slug, req.body, {
        honeypotFilled,
        baseUrl: getBaseUrl(req),
      });
      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  }
);

// Подтверждение номера через Telegram-бота
router.post("/organizations/:slug/phone-verifications", verificationCreateLimiter, async (req, res) => {
  try {
    const result = await createPhoneVerification(req.params.slug, req.body || {});
    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/phone-verifications/:token", async (req, res) => {
  try {
    const result = await phoneVerification.getStatus(req.params.token);
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

// Личная ссылка клиента на запись: просмотр, отмена, перенос.
router.get("/manage/:token", async (req, res) => {
  try {
    const result = await clientManage.getManageInfo(req.params.token);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/manage/:token/slots", async (req, res) => {
  try {
    const result = await clientManage.getManageSlots(req.params.token, String(req.query.date || "").trim());
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/manage/:token/cancel", bookingCreateLimiter, async (req, res) => {
  try {
    const result = await clientManage.cancelByToken(req.params.token);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/manage/:token/reschedule", bookingCreateLimiter, async (req, res) => {
  try {
    const result = await clientManage.rescheduleByToken(req.params.token, req.body || {});
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
