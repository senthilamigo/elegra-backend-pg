/**
 * File: src/routes/inventoryRoutes.ts
 * Path: src/routes/inventoryRoutes.ts
 *
 * Inventory read-only API routes for seller/admin users.
 *
 * Endpoints:
 *   - GET /api/inventory                 -> inventory summary grouped by product
 *   - GET /api/inventory/:productId      -> inventory breakdown for one product
 *   - GET /api/inventory/batches/:id     -> single batch details
 *
 * Access control:
 *   - All routes require authentication
 *   - Minimum role required is seller (admin is allowed via role hierarchy)
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getInventorySummary,
  getInventoryByProduct,
  getInventoryBatchDetails,
} from "../controllers/inventoryController";

const router = Router();

router.get("/inventory", requireAuth, requireRole("seller"), getInventorySummary);
router.get("/inventory/:productId", requireAuth, requireRole("seller"), getInventoryByProduct);
router.get("/inventory/batches/:id", requireAuth, requireRole("seller"), getInventoryBatchDetails);

export default router;
