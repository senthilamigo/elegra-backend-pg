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
