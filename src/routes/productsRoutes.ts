/**
 * File: src/routes/productsRoutes.ts
 * Path: ecommerce-admin/src/routes/productsRoutes.ts
 *
 * RESTful product + variant routes mounted at /api.
 *
 * Role enforcement applied per-route (not blanket) so public GETs
 * are served without a token while write operations are protected.
 *
 * Route order matters — /api/products/search and /api/seller/products
 * must be registered BEFORE /api/products/:id to prevent Express from
 * matching "search" or "seller" as UUID path params.
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  listProducts,
  searchProducts,
  getProduct,
  createProduct,
  updateProductDetails,
  toggleProductStatus,
  softDeleteProduct,
  getSellerProducts,
  listVariants,
  getVariant,
  addVariant,
  updateVariantDetails,
  updateVariantStock,
  updateVariantDiscount,
  deactivateVariant,
} from "../controllers/productsController";

const router = Router();

// ─────────────────────────────────────────────
// Products — public
// ─────────────────────────────────────────────

/** GET /api/products/search?q=&category_id=&gender=&seller_id=&min_price=&max_price= */
router.get("/products/search", searchProducts);

/** GET /api/products?category_id=&gender=&seller_id=&page=&limit= */
router.get("/products", listProducts);

// ─────────────────────────────────────────────
// Seller's own products — seller role
// ─────────────────────────────────────────────

/** GET /api/seller/products — authenticated seller's own product list */
router.get(
  "/seller/products",
  requireAuth, requireRole("seller"),
  getSellerProducts
);

// ─────────────────────────────────────────────
// Single product — public (GET), admin (write)
// ─────────────────────────────────────────────

/** GET /api/products/:id */
router.get("/products/:id", getProduct);

/** POST /api/products — create product */
router.post(
  "/products",
  requireAuth, requireRole("admin"),
  createProduct
);

/** PUT /api/products/:id — update product details */
router.put(
  "/products/:id",
  requireAuth, requireRole("admin"),
  updateProductDetails
);

/** PATCH /api/products/:id/toggle — toggle active status */
router.patch(
  "/products/:id/toggle",
  requireAuth, requireRole("admin"),
  toggleProductStatus
);

/** DELETE /api/products/:id — soft-delete product + variants */
router.delete(
  "/products/:id",
  requireAuth, requireRole("admin"),
  softDeleteProduct
);

// ─────────────────────────────────────────────
// Variants — public (GET), seller (write)
// ─────────────────────────────────────────────

/** GET /api/products/:id/variants */
router.get("/products/:id/variants", listVariants);

/** GET /api/products/:id/variants/:vid */
router.get("/products/:id/variants/:vid", getVariant);

/** POST /api/products/:id/variants */
router.post(
  "/products/:id/variants",
  requireAuth, requireRole("seller"),
  addVariant
);

/** PUT /api/products/:id/variants/:vid */
router.put(
  "/products/:id/variants/:vid",
  requireAuth, requireRole("seller"),
  updateVariantDetails
);

/** PATCH /api/products/:id/variants/:vid/stock */
router.patch(
  "/products/:id/variants/:vid/stock",
  requireAuth, requireRole("seller"),
  updateVariantStock
);

/** PATCH /api/products/:id/variants/:vid/discount */
router.patch(
  "/products/:id/variants/:vid/discount",
  requireAuth, requireRole("seller"),
  updateVariantDiscount
);

/** DELETE /api/products/:id/variants/:vid — soft-deactivate variant */
router.delete(
  "/products/:id/variants/:vid",
  requireAuth, requireRole("seller"),
  deactivateVariant
);

export default router;
