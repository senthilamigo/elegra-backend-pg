/**
 * File: src/routes/orderRoutes.ts
 * Path: ecommerce-admin/src/routes/orderRoutes.ts
 *
 * Order and payment routes.
 *
 * Route ordering rules applied here:
 *   1. /api/payments/initiate and /api/payments/verify must come BEFORE
 *      /api/payments/:id — otherwise Express matches "initiate"/"verify"
 *      as a UUID param.
 *   2. /api/seller/orders must come BEFORE /api/orders/:id.
 *   3. /api/orders/:id/items, /api/orders/:id/status, /api/orders/:id/payment
 *      all have a sub-path suffix so they safely come after /api/orders/:id
 *      in Express matching.
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  listOrders,
  getOrder,
  placeOrder,
  updateOrderStatus,
  cancelOrder,
  getSellerOrders,
  getOrderItems,
  initiatePayment,
  verifyPayment,
  getPayment,
  getOrderPayment,
  refundPayment,
} from "../controllers/orderController";

const router = Router();

// ─────────────────────────────────────────────
// Seller-scoped — must be before /:id routes
// ─────────────────────────────────────────────

/** GET /api/seller/orders — orders containing the seller's products */
router.get("/seller/orders", requireAuth, requireRole("seller"), getSellerOrders);

// ─────────────────────────────────────────────
// Orders — auth / admin
// ─────────────────────────────────────────────

/** GET /api/orders — customers see own; admins see all; ?status= filter */
router.get("/orders", requireAuth, listOrders);

/** POST /api/orders — place order from cart */
router.post("/orders", requireAuth, placeOrder);

/** GET /api/orders/:id — order + line items */
router.get("/orders/:id", requireAuth, getOrder);

/** PATCH /api/orders/:id/status — admin: update status */
router.patch("/orders/:id/status", requireAuth, requireRole("admin"), updateOrderStatus);

/** DELETE /api/orders/:id — cancel (pending only) */
router.delete("/orders/:id", requireAuth, cancelOrder);

/** GET /api/orders/:id/items — line items for an order */
router.get("/orders/:id/items", requireAuth, getOrderItems);

/** GET /api/orders/:id/payment — payment record for an order */
router.get("/orders/:id/payment", requireAuth, getOrderPayment);

// ─────────────────────────────────────────────
// Payments
// ─────────────────────────────────────────────

/** POST /api/payments/initiate — create payment record for an order */
router.post("/payments/initiate", requireAuth, initiatePayment);

/**
 * POST /api/payments/verify — webhook: confirm payment from gateway
 * Public — no token required (called by payment gateway).
 * Webhook secret validated inside the controller.
 */
router.post("/payments/verify", verifyPayment);

/** GET /api/payments/:id — get payment by ID */
router.get("/payments/:id", requireAuth, getPayment);

/** POST /api/payments/:id/refund — admin: initiate refund */
router.post("/payments/:id/refund", requireAuth, requireRole("admin"), refundPayment);

export default router;
