import { Router } from "express";
import { authenticate } from "../middleware/auth";
import {
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/productController";

const router = Router();

// All product routes require authentication
router.use(authenticate);

/**
 * GET /api/products
 * Query params: page (default 1), returns 20 items per page
 */
router.get("/products", getProducts);

/**
 * POST /api/product/add
 * Body: { ...productFields, variants: [...] }
 */
router.post("/product/add", addProduct);

/**
 * PUT /api/product/update
 * Body: { id, ...productFields, variants?: [...] }
 */
router.put("/product/update", updateProduct);

/**
 * DELETE /api/product/remove/:id
 * Removes product and all associated variants
 */
router.delete("/product/remove/:id", deleteProduct);

export default router;
