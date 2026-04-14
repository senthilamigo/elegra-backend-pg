/**
 * File: src/routes/purchaseOrderRoutes.ts
 * Path: src/routes/purchaseOrderRoutes.ts
 *
 * Purchase order routes.
 *
 * Endpoints:
 *   - GET /api/purchase-orders
 *   - GET /api/purchase-orders/:id
 *   - PUT /api/purchase-orders/:id/status
 *   - POST /api/purchase-orders
 *
 * Access:
 *   - All endpoints require authentication and role >= seller.
 *   - This means both seller and admin users are authorized.
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  listPurchaseOrders,
  getPurchaseOrder,
  updatePurchaseOrderStatus,
  createPurchaseOrder,
} from "../controllers/purchaseOrderController";

const router = Router();

router.get("/purchase-orders", requireAuth, requireRole("seller"), listPurchaseOrders);
router.get("/purchase-orders/:id", requireAuth, requireRole("seller"), getPurchaseOrder);
router.put("/purchase-orders/:id/status", requireAuth, requireRole("seller"), updatePurchaseOrderStatus);
router.post("/purchase-orders", requireAuth, requireRole("seller"), createPurchaseOrder);

export default router;
