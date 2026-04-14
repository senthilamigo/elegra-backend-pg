/**
 * File: src/controllers/purchaseOrderController.ts
 * Path: src/controllers/purchaseOrderController.ts
 *
 * Handlers for purchase order endpoints.
 *
 * Endpoints in this file:
 *   - GET /api/purchase-orders
 *   - GET /api/purchase-orders/:id
 *   - PUT /api/purchase-orders/:id/status
 *   - POST /api/purchase-orders
 *
 * Tables used:
 *   - purchase_orders
 *   - purchase_order_items
 *   - suppliers               (supplier validation)
 *   - sellers                 (admin seller validation)
 *   - product_variants + products (seller ownership checks for line items)
 *
 * Access model:
 *   - seller: restricted to own seller_id rows
 *   - admin: unrestricted
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import { ApiResponse } from "../types";
import { PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from "../types/purchaseOrder";
import {
  createPurchaseOrderSchema,
  updatePurchaseOrderStatusSchema,
} from "../validators/purchaseOrderValidators";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PURCHASE_ORDER_SELECT = `
  id, seller_id, supplier_id, status, order_date, expected_delivery_date, created_at,
  suppliers ( id, name, status )
`.trim();

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
}

function parsePage(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  return { page, limit, from: (page - 1) * limit, to: (page - 1) * limit + limit - 1 };
}

function isAdmin(req: Request): boolean {
  return req.userRole?.role_name === "admin";
}

function resolveSellerId(req: Request, sellerIdFromBody?: string): string {
  if (isAdmin(req)) {
    const sellerId = sellerIdFromBody ?? req.userRole?.seller_id;
    if (!sellerId) {
      throw new AppError("seller_id is required when admin account has no linked seller profile", 400);
    }
    return sellerId;
  }

  const sellerId = req.userRole?.seller_id;
  if (!sellerId) throw new AppError("No seller profile linked to this account", 403);
  return sellerId;
}

async function assertSellerExists(sellerId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("sellers")
    .select("id")
    .eq("id", sellerId)
    .single<{ id: string }>();

  if (!data) throw new AppError(`Seller with id ${sellerId} not found`, 404);
}

async function assertSupplierExists(supplierId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("suppliers")
    .select("id, status")
    .eq("id", supplierId)
    .single<{ id: string; status: string | null }>();

  if (!data) throw new AppError(`Supplier with id ${supplierId} not found`, 404);
  if (data.status === "suspended" || data.status === "inactive") {
    throw new AppError(`Supplier with id ${supplierId} is not active`, 400);
  }
}

async function assertVariantAccess(variantId: string, sellerId: string, admin: boolean): Promise<void> {
  const { data } = await supabaseAdmin
    .from("product_variants")
    .select("id, product_id, products!inner ( seller_id )")
    .eq("id", variantId)
    .single<{ id: string; product_id: string; products: { seller_id: string } | { seller_id: string }[] }>();

  if (!data) throw new AppError(`Product variant with id ${variantId} not found`, 404);

  const productsJoin = Array.isArray(data.products) ? data.products[0] : data.products;
  if (!admin && productsJoin?.seller_id !== sellerId) {
    throw new AppError(`You do not have permission to use product variant ${variantId}`, 403);
  }
}

export const listPurchaseOrders = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const status = req.query.status as PurchaseOrderStatus | undefined;
    const admin = isAdmin(req);

    if (status && !["pending", "shipped", "received"].includes(status)) {
      throw new AppError("status must be 'pending', 'shipped', or 'received'", 400);
    }

    let query = supabaseAdmin
      .from("purchase_orders")
      .select(PURCHASE_ORDER_SELECT, { count: "exact" })
      .order("order_date", { ascending: false })
      .range(from, to);

    if (!admin) {
      const sellerId = req.userRole?.seller_id;
      if (!sellerId) throw new AppError("No seller profile linked to this account", 403);
      query = query.eq("seller_id", sellerId);
    } else if (req.query.seller_id) {
      const sellerId = String(req.query.seller_id);
      validateUuid(sellerId, "seller_id");
      query = query.eq("seller_id", sellerId);
    }

    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;
    if (error) throw new AppError(`Failed to fetch purchase orders: ${error.message}`, 500);

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

export const getPurchaseOrder = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "purchase order id");

    const admin = isAdmin(req);
    let query = supabaseAdmin
      .from("purchase_orders")
      .select(PURCHASE_ORDER_SELECT)
      .eq("id", id);

    if (!admin) {
      const sellerId = req.userRole?.seller_id;
      if (!sellerId) throw new AppError("No seller profile linked to this account", 403);
      query = query.eq("seller_id", sellerId);
    }

    const { data: po, error } = await query.single<PurchaseOrder & { suppliers?: unknown }>();
    if (error || !po) throw new AppError(`Purchase order with id ${id} not found`, 404);

    const { data: items, error: itemsError } = await supabaseAdmin
      .from("purchase_order_items")
      .select("id, purchase_order_id, product_variant_id, quantity, unit_cost, received_quantity, product_variants ( id, product_id, sku, color, size, base_price, status )")
      .eq("purchase_order_id", id)
      .order("id", { ascending: true });

    if (itemsError) throw new AppError(`Failed to fetch purchase order items: ${itemsError.message}`, 500);

    res.status(200).json({
      success: true,
      data: {
        ...po,
        items: items ?? [],
      },
    });
  } catch (err) {
    next(err);
  }
};

export const updatePurchaseOrderStatus = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "purchase order id");

    const body = updatePurchaseOrderStatusSchema.parse(req.body);
    const admin = isAdmin(req);

    let existingQuery = supabaseAdmin
      .from("purchase_orders")
      .select("id, seller_id, status")
      .eq("id", id);

    if (!admin) {
      const sellerId = req.userRole?.seller_id;
      if (!sellerId) throw new AppError("No seller profile linked to this account", 403);
      existingQuery = existingQuery.eq("seller_id", sellerId);
    }

    const { data: existing } = await existingQuery.single<{ id: string; seller_id: string; status: PurchaseOrderStatus }>();
    if (!existing) throw new AppError(`Purchase order with id ${id} not found`, 404);

    const { data, error } = await supabaseAdmin
      .from("purchase_orders")
      .update({ status: body.status })
      .eq("id", id)
      .select(PURCHASE_ORDER_SELECT)
      .single<PurchaseOrder>();

    if (error || !data) throw new AppError(`Failed to update purchase order status: ${error?.message}`, 500);

    res.status(200).json({
      success: true,
      message: "Purchase order status updated successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};

export const createPurchaseOrder = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = createPurchaseOrderSchema.parse(req.body);
    const admin = isAdmin(req);
    const sellerId = resolveSellerId(req, body.seller_id);

    await assertSellerExists(sellerId);
    await assertSupplierExists(body.supplier_id);

    for (const item of body.items) {
      await assertVariantAccess(item.product_variant_id, sellerId, admin);
    }

    const { data: po, error: poError } = await supabaseAdmin
      .from("purchase_orders")
      .insert({
        seller_id: sellerId,
        supplier_id: body.supplier_id,
        status: "pending",
        expected_delivery_date: body.expected_delivery_date ?? null,
      })
      .select(PURCHASE_ORDER_SELECT)
      .single<PurchaseOrder>();

    if (poError || !po) throw new AppError(`Failed to create purchase order: ${poError?.message}`, 500);

    const itemsPayload = body.items.map((item) => ({
      purchase_order_id: po.id,
      product_variant_id: item.product_variant_id,
      quantity: item.quantity,
      unit_cost: item.unit_cost ?? null,
      received_quantity: 0,
    }));

    const { data: insertedItems, error: itemsError } = await supabaseAdmin
      .from("purchase_order_items")
      .insert(itemsPayload)
      .select("id, purchase_order_id, product_variant_id, quantity, unit_cost, received_quantity")
      .returns<PurchaseOrderItem[]>();

    if (itemsError) {
      await supabaseAdmin.from("purchase_orders").delete().eq("id", po.id);
      throw new AppError(`Failed to create purchase order items: ${itemsError.message}`, 500);
    }

    res.status(201).json({
      success: true,
      message: "Purchase order created successfully.",
      data: {
        ...po,
        items: insertedItems ?? [],
      },
    });
  } catch (err) {
    next(err);
  }
};
