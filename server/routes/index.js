/**
 * Маршрутизатор API Bookly
 */

const { Router } = require("express");
const healthRoutes = require("./health");
const publicConfigRoutes = require("./public-config");
const publicBookingRoutes = require("./public-booking");

const router = Router();

router.use("/api/health", healthRoutes);
router.use("/api/public-config", publicConfigRoutes);
router.use("/api/public", publicBookingRoutes);

module.exports = router;
