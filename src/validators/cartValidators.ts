/**
 * File: src/validators/cartValidators.ts
 * Path: ecommerce-admin/src/validators/cartValidators.ts
 *
 * Zod schemas for cart and wishlist request bodies.
 *
 * cart columns:  id, user_id, product_id, quantity, created_at, updated_at
 * wishlist cols: id, user_id, product_id, created_at, deleted_at
 */

import { z } from "zod";

const uuidSchema = z.string().uuid("Must be a valid UUID");

// ─────────────────────────────────────────────
// Cart schemas
// ─────────────────────────────────────────────

/**
 * POST /api/cart
 * Add a product to the cart.
 * If the product is already in the cart the quantity is incremented.
 */
export const addToCartSchema = z.object({
  product_id: uuidSchema,
  quantity:   z.number().int().min(1, "Quantity must be at least 1").default(1),
});

/**
 * PUT /api/cart/:id
 * Update the quantity of a specific cart item.
 * quantity = 0 is rejected — use DELETE /api/cart/:id to remove the item.
 */
export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
});

// ─────────────────────────────────────────────
// Wishlist schemas
// ─────────────────────────────────────────────

/**
 * POST /api/wishlist
 * Add a product to the wishlist.
 * Idempotent — re-adding a soft-deleted product clears deleted_at.
 */
export const addToWishlistSchema = z.object({
  product_id: uuidSchema,
});

// ─────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────

export type AddToCartInput      = z.infer<typeof addToCartSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type AddToWishlistInput  = z.infer<typeof addToWishlistSchema>;
