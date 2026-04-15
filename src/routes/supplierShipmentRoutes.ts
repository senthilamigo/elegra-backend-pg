/**
 * File: src/routes/supplierShipmentRoutes.ts
 * Path: src/routes/supplierShipmentRoutes.ts
 *
 * Supplier shipment routes.
 *
 * Endpoints:
 *   - POST /api/supplier-shipments
 *   - GET  /api/supplier-shipments
 *   - GET  /api/supplier-shipments/:id
 *
 * Access:
 *   - All endpoints require authentication and role >= seller.
 *   - This means both seller and admin users are authorized.
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  createSupplierShipment,
  getSupplierShipment,
  listSupplierShipments,
} from "../controllers/supplierShipmentController";

const router = Router();

router.post("/supplier-shipments", requireAuth, requireRole("seller"), createSupplierShipment);
router.get("/supplier-shipments", requireAuth, requireRole("seller"), listSupplierShipments);
router.get("/supplier-shipments/:id", requireAuth, requireRole("seller"), getSupplierShipment);

export default router;
