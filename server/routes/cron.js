/**
 * Плановые задачи
 * POST /api/cron/reminders — разослать напоминания клиентам (Pro).
 *
 * Сервер и сам проверяет напоминания каждые 5 минут, но бесплатный Render
 * засыпает без трафика. Внешний планировщик (например cron-job.org) вызывает
 * этот адрес каждые 5–10 минут с заголовком X-Cron-Secret = CRON_SECRET.
 */

const crypto = require("crypto");
const { Router } = require("express");
const clientBot = require("../lib/client-bot-service");

const router = Router();

function secretMatches(received) {
  const expected = String(process.env.CRON_SECRET || "");
  if (!expected || !received) return false;
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(String(received)).digest();
  return crypto.timingSafeEqual(a, b);
}

async function runReminders(req, res) {
  if (!process.env.CRON_SECRET) return res.sendStatus(404);

  const received = req.get("x-cron-secret") || req.query.secret;
  if (!secretMatches(received)) return res.sendStatus(401);

  const [sent, visitChecks, prepayExpired] = await Promise.all([
    clientBot.sendDueReminders(),
    require("../lib/visit-check-service").sendDueVisitChecks(),
    require("../lib/prepay-service").expireUnpaid(),
  ]);
  return res.json({ ok: true, sent, visit_checks: visitChecks, prepay_expired: prepayExpired });
}

router.post("/reminders", runReminders);
// Многие бесплатные планировщики умеют только GET
router.get("/reminders", runReminders);

module.exports = router;
