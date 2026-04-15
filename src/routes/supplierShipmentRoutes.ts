/**
 * File: src/routes/supplierShipmentRoutes.ts
 * Path: src/routes/supplierShipmentRoutes.ts
 *
 * Routes for supplier shipment operations.
 *
 * Endpoints:
 *   - POST /api/supplier-shipments      (create shipment)
 *   - GET  /api/supplier-shipments      (list shipments)
 *   - GET  /api/supplier-shipments/:id  (get shipment)
 *
 * Access:
 *   - seller role and above (seller + admin)
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  createSupplierShipment,
  listSupplierShipments,
  getSupplierShipment,
} from "../controllers/supplierShipmentController";

const router = Router();

router.post("/supplier-shipments", requireAuth, requireRole("seller"), createSupplierShipment);
router.get("/supplier-shipments", requireAuth, requireRole("seller"), listSupplierShipments);
router.get("/supplier-shipments/:id", requireAuth, requireRole("seller"), getSupplierShipment);

export default router;
