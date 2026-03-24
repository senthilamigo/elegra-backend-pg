/**
 * File: src/routes/reviewRoutes.ts
 * Path: ecommerce-admin/src/routes/reviewRoutes.ts
 *
 * Product review routes.
 *
 * Route ordering note:
 *   /api/seller/reviews must be registered before /api/products/:id/reviews
 *   to avoid Express treating "seller" as a product :id param — but since
 *   these are distinct path prefixes (/seller vs /products) Express handles
 *   them correctly regardless of order. Registration order here follows
 *   the logical grouping: public → auth → admin → seller.
 *
 *   /api/reviews/:id/approve must be registered before /api/reviews/:id
 *   within the same prefix to ensure the "approve" literal is not captured
 *   as a sub-path of :id — Express resolves this correctly since they differ
 *   in HTTP method (PATCH vs PUT/DELETE), but ordering is kept explicit.
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  listProductReviews,
  submitReview,
  updateReview,
  deleteReview,
  approveReview,
  getSellerReviews,
} from "../controllers/reviewController";

const router = Router();

// ─────────────────────────────────────────────
// Product-scoped reviews — public + auth
// ─────────────────────────────────────────────

/**
 * GET /api/products/:id/reviews
 * Lists approved reviews for a product (public).
 * Supports ?rating=1-5  ?page=  ?limit=
 */
router.get("/products/:id/reviews", listProductReviews);

/**
 * POST /api/products/:id/reviews
 * Submit a review. is_verified_purchase is set automatically.
 */
router.post("/products/:id/reviews", requireAuth, submitReview);

// ─────────────────────────────────────────────
// Review management — auth (own) / admin
// ─────────────────────────────────────────────

/** PATCH /api/reviews/:id/approve — admin: approve or reject a review */
router.patch("/reviews/:id/approve", requireAuth, requireRole("admin"), approveReview);

/** PUT /api/reviews/:id — edit own review */
router.put("/reviews/:id", requireAuth, updateReview);

/** DELETE /api/reviews/:id — delete own review (admin can also delete any) */
router.delete("/reviews/:id", requireAuth, deleteReview);

// ─────────────────────────────────────────────
// Seller review feed
// ─────────────────────────────────────────────

/**
 * GET /api/seller/reviews
 * All reviews on the seller's products.
 * Supports ?is_approved=true|false  ?rating=1-5  ?page=  ?limit=
 */
router.get("/seller/reviews", requireAuth, requireRole("seller"), getSellerReviews);

export default router;
