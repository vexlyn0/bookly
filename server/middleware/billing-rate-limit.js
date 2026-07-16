/**
 * Rate limit для создания заявок на ручную оплату
 */

const rateLimit = require("express-rate-limit");

const paymentRequestCreateLimiter =
  process.env.BOOKLY_DISABLE_BILLING_RATE_LIMIT === "1"
    ? (req, res, next) => next()
    : rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id || req.ip,
        handler: (req, res) => {
          res.status(429).json({
            ok: false,
            code: "TOO_MANY_PAYMENT_REQUESTS",
            message: "Слишком много заявок. Попробуйте позже.",
          });
        },
      });

module.exports = { paymentRequestCreateLimiter };
