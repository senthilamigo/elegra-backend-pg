/**
 * File: src/routes/supplierShipmentRoutes.ts
 * Path: src/routes/supplierShipmentRoutes.ts
 *
 * Routes for supplier shipment operations.
 *
 * Endpoint:
 *   - POST /api/supplier-shipments
 *
 * Access:
 *   - seller role and above (seller + admin)
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { createSupplierShipment } from "../controllers/supplierShipmentController";

const router = Router();

router.post(
  "/supplier-shipments",
  requireAuth,
  requireRole("seller"),
  createSupplierShipment
);

export default router;
