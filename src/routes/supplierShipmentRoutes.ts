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
  createSupplierShipment as createSupplierShipmentHandler,
  listSupplierShipments as listSupplierShipmentsHandler,
  getSupplierShipment as getSupplierShipmentHandler,
} from "../controllers/supplierShipmentController";

const supplierShipmentRouter = Router();

supplierShipmentRouter.post("/supplier-shipments", requireAuth, requireRole("seller"), createSupplierShipmentHandler);
supplierShipmentRouter.get("/supplier-shipments", requireAuth, requireRole("seller"), listSupplierShipmentsHandler);
supplierShipmentRouter.get("/supplier-shipments/:id", requireAuth, requireRole("seller"), getSupplierShipmentHandler);

export default supplierShipmentRouter;
