/**
 * File: src/routes/cartRoutes.ts
 * Path: ecommerce-admin/src/routes/cartRoutes.ts
 *
 * Cart and wishlist routes — all require a valid JWT (requireAuth).
 * No role distinction beyond "logged in": any authenticated user
 * (customer, seller, admin) can manage their own cart and wishlist.
 *
 * Route ordering note:
 *   DELETE /api/cart     (clear entire cart) must be registered BEFORE
 *   DELETE /api/cart/:id (remove single item) to avoid Express treating
 *   a bare DELETE /api/cart as a request with an empty :id param.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  getWishlist,
  addToWishlist,
  removeFromWishlist,
} from "../controllers/cartController";

const router = Router();

// All cart and wishlist routes require authentication
router.use(requireAuth);

// ─────────────────────────────────────────────
// Cart
// ─────────────────────────────────────────────

/** GET  /api/cart          — fetch current user's cart with subtotal */
router.get("/cart", getCart);

/** POST /api/cart          — add variant to cart (increments qty if exists) */
router.post("/cart", addToCart);

/** DELETE /api/cart        — clear all items from the cart */
router.delete("/cart", clearCart);

/** PUT    /api/cart/:id    — update quantity of a single cart item */
router.put("/cart/:id", updateCartItem);

/** DELETE /api/cart/:id   — remove a single item from the cart */
router.delete("/cart/:id", removeCartItem);

// ─────────────────────────────────────────────
// Wishlist
// ─────────────────────────────────────────────

/** GET    /api/wishlist     — fetch active wishlist items with product info */
router.get("/wishlist", getWishlist);

/** POST   /api/wishlist     — add product (idempotent — reactivates if removed) */
router.post("/wishlist", addToWishlist);

/** DELETE /api/wishlist/:id — soft-delete a wishlist item */
router.delete("/wishlist/:id", removeFromWishlist);

export default router;
