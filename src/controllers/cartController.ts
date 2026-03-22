/**
 * File: src/controllers/cartController.ts
 * Path: ecommerce-admin/src/controllers/cartController.ts
 *
 * Handlers for cart and wishlist endpoints.
 * All endpoints require authentication — user_id is always taken
 * from req.user.id (the verified JWT), never from the request body.
 *
 * Cart design:
 *   - One row per (user_id, variant_id) — duplicate add increments quantity
 *   - Hard-deletes on item removal and cart clear
 *   - GET response joins variant and product data for richer client display
 *
 * Wishlist design:
 *   - One row per (user_id, product_id) — soft-delete via is_active flag
 *   - Re-adding a soft-deleted item reactivates it (sets is_active = true)
 *   - GET response joins product + primary image for display
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
 * Columns to select from the cart table enriched with variant + product data.
 * The join gives the client everything needed to render a cart line item.
 */
const CART_SELECT = `
  id,
  user_id,
  variant_id,
  quantity,
  created_at,
  updated_at,
  product_variants (
    id,
    sku,
    color,
    size,
    material,
    base_price,
    image_url_primary,
    stock,
    status,
    discount_type,
    discount_value,
    is_active,
    products (
      id,
      name,
      product_code,
      description,
      is_active
    )
  )
`.trim();

/**
 * Columns to select from wishlist enriched with product + primary variant image.
 */
const WISHLIST_SELECT = `
  id,
  user_id,
  product_id,
  created_at,
  is_active,
  products (
    id,
    name,
    product_code,
    description,
    gender,
    is_active,
    product_variants (
      image_url_primary,
      base_price,
      is_active
    )
  )
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cart   — auth
//
// Returns all active cart items for the authenticated user,
// ordered by creation date (oldest first = natural cart order).
// Includes variant details and product info for each line item.
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

    // Calculate cart totals for convenience
    const items = data ?? [];
    const subtotal = items.reduce((sum: number, item: any) => {
      const variant  = item.product_variants;
      if (!variant) return sum;
      const price    = variant.base_price as number;
      const discount = variant.discount_type && variant.discount_value
        ? variant.discount_type === "percentage"
          ? price * (variant.discount_value / 100)
          : variant.discount_value
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
// Adds a variant to the cart.
// If the variant already exists in the user's cart the quantity is
// incremented by the requested amount rather than creating a duplicate row.
// Validates that the variant is active and has sufficient stock.
// ─────────────────────────────────────────────────────────────────────────────
export const addToCart = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const body   = addToCartSchema.parse(req.body);

    // Validate that the variant exists, is active, and has enough stock
    const { data: variant, error: variantError } = await supabaseAdmin
      .from("product_variants")
      .select("id, stock, is_active, status")
      .eq("id", body.variant_id)
      .single<{ id: string; stock: number; is_active: boolean; status: string }>();

    if (variantError || !variant)
      throw new AppError("Variant not found", 404);

    if (!variant.is_active || variant.status === "archived")
      throw new AppError("This variant is no longer available", 400);

    // Check if the variant is already in the cart
    const { data: existing } = await supabaseAdmin
      .from("cart")
      .select("id, quantity")
      .eq("user_id", userId)
      .eq("variant_id", body.variant_id)
      .maybeSingle<{ id: string; quantity: number }>();

    const newQuantity = (existing?.quantity ?? 0) + body.quantity;

    if (variant.stock > 0 && newQuantity > variant.stock) {
      throw new AppError(
        `Only ${variant.stock} unit(s) available. You already have ${existing?.quantity ?? 0} in your cart.`,
        400
      );
    }

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
      // Insert a new cart row
      const { data, error } = await supabaseAdmin
        .from("cart")
        .insert({
          user_id:    userId,
          variant_id: body.variant_id,
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
// Only the item owner can update it.
// Re-validates stock against the new quantity.
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

    // Fetch the cart item and confirm ownership
    const { data: item, error: fetchError } = await supabaseAdmin
      .from("cart")
      .select("id, user_id, variant_id, quantity")
      .eq("id", id)
      .single<{ id: string; user_id: string; variant_id: string; quantity: number }>();

    if (fetchError || !item)
      throw new AppError("Cart item not found", 404);

    if (item.user_id !== userId)
      throw new AppError("Cart item not found", 404); // 404 not 403 — don't leak existence

    // Validate stock for the new quantity
    const { data: variant } = await supabaseAdmin
      .from("product_variants")
      .select("stock")
      .eq("id", item.variant_id)
      .single<{ stock: number }>();

    if (variant && variant.stock > 0 && body.quantity > variant.stock) {
      throw new AppError(`Only ${variant.stock} unit(s) available`, 400);
    }

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

    // Confirm the item exists and belongs to this user
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
// Hard-deletes ALL cart items for the authenticated user (clear cart).
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
// Returns all active wishlist items for the authenticated user,
// with product and first-variant image enrichment.
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
      .eq("is_active", true)
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
// Idempotent: if a soft-deleted entry exists it is reactivated;
// if an active entry already exists a 200 is returned without duplication.
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

    // Check for an existing wishlist entry (active or soft-deleted)
    const { data: existing } = await supabaseAdmin
      .from("wishlist")
      .select("id, is_active")
      .eq("user_id", userId)
      .eq("product_id", body.product_id)
      .maybeSingle<{ id: string; is_active: boolean }>();

    if (existing?.is_active) {
      // Already in the wishlist — return the existing item, no change needed
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

    if (existing && !existing.is_active) {
      // Reactivate a previously soft-deleted entry
      const { data, error } = await supabaseAdmin
        .from("wishlist")
        .update({ is_active: true })
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

    // Insert a fresh wishlist row
    const { data, error } = await supabaseAdmin
      .from("wishlist")
      .insert({
        user_id:    userId,
        product_id: body.product_id,
        is_active:  true,
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
// Soft-deletes a wishlist item by setting is_active = false.
// Hard deletion is intentionally avoided so wish-list analytics and
// "save for later" history can be preserved server-side.
// Only the item owner can remove it.
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

    // Confirm the item exists and belongs to this user
    const { data: item, error: fetchError } = await supabaseAdmin
      .from("wishlist")
      .select("id, user_id, is_active")
      .eq("id", id)
      .single<{ id: string; user_id: string; is_active: boolean }>();

    if (fetchError || !item || item.user_id !== userId)
      throw new AppError("Wishlist item not found", 404);

    if (!item.is_active)
      throw new AppError("Wishlist item not found", 404); // already removed

    const { error } = await supabaseAdmin
      .from("wishlist")
      .update({ is_active: false })
      .eq("id", id);

    if (error) throw new AppError(`Failed to remove from wishlist: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Product removed from wishlist." });
  } catch (err) { next(err); }
};
