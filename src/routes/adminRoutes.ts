/**
 * File: src/routes/adminRoutes.ts
 * Path: ecommerce-admin/src/routes/adminRoutes.ts
 *
 * Admin analytics routes — all require a valid JWT + admin role.
 *
 *   GET /api/admin/dashboard    — KPIs: revenue, orders, users, top products
 *   GET /api/admin/sales-report — Aggregated sales with date-range filter
 *   GET /api/admin/inventory    — Low-stock variants across all sellers
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUG FIX (April 2026) — "Access denied. This endpoint requires the 'admin'
 * role or above" on GET /api/cart and other non-admin routes.
 *
 * ROOT CAUSE:
 *   The original code used:
 *
 *     router.use(requireAuth, requireRole("admin"));
 *
 *   router.use() without a path prefix registers the middleware for ALL paths
 *   that enter this router. Because Express passes every /api/* request
 *   through adminRoutes (registered before cartRoutes / usersRoutes etc. in
 *   src/index.ts), the requireRole("admin") guard fired on requests like
 *   GET /api/cart, returning 403 to customer-role users even though those
 *   routes aren't in this file.
 *
 *   The middleware ran, found no route match in adminRoutes, but the 403
 *   response was already sent before Express could try the next router.
 *
 * FIX:
 *   Replace the blanket router.use() with per-route middleware on each handler.
 *   This means requireAuth + requireRole("admin") only fires when a request
 *   actually matches one of the three admin paths — not on every /api/* request.
 *
 * ALSO REQUIRED in src/index.ts:
 *   Ensure adminRoutes is registered AFTER the public/per-route-guarded routers
 *   (categoriesRoutes, productsRoutes, reviewRoutes, sellersRoutes) and BEFORE
 *   the other blanket-auth routers. The current order in the original index.ts
 *   already has this correct, but the per-route fix here makes the order
 *   less fragile going forward.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getDashboard,
  getSalesReport,
  getInventory,
} from "../controllers/adminController";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// FIX: Per-route guards instead of blanket router.use().
//
// BEFORE (buggy):
//   router.use(requireAuth, requireRole("admin"));
//   router.get("/admin/dashboard", getDashboard);
//
// AFTER (correct):
//   router.get("/admin/dashboard", requireAuth, requireRole("admin"), getDashboard);
//
// The blanket router.use() form runs the middleware for EVERY request that
// enters this router, including requests for paths not defined here (e.g.
// /api/cart). Express would reject those with 403 before cartRoutes could
// handle them. Per-route guards only fire when the path actually matches.
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/admin/dashboard
 *  KPIs: total/monthly revenue, order counts by status,
 *  user counts by role, top 5 products by units sold.
 */
router.get(
  "/admin/dashboard",
  requireAuth,
  requireRole("admin"),
  getDashboard
);

/** GET /api/admin/sales-report
 *  Query params: ?from=YYYY-MM-DD  ?to=YYYY-MM-DD  ?group_by=day|month
 *  Returns time-series breakdown, payment-type split, and category split.
 */
router.get(
  "/admin/sales-report",
  requireAuth,
  requireRole("admin"),
  getSalesReport
);

/** GET /api/admin/inventory
 *  Query params: ?threshold=<n>  ?seller_id=<uuid>  ?page=  ?limit=
 *  Returns active variants with stock at or below the threshold.
 */
router.get(
  "/admin/inventory",
  requireAuth,
  requireRole("admin"),
  getInventory
);

export default router;
