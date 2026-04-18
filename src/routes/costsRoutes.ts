/**
 * File: src/routes/costsRoutes.ts
 * Path: src/routes/costsRoutes.ts
 *
 * Routes for shipment and return-shipment cost allocation recomputation.
 *
 * Endpoints:
 *   - GET /api/costs/inbound/:shipmentId
 *   - GET /api/costs/return/:shipmentId
 *
 * Access:
 *   - seller role and above (seller + admin)
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getInboundShipmentCostAllocation,
  getReturnShipmentCostAllocation,
} from "../controllers/costsController";

const router = Router();

router.get(
  "/costs/inbound/:shipmentId",
  requireAuth,
  requireRole("seller"),
  getInboundShipmentCostAllocation
);

router.get(
  "/costs/return/:shipmentId",
  requireAuth,
  requireRole("seller"),
  getReturnShipmentCostAllocation
);

export default router;
