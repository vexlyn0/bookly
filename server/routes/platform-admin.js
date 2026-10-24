/**
 * API глобальной панели platform admin
 */

const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { requirePlatformAdmin } = require("../middleware/platform-admin");
const platformAdminService = require("../lib/platform-admin-service");
const manage = require("../lib/platform-admin-manage");

/** Адрес сайта для ссылок (Render стоит за прокси). */
function baseUrl(req) {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}

/** Действие админа: выполнить, сбросить кеш показателей, вернуть результат. */
function action(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req);
      platformAdminService.invalidateSnapshot();
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  };
}

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

// Telegram администратора: заявки на оплату Pro приходят в чат
router.get("/telegram", async (req, res) => {
  try {
    const telegram = await require("../lib/admin-bot-service").getStatus(req.user.id);
    return res.json({ ok: true, telegram });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/telegram/disconnect", async (req, res) => {
  try {
    const telegram = await require("../lib/admin-bot-service").disconnect(req.user.id);
    return res.json({ ok: true, telegram });
  } catch (error) {
    return sendError(res, error);
  }
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
    const [detail, contents, ownerInfo] = await Promise.all([
      platformAdminService.getOrganizationDetail(req.params.id),
      manage.organizationContents(req.params.id),
      manage.ownerInfo(req.params.id).catch(() => null),
    ]);
    return res.json({ ok: true, ...detail, ...contents, owner_info: ownerInfo });
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

// --- Управление салоном ------------------------------------------------------

router.patch(
  "/organizations/:id",
  action(async (req) => ({ organization: await manage.updateOrganization(req.params.id, req.user.id, req.body || {}) }))
);

router.post(
  "/organizations/:id/login-link",
  action((req) => manage.ownerLoginLink(req.params.id, req.user.id, baseUrl(req)))
);

router.post(
  "/organizations/:id/owner/email",
  action((req) => manage.changeOwnerEmail(req.params.id, req.user.id, req.body?.email))
);

router.post(
  "/organizations/:id/owner/password-link",
  action((req) => manage.ownerPasswordLink(req.params.id, req.user.id, baseUrl(req)))
);

router.post(
  "/organizations/:id/owner/block",
  action((req) => manage.setOwnerBlocked(req.params.id, req.user.id, true, req.body?.reason))
);

router.post(
  "/organizations/:id/owner/unblock",
  action((req) => manage.setOwnerBlocked(req.params.id, req.user.id, false))
);

router.post(
  "/organizations/:id/revoke-pro",
  action((req) => manage.revokePro(req.params.id, req.user.id, req.body?.reason))
);

router.post(
  "/organizations/:id/delete",
  action((req) =>
    manage.deleteOrganization(req.params.id, req.user.id, {
      confirmSlug: req.body?.confirm_slug,
      deleteOwner: req.body?.delete_owner === true,
    })
  )
);

module.exports = router;
