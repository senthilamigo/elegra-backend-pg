/**
 * File: src/routes/analyticsRoutes.ts
 * Path: src/routes/analyticsRoutes.ts
 *
 * Supplier analytics and cost analysis routes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints registered:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   GET /api/analytics/suppliers
 *     Aggregated supplier performance metrics per supplier.
 *
 *     Metrics per supplier:
 *       - total_supplied_quantity    — total units ever received from this supplier
 *       - total_remaining_quantity   — units still in stock from this supplier
 *       - avg_unit_cost              — average unit cost across all batches
 *       - avg_landed_cost            — average landed cost (unit + allocated shipping)
 *       - avg_delivery_time_days     — average days from purchase order → delivery
 *       - return_rate_pct            — (returned units / supplied units) × 100
 *       - total_units_returned       — total units returned to this supplier
 *       - total_inbound_shipments    — number of inbound supplier shipments
 *       - total_purchase_orders      — number of purchase orders placed
 *       - total_returns              — number of supplier return requests
 *
 *     Optional query params:
 *       ?seller_id=<uuid>   — admin only: scope metrics to a specific seller
 *
 *   GET /api/analytics/costs
 *     Full cost breakdown for the caller's inventory.
 *
 *     Summary metrics:
 *       - total_inbound_cost          — sum(unit_cost × quantity) across all batches
 *       - total_inbound_shipping_cost — sum of shipment_cost_allocations.allocated_cost
 *       - total_landed_cost           — sum(landed_cost × remaining_quantity)
 *       - total_return_cost           — sum of return_shipment_cost_allocations.allocated_cost
 *       - net_inventory_cost          — total_landed_cost − total_return_cost
 *
 *     Also returns per-product and per-supplier cost breakdowns.
 *
 *     Optional query params:
 *       ?seller_id=<uuid>   — admin only: scope costs to a specific seller
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Access model
 * ─────────────────────────────────────────────────────────────────────────────
 *   Both endpoints require authentication and role >= seller.
 *   requireRole("seller") permits both seller and admin users via the role
 *   hierarchy (customer < seller < admin).
 *   Seller-level data scoping is enforced at the controller level.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Route registration in src/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 *   Add the following import and app.use() call in src/index.ts:
 *
 *     import analyticsRoutes from "./routes/analyticsRoutes";
 *     app.use("/api", analyticsRoutes);
 *
 *   Recommended placement: after the supplier workflow routers (and traceRoutes)
 *   and before adminRoutes, grouping it with the other per-route-guarded
 *   seller+ routers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Guard pattern
 * ─────────────────────────────────────────────────────────────────────────────
 *   Per-route guards (requireAuth + requireRole on each handler) are used
 *   rather than a blanket router.use(). This is consistent with the rest of
 *   the codebase and avoids the middleware-leakage bug documented in
 *   src/routes/adminRoutes.ts.
 */

import { Router }                   from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getSupplierAnalytics,
  getCostAnalytics,
} from "../controllers/analyticsController";

const router = Router();

// ─────────────────────────────────────────────
// GET /api/analytics/suppliers — seller+
//
// Aggregated performance metrics for each supplier linked to the
// caller's products (or all suppliers for admins).
//
// Optional query params:
//   ?seller_id=<uuid>   — admin only: filter to a specific seller
// ─────────────────────────────────────────────
router.get(
  "/analytics/suppliers",
  requireAuth,
  requireRole("seller"),
  getSupplierAnalytics
);

// ─────────────────────────────────────────────
// GET /api/analytics/costs — seller+
//
// Full cost breakdown: inbound procurement cost, allocated shipping cost,
// landed cost, return shipment cost, and net inventory cost.
// Returned as a summary plus per-product and per-supplier breakdowns.
//
// Optional query params:
//   ?seller_id=<uuid>   — admin only: filter to a specific seller
// ─────────────────────────────────────────────
router.get(
  "/analytics/costs",
  requireAuth,
  requireRole("seller"),
  getCostAnalytics
);

export default router;
