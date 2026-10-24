/**
 * API глобальной панели platform admin
 */

const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { requirePlatformAdmin } = require("../middleware/platform-admin");
const platformAdminService = require("../lib/platform-admin-service");

const router = Router();

function sendError(res, error) {
  const status = error.status || 500;
  const code = error.code || "INTERNAL_ERROR";
  const message = error.message || "Не удалось выполнить запрос";

  if (status >= 500) {
    console.error("[admin-api]", code);
  }

  return res.status(status).json({ ok: false, code, message });
}

router.use(requireAuth);
router.use(requirePlatformAdmin);

router.get("/me", (req, res) => {
  return res.json({
    ok: true,
    admin: {
      user_id: req.user.id,
      email: req.user.email,
      role: req.platformAdmin.role,
    },
  });
});

router.get("/overview", async (req, res) => {
  try {
    const overview = await platformAdminService.getOverview();
    return res.json({ ok: true, overview });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/organizations", async (req, res) => {
  try {
    const result = await platformAdminService.listOrganizations({
      search: req.query.search,
      segment: req.query.segment,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/audit", async (req, res) => {
  try {
    const items = await platformAdminService.listAuditLog({ limit: req.query.limit });
    return res.json({ ok: true, items });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/organizations/:id", async (req, res) => {
  try {
    const detail = await platformAdminService.getOrganizationDetail(req.params.id);
    return res.json({ ok: true, ...detail });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/payment-requests", async (req, res) => {
  try {
    const result = await platformAdminService.listPaymentRequests({
      status: req.query.status,
      organizationId: req.query.organization,
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/payment-requests/:id/approve", async (req, res) => {
  try {
    const result = await platformAdminService.approvePaymentRequest(
      req.params.id,
      req.user.id,
      req.body?.admin_note
    );
    return res.json({ ok: true, result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/payment-requests/:id/reject", async (req, res) => {
  try {
    const adminNote = String(req.body?.admin_note || "").trim();
    if (!adminNote) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "Укажите причину отказа.",
      });
    }
    if (adminNote.length > 500) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "Причина отказа слишком длинная.",
      });
    }

    const requestRow = await platformAdminService.rejectPaymentRequest(
      req.params.id,
      req.user.id,
      adminNote
    );
    return res.json({ ok: true, request: requestRow });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/organizations/:id/extend", async (req, res) => {
  try {
    const days = Number(req.body?.days);
    const reason = String(req.body?.reason || "").trim();

    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "days должен быть от 1 до 365.",
      });
    }

    if (!reason) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "Укажите причину продления.",
      });
    }
    if (reason.length > 500) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "Причина продления слишком длинная.",
      });
    }

    const subscription = await platformAdminService.extendSubscription(
      req.params.id,
      req.user.id,
      days,
      reason
    );
    return res.json({ ok: true, subscription });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/organizations/:id/suspend", async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "Укажите причину приостановки.",
      });
    }
    if (reason.length > 500) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "Причина приостановки слишком длинная.",
      });
    }

    const subscription = await platformAdminService.suspendOrganization(
      req.params.id,
      req.user.id,
      reason
    );
    return res.json({ ok: true, subscription });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/organizations/:id/unsuspend", async (req, res) => {
  try {
    const subscription = await platformAdminService.unsuspendOrganization(
      req.params.id,
      req.user.id
    );
    return res.json({ ok: true, subscription });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
