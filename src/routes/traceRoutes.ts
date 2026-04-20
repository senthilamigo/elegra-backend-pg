/**
 * File: src/routes/traceRoutes.ts
 * Path: src/routes/traceRoutes.ts
 *
 * Supply-chain traceability routes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints registered:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   GET /api/trace/product/:variantId
 *     Traces a product variant back to its supplier(s).
 *     Walks: product_variants → inventory_batches → suppliers
 *     Returns all inventory batches for the variant with supplier and
 *     purchase-order context, plus a summary of distinct suppliers.
 *
 *   GET /api/trace/order/:orderId
 *     Traces a customer order back to the supplier(s) via its line items.
 *     Walks: orders → order_details → inventory_batches → suppliers
 *     Returns per-line-item batch/supplier detail and a top-level summary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Access model
 * ─────────────────────────────────────────────────────────────────────────────
 *   Both endpoints require authentication and role >= seller.
 *   requireRole("seller") permits both seller and admin users via the role
 *   hierarchy (customer < seller < admin).
 *   Seller-level data scoping (own products / own orders) is enforced at the
 *   controller level.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Route registration in src/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 *   Add the following import and app.use() call in src/index.ts:
 *
 *     import traceRoutes from "./routes/traceRoutes";
 *     app.use("/api", traceRoutes);
 *
 *   Recommended placement: after the supplier workflow routers and before
 *   adminRoutes, grouping it with the other per-route-guarded seller+ routers.
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
  traceProductVariant,
  traceOrder,
} from "../controllers/traceController";

const router = Router();

// ─────────────────────────────────────────────
// GET /api/trace/product/:variantId — seller+
//
// Traces a product variant back to its supplier(s).
//
// Path param:
//   :variantId — UUID of the product_variants row
//
// Response:
//   {
//     variant:  { id, sku, color, size, material, base_price, product: {...} }
//     batches:  InventoryBatch[]  (with supplier + shipment context)
//     summary:  { total_batches, total_quantity_received,
//                 total_remaining_quantity, supplier_count, suppliers[] }
//   }
// ─────────────────────────────────────────────
router.get(
  "/trace/product/:variantId",
  requireAuth,
  requireRole("seller"),
  traceProductVariant
);

// ─────────────────────────────────────────────
// GET /api/trace/order/:orderId — seller+
//
// Traces a customer order back to the supplier(s) via its line items.
//
// Path param:
//   :orderId — UUID of the orders row
//
// Response:
//   {
//     order:      { id, user_id, amount, status, order_date, … }
//     line_items: [
//       {
//         order_detail: { id, product_id, quantity, unit_price }
//         variant:      { id, sku, color, size, … }
//         product:      { id, name, product_code, seller_id }
//         batches:      InventoryBatch[]  (with supplier + shipment context)
//       }
//       …
//     ]
//     summary: { total_line_items, total_batches, supplier_count, suppliers[] }
//   }
// ─────────────────────────────────────────────
router.get(
  "/trace/order/:orderId",
  requireAuth,
  requireRole("seller"),
  traceOrder
);

export default router;
