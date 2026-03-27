/**
 * File: src/routes/adminRoutes.ts
 * Path: ecommerce-admin/src/routes/adminRoutes.ts
 *
 * Admin analytics routes — all require a valid JWT + admin role.
 *
 *   GET /api/admin/dashboard    — KPIs: revenue, orders, users, top products
 *   GET /api/admin/sales-report — Aggregated sales with date-range filter
 *   GET /api/admin/inventory    — Low-stock variants across all sellers
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getDashboard,
  getSalesReport,
  getInventory,
} from "../controllers/adminController";

const router = Router();

// All admin analytics routes require a valid JWT + admin role
router.use(requireAuth, requireRole("admin"));

/** GET /api/admin/dashboard
 *  KPIs: total/monthly revenue, order counts by status,
 *  user counts by role, top 5 products by units sold.
 */
router.get("/admin/dashboard", getDashboard);

/** GET /api/admin/sales-report
 *  Query params: ?from=YYYY-MM-DD  ?to=YYYY-MM-DD  ?group_by=day|month
 *  Returns time-series breakdown, payment-type split, and category split.
 */
router.get("/admin/sales-report", getSalesReport);

/** GET /api/admin/inventory
 *  Query params: ?threshold=<n>  ?seller_id=<uuid>  ?page=  ?limit=
 *  Returns active variants with stock at or below the threshold.
 */
router.get("/admin/inventory", getInventory);

export default router;
