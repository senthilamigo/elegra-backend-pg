/**
 * File: src/validators/cartValidators.ts
 * Path: ecommerce-admin/src/validators/cartValidators.ts
 *
 * Zod schemas for cart and wishlist request bodies.
 */

import { z } from "zod";

const uuidSchema = z.string().uuid("Must be a valid UUID");

// ─────────────────────────────────────────────
// Cart schemas
// ─────────────────────────────────────────────

/**
 * POST /api/cart
 * Add a variant to the cart.
 * If the variant is already in the cart the quantity is incremented.
 */
export const addToCartSchema = z.object({
  variant_id: uuidSchema,
  quantity:   z.number().int().min(1, "Quantity must be at least 1").default(1),
});

/**
 * PUT /api/cart/:id
 * Update the quantity of a specific cart item.
 * quantity = 0 is rejected — use DELETE /api/cart/:id to remove.
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
 * Duplicate active entries are silently ignored (idempotent).
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
