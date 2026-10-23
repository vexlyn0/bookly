/**
 * API ручной оплаты подписки (владелец организации)
 */

const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { paymentRequestCreateLimiter } = require("../middleware/billing-rate-limit");
const billingService = require("../lib/billing-service");

const router = Router();

function sendError(res, error) {
  const status = error.status || 500;
  const code = error.code || "INTERNAL_ERROR";
  const message = error.message || "Не удалось выполнить запрос";

  if (status >= 500) {
    console.error("[billing]", code);
  }

  return res.status(status).json({ ok: false, code, message });
}

router.get("/payment-info", requireAuth, async (req, res) => {
  try {
    const data = await billingService.getPaymentInfo(req.user.id);
    return res.json({ ok: true, ...data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/payment-requests", requireAuth, async (req, res) => {
  try {
    const requests = await billingService.listPaymentRequests(req.user.id);
    return res.json({ ok: true, requests });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/payment-requests", requireAuth, paymentRequestCreateLimiter, async (req, res) => {
  try {
    const requestRow = await billingService.createPaymentRequest(req.user.id, req.body || {});
    return res.status(201).json({ ok: true, request: requestRow });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/start-trial", requireAuth, paymentRequestCreateLimiter, async (req, res) => {
  try {
    const info = await billingService.startProTrial(req.user.id);
    return res.json({ ok: true, ...info });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/payment-requests/:id/cancel", requireAuth, async (req, res) => {
  try {
    const requestRow = await billingService.cancelPaymentRequest(req.user.id, req.params.id);
    return res.json({ ok: true, request: requestRow });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
