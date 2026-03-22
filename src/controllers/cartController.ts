/**
 * File: src/controllers/cartController.ts
 * Path: ecommerce-admin/src/controllers/cartController.ts
 *
 * Handlers for cart and wishlist endpoints.
 * All endpoints require authentication — user_id is always taken from
 * req.user.id (the verified JWT), never from the request body.
 *
 * Actual table columns
 * ─────────────────────
 * cart:
 *   id, user_id, product_id, quantity, created_at, updated_at
 *
 * wishlist:
 *   id, user_id, product_id, created_at, deleted_at
 *   (deleted_at IS NULL  → active;  deleted_at IS NOT NULL → soft-deleted)
 *
 * Cart design:
 *   - One row per (user_id, product_id) — duplicate POST increments quantity
 *   - GET response joins product data for display
 *   - Hard-deletes on item removal and cart clear
 *
 * Wishlist design:
 *   - One row per (user_id, product_id) — soft-delete via deleted_at timestamp
 *   - Re-adding a soft-deleted entry clears deleted_at (sets back to NULL)
 *   - GET filters WHERE deleted_at IS NULL
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";
import { CartItem, WishlistItem } from "../types/cart";
import {
  addToCartSchema,
  updateCartItemSchema,
  addToWishlistSchema,
} from "../validators/cartValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id))
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
}

/**
 * Columns to select from cart joined with the product.
 * Cart tracks products; the join gives the client name, image, and price
 * without a separate API call.
 */
const CART_SELECT = `
  id,
  user_id,
  product_id,
  quantity,
  created_at,
  updated_at,
  products (
    id,
    name,
    product_code,
    description,
    gender,
    is_active,
    seller_id,
    product_variants (
      id,
      sku,
      base_price,
      image_url_primary,
      color,
      size,
      stock,
      status,
      discount_type,
      discount_value,
      is_active
    )
  )
`.trim();

/**
 * Columns to select from wishlist joined with the product.
 */
const WISHLIST_SELECT = `
  id,
  user_id,
  product_id,
  created_at,
  deleted_at,
  products (
    id,
    name,
    product_code,
    description,
    gender,
    is_active,
    product_variants (
      id,
      base_price,
      image_url_primary,
      color,
      size,
      is_active
    )
  )
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cart   — auth
//
// Returns all cart items for the authenticated user (oldest first).
// The response includes a computed subtotal using the cheapest active
// variant's price for each product, applying any discount where set.
// ─────────────────────────────────────────────────────────────────────────────
export const getCart = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabaseAdmin
      .from("cart")
      .select(CART_SELECT)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) throw new AppError(`Failed to fetch cart: ${error.message}`, 500);

    const items = data ?? [];

    // Compute subtotal — uses the lowest-priced active variant per product
    const subtotal = items.reduce((sum: number, item: any) => {
      const variants: any[] = item.products?.product_variants ?? [];
      const activeVariants  = variants.filter((v) => v.is_active && v.status !== "archived");
      if (!activeVariants.length) return sum;

      // Pick lowest base price for this product
      const cheapest = activeVariants.reduce((min: any, v: any) =>
        v.base_price < min.base_price ? v : min
      );

      const price    = cheapest.base_price as number;
      const discount = cheapest.discount_type && cheapest.discount_value != null
        ? cheapest.discount_type === "percentage"
          ? price * (cheapest.discount_value / 100)
          : cheapest.discount_value
        : 0;

      return sum + (price - discount) * item.quantity;
    }, 0);

    res.status(200).json({
      success: true,
      data: {
        items,
        item_count: items.length,
        subtotal:   Math.round(subtotal * 100) / 100,
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cart   — auth
//
// Adds a product to the cart.
// If (user_id, product_id) already exists, increments the quantity.
// Validates that the product exists and is active.
// ─────────────────────────────────────────────────────────────────────────────
export const addToCart = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const body   = addToCartSchema.parse(req.body);

    // Validate product exists and is active
    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("id, is_active, name")
      .eq("id", body.product_id)
      .single<{ id: string; is_active: boolean; name: string }>();

    if (productError || !product)
      throw new AppError("Product not found", 404);

    if (!product.is_active)
      throw new AppError("This product is no longer available", 400);

    // Check for an existing cart row for this (user, product) pair
    const { data: existing } = await supabaseAdmin
      .from("cart")
      .select("id, quantity")
      .eq("user_id", userId)
      .eq("product_id", body.product_id)
      .maybeSingle<{ id: string; quantity: number }>();

    const newQuantity = (existing?.quantity ?? 0) + body.quantity;

    let cartItem: any;

    if (existing) {
      // Increment quantity on the existing row
      const { data, error } = await supabaseAdmin
        .from("cart")
        .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select(CART_SELECT)
        .single();

      if (error) throw new AppError(`Failed to update cart: ${error.message}`, 500);
      cartItem = data;
    } else {
      // Insert a new row
      const { data, error } = await supabaseAdmin
        .from("cart")
        .insert({
          user_id:    userId,
          product_id: body.product_id,
          quantity:   body.quantity,
        })
        .select(CART_SELECT)
        .single();

      if (error) throw new AppError(`Failed to add to cart: ${error.message}`, 500);
      cartItem = data;
    }

    res.status(existing ? 200 : 201).json({
      success: true,
      message: existing ? "Cart item quantity updated." : "Item added to cart.",
      data:    cartItem,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/cart/:id   — auth
//
// Updates the quantity of a specific cart item.
// Ownership is enforced — user can only update their own items.
// ─────────────────────────────────────────────────────────────────────────────
export const updateCartItem = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "cart item id");

    const userId = req.user!.id;
    const body   = updateCartItemSchema.parse(req.body);

    // Fetch and confirm ownership
    const { data: item, error: fetchError } = await supabaseAdmin
      .from("cart")
      .select("id, user_id")
      .eq("id", id)
      .single<{ id: string; user_id: string }>();

    if (fetchError || !item || item.user_id !== userId)
      throw new AppError("Cart item not found", 404); // 404 avoids leaking existence

    const { data, error } = await supabaseAdmin
      .from("cart")
      .update({ quantity: body.quantity, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(CART_SELECT)
      .single();

    if (error) throw new AppError(`Failed to update cart item: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Cart item updated.", data });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/cart/:id   — auth
//
// Hard-deletes a single cart item. Only the owner can remove it.
// ─────────────────────────────────────────────────────────────────────────────
export const removeCartItem = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "cart item id");

    const userId = req.user!.id;

    const { data: item, error: fetchError } = await supabaseAdmin
      .from("cart")
      .select("id, user_id")
      .eq("id", id)
      .single<{ id: string; user_id: string }>();

    if (fetchError || !item || item.user_id !== userId)
      throw new AppError("Cart item not found", 404);

    const { error } = await supabaseAdmin
      .from("cart")
      .delete()
      .eq("id", id);

    if (error) throw new AppError(`Failed to remove cart item: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Item removed from cart." });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/cart   — auth
//
// Hard-deletes ALL cart items for the authenticated user.
// ─────────────────────────────────────────────────────────────────────────────
export const clearCart = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;

    const { error } = await supabaseAdmin
      .from("cart")
      .delete()
      .eq("user_id", userId);

    if (error) throw new AppError(`Failed to clear cart: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Cart cleared." });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wishlist   — auth
//
// Returns all active (deleted_at IS NULL) wishlist items for the user,
// enriched with product details, newest first.
// ─────────────────────────────────────────────────────────────────────────────
export const getWishlist = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabaseAdmin
      .from("wishlist")
      .select(WISHLIST_SELECT)
      .eq("user_id", userId)
      .is("deleted_at", null)           // active items only
      .order("created_at", { ascending: false });

    if (error) throw new AppError(`Failed to fetch wishlist: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      data: {
        items:      data ?? [],
        item_count: (data ?? []).length,
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wishlist   — auth
//
// Adds a product to the wishlist.
// Idempotent:
//   - Already active → return 200 with the existing row (no duplicate)
//   - Soft-deleted entry exists → clear deleted_at (reactivate), return 200
//   - No entry → insert new row, return 201
// Validates that the product exists and is active.
// ─────────────────────────────────────────────────────────────────────────────
export const addToWishlist = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const body   = addToWishlistSchema.parse(req.body);

    // Validate the product exists and is active
    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("id, is_active")
      .eq("id", body.product_id)
      .single<{ id: string; is_active: boolean }>();

    if (productError || !product)
      throw new AppError("Product not found", 404);

    if (!product.is_active)
      throw new AppError("This product is no longer available", 400);

    // Check for any existing wishlist entry for (user, product)
    const { data: existing } = await supabaseAdmin
      .from("wishlist")
      .select("id, deleted_at")
      .eq("user_id", userId)
      .eq("product_id", body.product_id)
      .maybeSingle<{ id: string; deleted_at: string | null }>();

    // Case 1 — already active (deleted_at IS NULL)
    if (existing && existing.deleted_at === null) {
      const { data } = await supabaseAdmin
        .from("wishlist")
        .select(WISHLIST_SELECT)
        .eq("id", existing.id)
        .single();

      return res.status(200).json({
        success: true,
        message: "Product is already in your wishlist.",
        data,
      }) as any;
    }

    // Case 2 — previously soft-deleted; reactivate by clearing deleted_at
    if (existing && existing.deleted_at !== null) {
      const { data, error } = await supabaseAdmin
        .from("wishlist")
        .update({ deleted_at: null })
        .eq("id", existing.id)
        .select(WISHLIST_SELECT)
        .single();

      if (error) throw new AppError(`Failed to add to wishlist: ${error.message}`, 500);

      return res.status(200).json({
        success: true,
        message: "Product added back to wishlist.",
        data,
      }) as any;
    }

    // Case 3 — no existing entry; insert fresh row
    const { data, error } = await supabaseAdmin
      .from("wishlist")
      .insert({
        user_id:    userId,
        product_id: body.product_id,
        // deleted_at omitted — defaults to NULL in DB
      })
      .select(WISHLIST_SELECT)
      .single();

    if (error) throw new AppError(`Failed to add to wishlist: ${error.message}`, 500);

    res.status(201).json({
      success: true,
      message: "Product added to wishlist.",
      data,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/wishlist/:id   — auth
//
// Soft-deletes by setting deleted_at = NOW().
// Only the item owner can remove it.
// Returns 404 if the item is already soft-deleted or doesn't exist.
// ─────────────────────────────────────────────────────────────────────────────
export const removeFromWishlist = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "wishlist item id");

    const userId = req.user!.id;

    const { data: item, error: fetchError } = await supabaseAdmin
      .from("wishlist")
      .select("id, user_id, deleted_at")
      .eq("id", id)
      .single<{ id: string; user_id: string; deleted_at: string | null }>();

    if (fetchError || !item || item.user_id !== userId)
      throw new AppError("Wishlist item not found", 404);

    if (item.deleted_at !== null)
      throw new AppError("Wishlist item not found", 404); // already removed

    const { error } = await supabaseAdmin
      .from("wishlist")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new AppError(`Failed to remove from wishlist: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Product removed from wishlist." });
  } catch (err) { next(err); }
};
