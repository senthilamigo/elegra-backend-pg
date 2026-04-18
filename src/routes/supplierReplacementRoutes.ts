/**
 * File: src/routes/supplierReplacementRoutes.ts
 * Path: src/routes/supplierReplacementRoutes.ts
 *
 * Express routes for the supplier replacement endpoints.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints registered:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   POST /api/supplier-replacements
 *     Two logical operations share this path, differentiated by the request body:
 *
 *     (A) Record Replacement — body contains a `shipment` sub-object:
 *           Full atomic workflow that creates supplier_return_shipments,
 *           supplier_return_shipment_items, return_shipment_cost_allocations,
 *           and supplier_replacements in one operation.
 *           The controller (recordReplacementShipment) inspects req.body.shipment
 *           to determine which code path to execute.
 *
 *     (B) Create replacement record only — body does NOT contain `shipment`:
 *           Lightweight path that inserts only the supplier_replacements row.
 *           Handled by createSupplierReplacement.
 *
 *     The single route delegates to a dispatcher handler that reads the body
 *     and calls the appropriate controller function. This keeps the route
 *     file's API surface clean while matching the specified endpoint contract.
 *
 *   GET /api/supplier-replacements
 *     Paginated list of supplier_replacements with joined context.
 *     Supports ?return_id=, ?status=, ?seller_id= (admin only), ?page=, ?limit=.
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
 *   Add the following in the API Routes section alongside the other
 *   per-route-guarded routers (before adminRoutes):
 *
 *     import supplierReplacementRoutes from "./routes/supplierReplacementRoutes";
 *     app.use("/api", supplierReplacementRoutes);
 *
 *   Recommended placement: after supplierReturnRoutes and before adminRoutes,
 *   grouping all supplier-workflow routers together.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Guard pattern
 * ─────────────────────────────────────────────────────────────────────────────
 *   Per-route guards are used (requireAuth + requireRole on each handler)
 *   rather than a blanket router.use(). This is consistent with the rest of
 *   the codebase and avoids the middleware-leakage bug documented in
 *   src/routes/adminRoutes.ts.
 */

import { Request, Response, NextFunction } from "express";
import { Router }                          from "express";
import { requireAuth, requireRole }        from "../middleware/auth";
import {
  recordReplacementShipment,
  createSupplierReplacement,
  listSupplierReplacements,
} from "../controllers/supplierReplacementController";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST dispatcher
//
// Both "Record Replacement" and "Create replacement only" share the same
// HTTP method + path combination. The dispatcher inspects whether req.body
// contains a `shipment` key to decide which controller to invoke.
//
// This approach avoids a URL design that would require callers to remember
// two different sub-paths for closely related operations on the same resource,
// and matches the specified API contract.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatcher: routes the POST to either the full shipment-recording workflow
 * or the lightweight record-only path based on the presence of `shipment`.
 *
 * @route POST /api/supplier-replacements
 * @access seller+
 */
function postDispatcher(
  req:  Request,
  res:  Response,
  next: NextFunction
): void {
  // When the body includes a `shipment` object, execute the full atomic
  // workflow (Record Replacement). Otherwise, fall through to the lightweight
  // create path.
  if (req.body && typeof req.body.shipment === "object" && req.body.shipment !== null) {
    recordReplacementShipment(req, res, next);
  } else {
    createSupplierReplacement(req, res, next);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route registrations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/supplier-replacements
 *
 * With body.shipment    → Record Replacement (full atomic workflow)
 * Without body.shipment → Create replacement record only
 *
 * Role: seller+
 */
router.post(
  "/supplier-replacements",
  requireAuth,
  requireRole("seller"),
  postDispatcher
);

/**
 * GET /api/supplier-replacements
 *
 * Returns a paginated list of supplier_replacements.
 * Sellers see only their own. Admins see all.
 *
 * Query params:
 *   ?return_id=<uuid>   — filter by supplier_return
 *   ?status=<value>     — filter by replacement status
 *   ?seller_id=<uuid>   — admin only: filter by seller
 *   ?page=<n>           — page number (default 1)
 *   ?limit=<n>          — items per page (default 20, max 100)
 *
 * Role: seller+
 */
router.get(
  "/supplier-replacements",
  requireAuth,
  requireRole("seller"),
  listSupplierReplacements
);

export default router;
