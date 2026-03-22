/**
 * File: src/routes/shipmentRoutes.ts
 * Path: ecommerce-admin/src/routes/shipmentRoutes.ts
 *
 * Shipment routes — mixed access:
 *   GET  endpoints — requireAuth (any logged-in user, own data enforced in controller)
 *   POST / PATCH   — requireAuth + requireRole("admin")
 *
 * Route ordering:
 *   /api/orders/:id/shipment is placed before the generic shipment routes
 *   to keep order-scoped routes visually grouped. Express treats these as
 *   distinct path patterns so ordering does not affect matching here.
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getShipment,
  createShipment,
  updateShipment,
  getShipmentByOrder,
} from "../controllers/shipmentController";

const router = Router();

// ─────────────────────────────────────────────
// Order-scoped shipment lookup — auth
// ─────────────────────────────────────────────

/**
 * GET /api/orders/:id/shipment
 * Returns the shipment for a specific order.
 * Non-admin users can only access their own orders.
 */
router.get(
  "/orders/:id/shipment",
  requireAuth,
  getShipmentByOrder
);

// ─────────────────────────────────────────────
// Shipment CRUD
// ─────────────────────────────────────────────

/**
 * GET /api/shipments/:id
 * Returns shipment details joined with the delivery address.
 * Non-admin users can only access shipments for their own orders.
 */
router.get(
  "/shipments/:id",
  requireAuth,
  getShipment
);

/**
 * POST /api/shipments
 * Body: { order_id, address_id, shipment_date? }
 * Creates a shipment for an order. One shipment per order (409 on duplicate).
 */
router.post(
  "/shipments",
  requireAuth, requireRole("admin"),
  createShipment
);

/**
 * PATCH /api/shipments/:id
 * Body: { shipment_date?, address_id? } — at least one required.
 * Updates the dispatch date and/or delivery address.
 */
router.patch(
  "/shipments/:id",
  requireAuth, requireRole("admin"),
  updateShipment
);

export default router;
