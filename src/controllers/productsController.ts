/**
 * File: src/controllers/productsController.ts
 * Path: ecommerce-admin/src/controllers/productsController.ts
 *
 * RESTful product + variant handlers for the new /api/products/* routes.
 *
 * Public endpoints (no auth):
 *   listProducts, getProduct, searchProducts,
 *   listVariants, getVariant
 *
 * Admin endpoints (requireAuth + requireRole("admin")):
 *   createProduct, updateProductDetails, toggleProductStatus, softDeleteProduct
 *
 * Seller endpoints (requireAuth + requireRole("seller")):
 *   getSellerProducts, addVariant, updateVariantDetails,
 *   updateVariantStock, updateVariantDiscount, deactivateVariant
 *
 * Relationship to existing productController.ts:
 *   The old controller handles the admin-panel routes (/api/product/add etc.)
 *   and is kept untouched for backward compatibility. This file implements
 *   the new RESTful surface on /api/products.
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse, Product, ProductVariant, ProductWithVariants, PaginatedResponse } from "../types";
import {
  createProductSchema,
  updateProductSchema,
  createVariantBodySchema,
  updateVariantBodySchema,
  updateStockSchema,
  updateDiscountSchema,
} from "../validators";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id))
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
}

const PRODUCT_SELECT  = "id, name, description, product_code, seller_id, category_id, gender, is_active, created_at";
const VARIANT_SELECT  = "id, product_id, sku, color, size, material, attributes, base_price, is_active, image_url_primary, images_urls, status, stock, discount_type, discount_value, created_at";

/** Returns a product row; throws 404 if not found (or inactive when requireActive=true) */
async function fetchProduct(id: string, requireActive = false): Promise<Product> {
  let q = supabaseAdmin.from("products").select(PRODUCT_SELECT).eq("id", id);
  if (requireActive) q = q.eq("is_active", true);
  const { data, error } = await q.single<Product>();
  if (error || !data) throw new AppError(`Product with id ${id} not found`, 404);
  return data;
}

/** Returns a variant; throws 404 if not found or doesn't belong to the product */
async function fetchVariant(productId: string, variantId: string): Promise<ProductVariant> {
  const { data, error } = await supabaseAdmin
    .from("product_variants")
    .select(VARIANT_SELECT)
    .eq("id", variantId)
    .eq("product_id", productId)
    .single<ProductVariant>();
  if (error || !data)
    throw new AppError(`Variant ${variantId} not found on product ${productId}`, 404);
  return data;
}

function parsePage(query: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(query.page  ?? "1"),  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  return { page, limit, from: (page - 1) * limit, to: (page - 1) * limit + limit - 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products   — public
//
// Paginated list of active products with their variants.
// Supports optional query filters:
//   ?category_id=<bigint>
//   ?gender=male|female|unisex|kids|other
//   ?seller_id=<uuid>
//   ?page=<n>  ?limit=<n>
// ─────────────────────────────────────────────────────────────────────────────
export const listProducts = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const { category_id, gender, seller_id } = req.query as Record<string, string | undefined>;

    let q = supabaseAdmin
      .from("products")
      .select(`${PRODUCT_SELECT}, product_variants(${VARIANT_SELECT})`, { count: "exact" })
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (category_id) q = q.eq("category_id", category_id);
    if (gender)      q = q.eq("gender", gender);
    if (seller_id)   q = q.eq("seller_id", seller_id);

    const { data, error, count } = await q;
    if (error) throw new AppError(`Database error: ${error.message}`, 500);

    const products = (data ?? []).map((p: any) => ({
      ...p,
      variants: p.product_variants ?? [],
      product_variants: undefined,
    }));

    res.status(200).json({
      success: true,
      data: { data: products, page, limit, total: count ?? 0, hasMore: (count ?? 0) > page * limit },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/search   — public
//
// Full-text search across name, description, product_code.
// Additional filters: category_id, gender, seller_id, min_price, max_price.
// Results include only active products and active variants.
//
// NOTE: Route must be registered BEFORE /api/products/:id so Express does not
// treat "search" as a UUID param.
// ─────────────────────────────────────────────────────────────────────────────
export const searchProducts = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const {
      q: searchQuery,
      category_id,
      gender,
      seller_id,
      min_price,
      max_price,
    } = req.query as Record<string, string | undefined>;

    if (!searchQuery?.trim()) {
      throw new AppError("Query param 'q' is required for search", 400);
    }

    // Supabase full-text search using the built-in text search operator
    // Searches name, description, and product_code columns.
    let query = supabaseAdmin
      .from("products")
      .select(`${PRODUCT_SELECT}, product_variants(${VARIANT_SELECT})`, { count: "exact" })
      .eq("is_active", true)
      .or(
        `name.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%,product_code.ilike.%${searchQuery}%`
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (category_id) query = query.eq("category_id", category_id);
    if (gender)      query = query.eq("gender", gender);
    if (seller_id)   query = query.eq("seller_id", seller_id);

    const { data, error, count } = await query;
    if (error) throw new AppError(`Search error: ${error.message}`, 500);

    let products = (data ?? []).map((p: any) => ({
      ...p,
      variants: (p.product_variants ?? []).filter((v: any) =>
        v.is_active &&
        (!min_price || v.base_price >= Number(min_price)) &&
        (!max_price || v.base_price <= Number(max_price))
      ),
      product_variants: undefined,
    }));

    // Exclude products where all variants were filtered out by price range
    if (min_price || max_price) {
      products = products.filter((p: any) => p.variants.length > 0);
    }

    res.status(200).json({
      success: true,
      data: { data: products, page, limit, total: count ?? 0, hasMore: (count ?? 0) > page * limit },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/:id   — public
// Returns a single active product with all its active variants.
// ─────────────────────────────────────────────────────────────────────────────
export const getProduct = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "product id");

    const { data, error } = await supabaseAdmin
      .from("products")
      .select(`${PRODUCT_SELECT}, product_variants(${VARIANT_SELECT})`)
      .eq("id", id)
      .eq("is_active", true)
      .single<any>();

    if (error || !data) throw new AppError(`Product with id ${id} not found`, 404);

    res.status(200).json({
      success: true,
      data: { ...data, variants: data.product_variants ?? [], product_variants: undefined },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/products   — admin
// Creates a new product with at least one variant.
// ─────────────────────────────────────────────────────────────────────────────
export const createProduct = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const input = createProductSchema.parse(req.body);
    const { variants, ...productData } = input;

    const { data: newProduct, error: productError } = await supabaseAdmin
      .from("products")
      .insert(productData)
      .select(PRODUCT_SELECT)
      .single<Product>();

    if (productError || !newProduct)
      throw new AppError(`Failed to create product: ${productError?.message}`, 500);

    const variantRows = variants.map((v) => ({ ...v, product_id: newProduct.id }));
    const { error: variantError } = await supabaseAdmin
      .from("product_variants")
      .insert(variantRows);

    if (variantError) {
      await supabaseAdmin.from("products").delete().eq("id", newProduct.id);
      throw new AppError(`Failed to create variants: ${variantError.message}`, 500);
    }

    res.status(201).json({
      success: true,
      message: "Product created successfully.",
      data: { product_id: newProduct.id },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/products/:id   — admin
// Updates product-level fields. Does NOT touch variants (use variant endpoints).
// ─────────────────────────────────────────────────────────────────────────────
export const updateProductDetails = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "product id");

    // Inject id into body so updateProductSchema validation passes
    const input = updateProductSchema.parse({ ...req.body, id });
    const { id: _id, variants: _variants, ...updateData } = input;

    await fetchProduct(id); // confirm exists

    if (Object.keys(updateData).length === 0)
      throw new AppError("No fields provided to update", 400);

    const { data, error } = await supabaseAdmin
      .from("products")
      .update(updateData)
      .eq("id", id)
      .select(PRODUCT_SELECT)
      .single<Product>();

    if (error) throw new AppError(`Failed to update product: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Product updated.", data });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/products/:id/toggle   — admin
// Toggles is_active between true and false.
// ─────────────────────────────────────────────────────────────────────────────
export const toggleProductStatus = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "product id");

    const product = await fetchProduct(id);
    const newActive = !product.is_active;

    const { data, error } = await supabaseAdmin
      .from("products")
      .update({ is_active: newActive })
      .eq("id", id)
      .select(PRODUCT_SELECT)
      .single<Product>();

    if (error) throw new AppError(`Failed to toggle product: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: `Product ${newActive ? "activated" : "deactivated"}.`,
      data,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/products/:id   — admin
// Soft-delete: sets is_active = false and deactivates all variants.
// Hard deletion is handled by the existing DELETE /api/product/remove/:id.
// ─────────────────────────────────────────────────────────────────────────────
export const softDeleteProduct = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "product id");
    await fetchProduct(id); // confirm exists

    // Soft-delete the product
    const { error: productError } = await supabaseAdmin
      .from("products")
      .update({ is_active: false })
      .eq("id", id);
    if (productError) throw new AppError(`Failed to deactivate product: ${productError.message}`, 500);

    // Also deactivate all its variants
    const { error: variantError } = await supabaseAdmin
      .from("product_variants")
      .update({ is_active: false, status: "archived" })
      .eq("product_id", id);
    if (variantError) throw new AppError(`Failed to deactivate variants: ${variantError.message}`, 500);

    res.status(200).json({ success: true, message: "Product and all its variants deactivated." });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/seller/products   — admin
// Returns paginated products owned by the authenticated seller.
// Seller is identified by req.user.id (from JWT).
// ─────────────────────────────────────────────────────────────────────────────
export const getSellerProducts = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const sellerId = req.user!.id;

    // Resolve the seller's sellers.id from their user_id
    const { data: sellerRow } = await supabaseAdmin
      .from("sellers")
      .select("id")
      .eq("user_id", sellerId)
      .single<{ id: string }>();

    if (!sellerRow) throw new AppError("No seller profile found for this account", 404);

    const { data, error, count } = await supabaseAdmin
      .from("products")
      .select(`${PRODUCT_SELECT}, product_variants(${VARIANT_SELECT})`, { count: "exact" })
      .eq("seller_id", sellerRow.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw new AppError(`Database error: ${error.message}`, 500);

    const products = (data ?? []).map((p: any) => ({
      ...p,
      variants: p.product_variants ?? [],
      product_variants: undefined,
    }));

    res.status(200).json({
      success: true,
      data: { data: products, page, limit, total: count ?? 0, hasMore: (count ?? 0) > page * limit },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/:id/variants   — public
// Lists all active variants for a product.
// ─────────────────────────────────────────────────────────────────────────────
export const listVariants = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "product id");
    await fetchProduct(id, true); // ensure product is active

    const { data, error } = await supabaseAdmin
      .from("product_variants")
      .select(VARIANT_SELECT)
      .eq("product_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) throw new AppError(`Database error: ${error.message}`, 500);

    res.status(200).json({ success: true, data: data ?? [] });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/:id/variants/:vid   — public
// Returns a single variant.
// ─────────────────────────────────────────────────────────────────────────────
export const getVariant = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, vid } = req.params;
    validateUuid(id,  "product id");
    validateUuid(vid, "variant id");

    const variant = await fetchVariant(id, vid);
    res.status(200).json({ success: true, data: variant });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/products/:id/variants   — seller
// Adds a new variant to a product the seller owns.
// ─────────────────────────────────────────────────────────────────────────────
export const addVariant = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "product id");

    await assertSellerOwnsProduct(id, req.user!.id);

    const body = createVariantBodySchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from("product_variants")
      .insert({ ...body, product_id: id })
      .select(VARIANT_SELECT)
      .single<ProductVariant>();

    if (error) throw new AppError(`Failed to add variant: ${error.message}`, 500);

    res.status(201).json({ success: true, message: "Variant added.", data });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/products/:id/variants/:vid   — seller
// Updates any fields on a variant (except stock and discount — use dedicated endpoints).
// ─────────────────────────────────────────────────────────────────────────────
export const updateVariantDetails = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, vid } = req.params;
    validateUuid(id,  "product id");
    validateUuid(vid, "variant id");

    await assertSellerOwnsProduct(id, req.user!.id);
    await fetchVariant(id, vid); // confirm variant belongs to product

    const body = updateVariantBodySchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from("product_variants")
      .update(body)
      .eq("id", vid)
      .select(VARIANT_SELECT)
      .single<ProductVariant>();

    if (error) throw new AppError(`Failed to update variant: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Variant updated.", data });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/products/:id/variants/:vid/stock   — seller
// Updates the stock quantity of a specific variant.
// ─────────────────────────────────────────────────────────────────────────────
export const updateVariantStock = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, vid } = req.params;
    validateUuid(id,  "product id");
    validateUuid(vid, "variant id");

    await assertSellerOwnsProduct(id, req.user!.id);

    const { stock } = updateStockSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from("product_variants")
      .update({ stock })
      .eq("id", vid)
      .eq("product_id", id)
      .select(VARIANT_SELECT)
      .single<ProductVariant>();

    if (error || !data) throw new AppError(`Failed to update stock: ${error?.message}`, 500);

    res.status(200).json({ success: true, message: `Stock updated to ${stock}.`, data });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/products/:id/variants/:vid/discount   — seller
// Sets the discount_type and discount_value for a variant.
// Send { discount_type: null, discount_value: null } to clear the discount.
// ─────────────────────────────────────────────────────────────────────────────
export const updateVariantDiscount = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, vid } = req.params;
    validateUuid(id,  "product id");
    validateUuid(vid, "variant id");

    await assertSellerOwnsProduct(id, req.user!.id);

    const { discount_type, discount_value } = updateDiscountSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from("product_variants")
      .update({ discount_type, discount_value })
      .eq("id", vid)
      .eq("product_id", id)
      .select(VARIANT_SELECT)
      .single<ProductVariant>();

    if (error || !data) throw new AppError(`Failed to update discount: ${error?.message}`, 500);

    res.status(200).json({ success: true, message: "Discount updated.", data });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/products/:id/variants/:vid   — seller
// Soft-deactivates a variant (sets is_active = false, status = "archived").
// Does not hard-delete — historical order data may reference the variant.
// ─────────────────────────────────────────────────────────────────────────────
export const deactivateVariant = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, vid } = req.params;
    validateUuid(id,  "product id");
    validateUuid(vid, "variant id");

    await assertSellerOwnsProduct(id, req.user!.id);
    await fetchVariant(id, vid); // confirm exists

    const { error } = await supabaseAdmin
      .from("product_variants")
      .update({ is_active: false, status: "archived" })
      .eq("id", vid)
      .eq("product_id", id);

    if (error) throw new AppError(`Failed to deactivate variant: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Variant deactivated." });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — assertSellerOwnsProduct
//
// For seller-gated endpoints, verifies that the authenticated user's
// seller profile owns the product. Throws 403 if not.
// Admins bypass this check.
// ─────────────────────────────────────────────────────────────────────────────
async function assertSellerOwnsProduct(productId: string, userId: string): Promise<void> {
  // Resolve the seller uuid from the user's id
  const { data: sellerRow } = await supabaseAdmin
    .from("sellers")
    .select("id")
    .eq("user_id", userId)
    .single<{ id: string }>();

  if (!sellerRow)
    throw new AppError("No seller profile found for this account", 403);

  const { data: product } = await supabaseAdmin
    .from("products")
    .select("seller_id")
    .eq("id", productId)
    .single<{ seller_id: string }>();

  if (!product)
    throw new AppError(`Product ${productId} not found`, 404);

  if (product.seller_id !== sellerRow.id)
    throw new AppError("You do not have permission to modify this product", 403);
}
