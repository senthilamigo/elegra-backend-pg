/**
 * File: src/routes/supplierProductRoutes.ts
 * Path: ecommerce-admin/src/routes/supplierProductRoutes.ts
 *
 * Express routes for supplier-product mapping endpoints mounted under /api.
 *
 * Endpoints:
 *   POST /api/supplier-products
 *   GET  /api/supplier-products
 *   PUT  /api/supplier-products/:id
 *
 * Access:
 *   - All routes require authentication and role >= seller.
 *   - requireRole("seller") allows both seller and admin users.
 */
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  createSupplierProduct,
  listSupplierProducts,
  updateSupplierProduct,
} from "../controllers/supplierProductController";

const router = Router();

router.post(
  "/supplier-products",
  requireAuth,
  requireRole("seller"),
  createSupplierProduct
);

router.get(
  "/supplier-products",
  requireAuth,
  requireRole("seller"),
  listSupplierProducts
);

router.put(
  "/supplier-products/:id",
  requireAuth,
  requireRole("seller"),
  updateSupplierProduct
);

export default router;
