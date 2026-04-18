/**
 * File: src/routes/supplierReturnRoutes.ts
 * Path: src/routes/supplierReturnRoutes.ts
 *
 * Routes for supplier return operations.
 *
 * Endpoints:
 *   - POST /api/supplier-returns
 *   - GET  /api/supplier-returns
 *   - GET  /api/supplier-returns/:id
 *   - PUT  /api/supplier-returns/:id/status
 *
 * Access:
 *   - seller role and above (seller + admin)
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  createSupplierReturn,
  getSupplierReturn,
  listSupplierReturns,
  updateSupplierReturnStatus,
} from "../controllers/supplierReturnController";

const router = Router();

router.post("/supplier-returns", requireAuth, requireRole("seller"), createSupplierReturn);
router.get("/supplier-returns", requireAuth, requireRole("seller"), listSupplierReturns);
router.get("/supplier-returns/:id", requireAuth, requireRole("seller"), getSupplierReturn);
router.put("/supplier-returns/:id/status", requireAuth, requireRole("seller"), updateSupplierReturnStatus);

export default router;
