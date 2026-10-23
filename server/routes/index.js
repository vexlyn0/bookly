/**
 * Маршрутизатор API Bookly
 */

const { Router } = require("express");
const healthRoutes = require("./health");
const publicConfigRoutes = require("./public-config");
const publicBookingRoutes = require("./public-booking");
const billingRoutes = require("./billing");
const platformAdminRoutes = require("./platform-admin");
const telegramRoutes = require("./telegram");

const router = Router();

router.use("/api/health", healthRoutes);
router.use("/api/public-config", publicConfigRoutes);
router.use("/api/public", publicBookingRoutes);
router.use("/api/billing", billingRoutes);
router.use("/api/admin", platformAdminRoutes);
router.use("/api/telegram", telegramRoutes);

module.exports = router;
