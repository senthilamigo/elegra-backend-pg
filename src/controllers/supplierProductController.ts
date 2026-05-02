/**
 * File: src/controllers/supplierProductController.ts
 * Path: ecommerce-admin/src/controllers/supplierProductController.ts
 *
 * Controller handlers for supplier-product mapping APIs.
 *
 * Endpoints handled in this file:
 *   POST /api/supplier-products
 *     - Creates a mapping between a supplier and a product.
 *     - Allows optional initial `cost_price`, `lead_time_days`,
 *       `supplier_product_name`, and `supplier_sku`.
 *     - Validates supplier existence and product access.
 *
 *   GET /api/supplier-products
 *     - Returns paginated supplier-product mappings.
 *     - Supports optional query filters: `supplier_id`, `product_id`, `page`, `limit`.
 *     - Sellers are scoped to their own products; admins can see all mappings.
 *
 *   PUT /api/supplier-products/:id
 *     - Updates `cost_price`, `lead_time_days`, `supplier_product_name`,
 *       and/or `supplier_sku` for an existing mapping.
 *     - Validates mapping id, existence, and role-based product access.
 *
 * Controller changes (April 2026):
 *   Added `supplier_product_name` and `supplier_sku` to:
 *     - SUPPLIER_PRODUCT_SELECT  — returned in all GET/POST/PUT responses
 *     - createSupplierProduct    — persisted on INSERT when provided
 *     - updateSupplierProduct    — persisted on UPDATE when provided
 *
 * Access model:
 *   - Routes are protected with requireRole("seller"), which permits both
 *     seller and admin users via role hierarchy.
 *   - Seller users can only manage mappings for products owned by their seller_id.
 *   - Admin users can manage mappings globally.
 *
 * Related DB tables:
 *   - supplier_products (primary table for these endpoints)
 *   - suppliers (existence + join metadata)
 *   - products (ownership checks + join metadata)
 */
import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import { ApiResponse } from "../types";
import { SupplierProduct } from "../types/supplierProduct";
import {
  createSupplierProductSchema,
  updateSupplierProductSchema,
} from "../validators/supplierProductValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
}

function parsePage(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20)
  );
  return {
    page,
    limit,
    from: (page - 1) * limit,
    to: (page - 1) * limit + limit - 1,
  };
}

/**
 * Columns selected in every supplier_products query.
 * Includes the two new columns added to the table (April 2026):
 *   - supplier_product_name  VARCHAR(255)
 *   - supplier_sku           VARCHAR(100)
 */
const SUPPLIER_PRODUCT_SELECT = `
  id,
  supplier_id,
  product_id,
  cost_price,
  lead_time_days,
  supplier_product_name,
  supplier_sku,
  created_at,
  suppliers ( id, name, status ),
  products!inner ( id, name, product_code, seller_id )
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — assertSellerCanAccessProduct
//
// For non-admin callers: verifies that the authenticated seller profile
// owns the given product. Throws 403 if not; 404 if product not found.
// Admin users bypass this check entirely.
// ─────────────────────────────────────────────────────────────────────────────
async function assertSellerCanAccessProduct(
  productId: string,
  req: Request
): Promise<void> {
  // Admins are not subject to seller-level ownership checks
  const roleName = req.userRole?.role_name;
  if (roleName === "admin") return;

  const userId = req.user?.id;
  if (!userId) throw new AppError("Unauthorized", 401);

  // Resolve the caller's seller profile
  const { data: sellerRow } = await supabaseAdmin
    .from("sellers")
    .select("id")
    .eq("user_id", userId)
    .single<{ id: string }>();

  if (!sellerRow) {
    throw new AppError("No seller profile found for this account", 403);
  }

  // Confirm the product belongs to this seller
  const { data: product } = await supabaseAdmin
    .from("products")
    .select("seller_id")
    .eq("id", productId)
    .single<{ seller_id: string | null }>();

  if (!product) {
    throw new AppError(`Product with id ${productId} not found`, 404);
  }

  if (product.seller_id !== sellerRow.id) {
    throw new AppError("You do not have permission to manage this product", 403);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/supplier-products   — seller+
//
// Creates a new supplier-product mapping.
//
// Request body (JSON):
//   {
//     supplier_id:           string  (UUID, required)
//     product_id:            string  (UUID, required)
//     cost_price?:           number | null
//     lead_time_days?:       number | null
//     supplier_product_name?: string | null   ← NEW
//     supplier_sku?:         string | null    ← NEW
//   }
//
// Returns 201 with the created supplier_products row.
// Returns 409 if the (supplier_id, product_id) mapping already exists.
// ─────────────────────────────────────────────────────────────────────────────
export const createSupplierProduct = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = createSupplierProductSchema.parse(req.body);

    // Confirm the supplier exists before creating the mapping
    const { data: supplier } = await supabaseAdmin
      .from("suppliers")
      .select("id")
      .eq("id", body.supplier_id)
      .single<{ id: string }>();

    if (!supplier) {
      throw new AppError(`Supplier with id ${body.supplier_id} not found`, 404);
    }

    // Enforce seller ownership for non-admin callers
    await assertSellerCanAccessProduct(body.product_id, req);

    // Insert the mapping row, including the two new columns
    const { data, error } = await supabaseAdmin
      .from("supplier_products")
      .insert({
        supplier_id:           body.supplier_id,
        product_id:            body.product_id,
        cost_price:            body.cost_price            ?? null,
        lead_time_days:        body.lead_time_days        ?? null,
        supplier_product_name: body.supplier_product_name ?? null, // ← NEW
        supplier_sku:          body.supplier_sku          ?? null, // ← NEW
      })
      .select(SUPPLIER_PRODUCT_SELECT)
      .single();

    if (error) {
      // Supabase / Postgres unique-constraint violation code
      if (error.code === "23505") {
        throw new AppError("This supplier-product mapping already exists", 409);
      }
      throw new AppError(`Failed to create supplier product: ${error.message}`, 500);
    }

    res.status(201).json({
      success: true,
      message: "Supplier product created successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/supplier-products   — seller+
//
// Returns a paginated list of supplier-product mappings.
//
// Query params:
//   ?supplier_id=<uuid>   — filter to a specific supplier
//   ?product_id=<uuid>    — filter to a specific product
//   ?page=<n>             — page number (default 1)
//   ?limit=<n>            — items per page (default 20, max 100)
//
// Sellers are scoped to their own products via a join filter on
// products.seller_id. Admins see all mappings.
//
// Response includes supplier_product_name and supplier_sku in every row.
// ─────────────────────────────────────────────────────────────────────────────
export const listSupplierProducts = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(
      req.query as Record<string, unknown>
    );

    const supplierId = req.query.supplier_id as string | undefined;
    const productId  = req.query.product_id  as string | undefined;

    // Validate any UUIDs provided as query params before forwarding to Supabase
    if (supplierId) validateUuid(supplierId, "supplier_id");
    if (productId)  validateUuid(productId,  "product_id");

    // Build base query — SUPPLIER_PRODUCT_SELECT includes the new columns
    let query = supabaseAdmin
      .from("supplier_products")
      .select(SUPPLIER_PRODUCT_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    // Apply optional direct-column filters
    if (supplierId) query = query.eq("supplier_id", supplierId);
    if (productId)  query = query.eq("product_id", productId);

    // Seller-level scoping: restrict to products owned by the calling seller
    if (req.userRole?.role_name === "seller") {
      const userId = req.user?.id;
      if (!userId) throw new AppError("Unauthorized", 401);

      const { data: sellerRow } = await supabaseAdmin
        .from("sellers")
        .select("id")
        .eq("user_id", userId)
        .single<{ id: string }>();

      if (!sellerRow) {
        throw new AppError("No seller profile found for this account", 403);
      }

      // Filter via the joined products table — only mappings for this seller's products
      query = query.eq("products.seller_id", sellerRow.id);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new AppError(`Failed to fetch supplier products: ${error.message}`, 500);
    }

    res.status(200).json({
      success: true,
      data: {
        data:    data ?? [],
        total:   count ?? 0,
        page,
        limit,
        hasMore: (count ?? 0) > page * limit,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/supplier-products/:id   — seller+
//
// Updates any subset of mutable fields on an existing supplier-product mapping.
// At least one field must be provided (enforced by Zod schema).
//
// Updatable fields:
//   cost_price, lead_time_days, supplier_product_name, supplier_sku
//
// Path params:
//   :id — UUID of the supplier_products row to update
//
// Response 200: { success: true, message: "...", data: SupplierProduct }
// Response 404: mapping not found
// Response 403: caller does not own the product
// ─────────────────────────────────────────────────────────────────────────────
export const updateSupplierProduct = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "supplier product id");

    const body = updateSupplierProductSchema.parse(req.body);

    // Confirm the mapping exists and retrieve its product_id for ownership check
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("supplier_products")
      .select("id, product_id")
      .eq("id", id)
      .single<{ id: string; product_id: string }>();

    if (existingError || !existing) {
      throw new AppError(`Supplier product with id ${id} not found`, 404);
    }

    // Enforce seller ownership for non-admin callers
    await assertSellerCanAccessProduct(existing.product_id, req);

    // Build the update payload from only the fields that were explicitly sent.
    // Sending null explicitly clears the column; undefined skips it (no change).
    const payload: Partial<SupplierProduct> = {};

    if (body.cost_price            !== undefined) payload.cost_price            = body.cost_price;
    if (body.lead_time_days        !== undefined) payload.lead_time_days        = body.lead_time_days;
    if (body.supplier_product_name !== undefined) payload.supplier_product_name = body.supplier_product_name; // ← NEW
    if (body.supplier_sku          !== undefined) payload.supplier_sku          = body.supplier_sku;          // ← NEW

    const { data, error } = await supabaseAdmin
      .from("supplier_products")
      .update(payload)
      .eq("id", id)
      .select(SUPPLIER_PRODUCT_SELECT)
      .single();

    if (error || !data) {
      throw new AppError(
        `Failed to update supplier product: ${error?.message}`,
        500
      );
    }

    res.status(200).json({
      success: true,
      message: "Supplier product updated successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};
