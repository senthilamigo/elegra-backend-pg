/**
 * File: src/routes/supplierReturnShipmentRoutes.ts
 * Path: src/routes/supplierReturnShipmentRoutes.ts
 *
 * Express routes for the supplier return shipment endpoints.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints registered:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   POST /api/supplier-return-shipments
 *     Full atomic creation workflow:
 *       1. INSERT supplier_return_shipments
 *       2. INSERT supplier_return_shipment_items
 *       3. Calculate total quantity
 *       4. INSERT return_shipment_cost_allocations (proportional distribution)
 *     Compensating rollback on failure after the parent row is inserted.
 *
 *   GET /api/supplier-return-shipments
 *     Paginated list of return shipments visible to the caller.
 *     Supports ?return_id=, ?status=, ?seller_id= (admin only), ?page=, ?limit=.
 *
 *   GET /api/supplier-return-shipments/:id
 *     Single return shipment enriched with supplier_returns context,
 *     line items (with inventory_batch details), and cost allocations.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Access model
 * ─────────────────────────────────────────────────────────────────────────────
 *   All endpoints require authentication and role >= seller.
 *   requireRole("seller") permits both seller and admin users via the role
 *   hierarchy (customer < seller < admin).
 *   Seller-level data scoping is enforced at the controller level.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Route registration in src/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 *   Add the following import and app.use() call in src/index.ts:
 *
 *     import supplierReturnShipmentRoutes from "./routes/supplierReturnShipmentRoutes";
 *     app.use("/api", supplierReturnShipmentRoutes);
 *
 *   Recommended placement: after supplierReturnRoutes and before
 *   supplierReplacementRoutes, grouping all supplier-workflow routers together
 *   in the per-route-guarded section (before adminRoutes).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Guard pattern
 * ─────────────────────────────────────────────────────────────────────────────
 *   Per-route guards are used (requireAuth + requireRole on each handler)
 *   rather than a blanket router.use(). This is consistent with the rest of
 *   the codebase and avoids the middleware-leakage bug documented in
 *   src/routes/adminRoutes.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Route ordering note
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/supplier-return-shipments (list) is registered before
 *   GET /api/supplier-return-shipments/:id (single) so Express matches the
 *   literal list path first. This is the same ordering pattern used in
 *   supplierReturnRoutes.ts, supplierShipmentRoutes.ts, etc.
 */

import { Router }                   from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  createSupplierReturnShipment,
  listSupplierReturnShipments,
  getSupplierReturnShipment,
} from "../controllers/supplierReturnShipmentController";

const router = Router();

// ─────────────────────────────────────────────
// POST /api/supplier-return-shipments — seller+
//
// Creates a return shipment record including:
//   - supplier_return_shipments header row
//   - supplier_return_shipment_items line items
//   - return_shipment_cost_allocations (proportional cost per batch)
//
// Body: {
//   return_id:       string (UUID, required)
//   courier_name?:   string | null
//   tracking_number?: string | null
//   shipment_date?:  ISO 8601 datetime | null
//   delivery_date?:  ISO 8601 datetime | null
//   shipping_cost?:  number (default 0)
//   status?:         'in_transit' | 'delivered' (default 'in_transit')
//   items: [
//     { inventory_batch_id: string (UUID), quantity: number }
//     ...
//   ]
// }
// ─────────────────────────────────────────────
router.post(
  "/supplier-return-shipments",
  requireAuth,
  requireRole("seller"),
  createSupplierReturnShipment
);

// ─────────────────────────────────────────────
// GET /api/supplier-return-shipments — seller+
//
// Returns paginated list. Must be registered BEFORE /:id route.
//
// Query params:
//   ?return_id=<uuid>   — filter by supplier_return
//   ?status=<value>     — 'in_transit' | 'delivered'
//   ?seller_id=<uuid>   — admin only: filter by seller
//   ?page=<n>           — default 1
//   ?limit=<n>          — default 20, max 100
// ─────────────────────────────────────────────
router.get(
  "/supplier-return-shipments",
  requireAuth,
  requireRole("seller"),
  listSupplierReturnShipments
);

// ─────────────────────────────────────────────
// GET /api/supplier-return-shipments/:id — seller+
//
// Returns a single return shipment enriched with:
//   - supplier_returns context (reason, status, seller_id)
//   - suppliers context (name, status)
//   - items with inventory_batch details
//   - cost_allocations with total_allocated_cost
// ─────────────────────────────────────────────
router.get(
  "/supplier-return-shipments/:id",
  requireAuth,
  requireRole("seller"),
  getSupplierReturnShipment
);

export default router;
