/**
 * Rate limit для публичного создания записи
 */

const rateLimit = require("express-rate-limit");

const bookingCreateLimiter =
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

module.exports = { bookingCreateLimiter };
