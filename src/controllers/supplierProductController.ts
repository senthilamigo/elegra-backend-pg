/**
 * File: src/controllers/supplierProductController.ts
 * Path: ecommerce-admin/src/controllers/supplierProductController.ts
 *
 * Controller handlers for supplier-product mapping APIs.
 *
 * Endpoints handled in this file:
 *   POST /api/supplier-products
 *     - Creates a mapping between a supplier and a product.
 *     - Allows optional initial `cost_price` and `lead_time_days`.
 *     - Validates supplier existence and product access.
 *
 *   GET /api/supplier-products
 *     - Returns paginated supplier-product mappings.
 *     - Supports optional query filters: `supplier_id`, `product_id`, `page`, `limit`.
 *     - Sellers are scoped to their own products; admins can see all mappings.
 *
 *   PUT /api/supplier-products/:id
 *     - Updates `cost_price` and/or `lead_time_days` for an existing mapping.
 *     - Validates mapping id, existence, and role-based product access.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPPLIER_PRODUCT_SELECT = `
  id, supplier_id, product_id, cost_price, lead_time_days, created_at,
  suppliers ( id, name, status ),
  products!inner ( id, name, product_code, seller_id )
`.trim();

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
}

function parsePage(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  return {
    page,
    limit,
    from: (page - 1) * limit,
    to: (page - 1) * limit + limit - 1,
  };
}

async function assertSellerCanAccessProduct(productId: string, req: Request): Promise<void> {
  const roleName = req.userRole?.role_name;
  if (roleName === "admin") return;

  const userId = req.user?.id;
  if (!userId) throw new AppError("Unauthorized", 401);

  const { data: sellerRow } = await supabaseAdmin
    .from("sellers")
    .select("id")
    .eq("user_id", userId)
    .single<{ id: string }>();

  if (!sellerRow) throw new AppError("No seller profile found for this account", 403);

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

export const createSupplierProduct = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = createSupplierProductSchema.parse(req.body);

    const { data: supplier } = await supabaseAdmin
      .from("suppliers")
      .select("id")
      .eq("id", body.supplier_id)
      .single<{ id: string }>();

    if (!supplier) {
      throw new AppError(`Supplier with id ${body.supplier_id} not found`, 404);
    }

    await assertSellerCanAccessProduct(body.product_id, req);

    const { data, error } = await supabaseAdmin
      .from("supplier_products")
      .insert({
        supplier_id: body.supplier_id,
        product_id: body.product_id,
        cost_price: body.cost_price ?? null,
        lead_time_days: body.lead_time_days ?? null,
      })
      .select(SUPPLIER_PRODUCT_SELECT)
      .single();

    if (error) {
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

export const listSupplierProducts = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const supplierId = req.query.supplier_id as string | undefined;
    const productId = req.query.product_id as string | undefined;

    if (supplierId) validateUuid(supplierId, "supplier_id");
    if (productId) validateUuid(productId, "product_id");

    let query = supabaseAdmin
      .from("supplier_products")
      .select(SUPPLIER_PRODUCT_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (supplierId) query = query.eq("supplier_id", supplierId);
    if (productId) query = query.eq("product_id", productId);

    if (req.userRole?.role_name === "seller") {
      const userId = req.user?.id;
      if (!userId) throw new AppError("Unauthorized", 401);

      const { data: sellerRow } = await supabaseAdmin
        .from("sellers")
        .select("id")
        .eq("user_id", userId)
        .single<{ id: string }>();

      if (!sellerRow) throw new AppError("No seller profile found for this account", 403);
      query = query.eq("products.seller_id", sellerRow.id);
    }

    const { data, error, count } = await query;
    if (error) throw new AppError(`Failed to fetch supplier products: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      data: {
        data: data ?? [],
        total: count ?? 0,
        page,
        limit,
        hasMore: (count ?? 0) > page * limit,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const updateSupplierProduct = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "supplier product id");

    const body = updateSupplierProductSchema.parse(req.body);

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("supplier_products")
      .select("id, product_id")
      .eq("id", id)
      .single<{ id: string; product_id: string }>();

    if (existingError || !existing) {
      throw new AppError(`Supplier product with id ${id} not found`, 404);
    }

    await assertSellerCanAccessProduct(existing.product_id, req);

    const payload: Partial<SupplierProduct> = {};
    if (body.cost_price !== undefined) payload.cost_price = body.cost_price;
    if (body.lead_time_days !== undefined) payload.lead_time_days = body.lead_time_days;

    const { data, error } = await supabaseAdmin
      .from("supplier_products")
      .update(payload)
      .eq("id", id)
      .select(SUPPLIER_PRODUCT_SELECT)
      .single();

    if (error || !data) {
      throw new AppError(`Failed to update supplier product: ${error?.message}`, 500);
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
