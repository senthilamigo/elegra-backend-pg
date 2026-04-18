/**
 * File: src/controllers/supplierReturnController.ts
 * Path: src/controllers/supplierReturnController.ts
 *
 * Handlers for supplier return endpoints.
 *
 * Endpoints in this file:
 *   - POST /api/supplier-returns
 *   - GET  /api/supplier-returns
 *   - GET  /api/supplier-returns/:id
 *   - PUT  /api/supplier-returns/:id/status
 *
 * Tables used:
 *   - supplier_returns
 *   - supplier_return_items
 *   - inventory_batches
 *   - product_variants + products (seller ownership checks)
 *   - suppliers (list/get response context)
 *
 * Access model:
 *   - seller: restricted to own seller_id rows
 *   - admin: unrestricted (optional seller_id filters)
 */

import { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import { ApiResponse } from "../types";
import { SupplierReturn, SupplierReturnItem, SupplierReturnStatus } from "../types/supplierReturn";
import {
  createSupplierReturnSchema,
  updateSupplierReturnStatusSchema,
} from "../validators/supplierReturnValidators";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPPLIER_RETURN_SELECT = `
  id,
  supplier_id,
  seller_id,
  reason,
  status,
  created_at,
  suppliers ( id, name, status )
`.trim();

type InventoryBatchValidationRow = {
  id: string;
  supplier_id: string | null;
  remaining_quantity: number;
  product_variants: {
    id: string;
    products: {
      id: string;
      seller_id: string | null;
    } | null;
  } | null;
};

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

function assertNoDuplicateBatchIds(items: { inventory_batch_id: string }[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.inventory_batch_id)) {
      throw new AppError(`Duplicate inventory_batch_id found: ${item.inventory_batch_id}`, 400);
    }
    seen.add(item.inventory_batch_id);
  }
}

async function fetchInventoryBatches(ids: string[]): Promise<InventoryBatchValidationRow[]> {
  const { data, error } = await supabaseAdmin
    .from("inventory_batches")
    .select(`
      id,
      supplier_id,
      remaining_quantity,
      product_variants(
        id,
        products(
          id,
          seller_id
        )
      )
    `)
    .in("id", ids)
    .returns<InventoryBatchValidationRow[]>();

  if (error) {
    throw new AppError(`Failed to validate inventory batches: ${error.message}`, 500);
  }

  return data ?? [];
}

export const createSupplierReturn = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  let supplierReturnId: string | null = null;
  const updatedBatches: Array<{ id: string; previousRemaining: number }> = [];

  try {
    const body = createSupplierReturnSchema.parse(req.body);
    const sellerId = resolveSellerId(req, body.seller_id);
    assertNoDuplicateBatchIds(body.items);

    const requestedBatchIds = body.items.map((item) => item.inventory_batch_id);
    const inventoryRows = await fetchInventoryBatches(requestedBatchIds);

    if (inventoryRows.length !== requestedBatchIds.length) {
      const found = new Set(inventoryRows.map((row) => row.id));
      const missing = requestedBatchIds.filter((id) => !found.has(id));
      throw new AppError(`Inventory batch not found: ${missing[0]}`, 404);
    }

    const rowById = new Map(inventoryRows.map((row) => [row.id, row]));

    for (const item of body.items) {
      const row = rowById.get(item.inventory_batch_id)!;

      if (!row.supplier_id) {
        throw new AppError(`Inventory batch ${row.id} is not linked to a supplier`, 400);
      }

      if (row.supplier_id !== body.supplier_id) {
        throw new AppError(
          `Inventory batch ${row.id} belongs to a different supplier than supplier_id ${body.supplier_id}`,
          400
        );
      }

      if (row.remaining_quantity < item.quantity) {
        throw new AppError(
          `Insufficient inventory in batch ${row.id}. Available: ${row.remaining_quantity}, requested: ${item.quantity}`,
          400
        );
      }

      if (!isAdmin(req)) {
        const productSellerId = row.product_variants?.products?.seller_id;
        if (!productSellerId || productSellerId !== sellerId) {
          throw new AppError(`You do not have permission to return inventory batch ${row.id}`, 403);
        }
      }
    }

    const { data: supplierReturn, error: supplierReturnError } = await supabaseAdmin
      .from("supplier_returns")
      .insert({
        supplier_id: body.supplier_id,
        seller_id: sellerId,
        reason: body.reason ?? null,
        status: "initiated",
      })
      .select(SUPPLIER_RETURN_SELECT)
      .single<SupplierReturn>();

    if (supplierReturnError || !supplierReturn) {
      throw new AppError(`Failed to create supplier return: ${supplierReturnError?.message}`, 500);
    }

    supplierReturnId = supplierReturn.id;

    const payload = body.items.map((item) => ({
      return_id: supplierReturn.id,
      inventory_batch_id: item.inventory_batch_id,
      quantity: item.quantity,
    }));

    const { data: returnItems, error: returnItemsError } = await supabaseAdmin
      .from("supplier_return_items")
      .insert(payload)
      .select("id, return_id, inventory_batch_id, quantity")
      .returns<SupplierReturnItem[]>();

    if (returnItemsError) {
      throw new AppError(`Failed to create supplier return items: ${returnItemsError.message}`, 500);
    }

    for (const item of body.items) {
      const row = rowById.get(item.inventory_batch_id)!;
      const nextRemaining = row.remaining_quantity - item.quantity;

      const { error: updateError } = await supabaseAdmin
        .from("inventory_batches")
        .update({ remaining_quantity: nextRemaining })
        .eq("id", row.id);

      if (updateError) {
        throw new AppError(`Failed to update inventory batch ${row.id}: ${updateError.message}`, 500);
      }

      updatedBatches.push({ id: row.id, previousRemaining: row.remaining_quantity });
      row.remaining_quantity = nextRemaining;
    }

    res.status(201).json({
      success: true,
      message: "Supplier return request created successfully.",
      data: {
        ...supplierReturn,
        items: returnItems ?? [],
      },
    });
  } catch (err) {
    for (const batch of updatedBatches) {
      await supabaseAdmin
        .from("inventory_batches")
        .update({ remaining_quantity: batch.previousRemaining })
        .eq("id", batch.id);
    }

    if (supplierReturnId) {
      await supabaseAdmin.from("supplier_returns").delete().eq("id", supplierReturnId);
    }

    next(err);
  }
};

export const listSupplierReturns = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const status = req.query.status as SupplierReturnStatus | undefined;

    if (status && !["initiated", "shipped", "completed"].includes(status)) {
      throw new AppError("status must be 'initiated', 'shipped', or 'completed'", 400);
    }

    let query = supabaseAdmin
      .from("supplier_returns")
      .select(SUPPLIER_RETURN_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (!isAdmin(req)) {
      const sellerId = req.userRole?.seller_id;
      if (!sellerId) throw new AppError("No seller profile linked to this account", 403);
      query = query.eq("seller_id", sellerId);
    } else if (req.query.seller_id) {
      const sellerId = String(req.query.seller_id);
      validateUuid(sellerId, "seller_id");
      query = query.eq("seller_id", sellerId);
    }

    if (req.query.supplier_id) {
      const supplierId = String(req.query.supplier_id);
      validateUuid(supplierId, "supplier_id");
      query = query.eq("supplier_id", supplierId);
    }

    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;

    if (error) throw new AppError(`Failed to fetch supplier returns: ${error.message}`, 500);

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

export const getSupplierReturn = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "supplier return id");

    let returnQuery = supabaseAdmin
      .from("supplier_returns")
      .select(SUPPLIER_RETURN_SELECT)
      .eq("id", id);

    if (!isAdmin(req)) {
      const sellerId = req.userRole?.seller_id;
      if (!sellerId) throw new AppError("No seller profile linked to this account", 403);
      returnQuery = returnQuery.eq("seller_id", sellerId);
    }

    const { data: supplierReturn, error: supplierReturnError } = await returnQuery.single<SupplierReturn>();

    if (supplierReturnError || !supplierReturn) {
      throw new AppError(`Supplier return with id ${id} not found`, 404);
    }

    const { data: items, error: itemsError } = await supabaseAdmin
      .from("supplier_return_items")
      .select(`
        id,
        return_id,
        inventory_batch_id,
        quantity,
        inventory_batches(
          id,
          product_variant_id,
          supplier_id,
          shipment_id,
          quantity,
          remaining_quantity,
          unit_cost,
          landed_cost,
          created_at,
          product_variants(
            id,
            product_id,
            sku,
            color,
            size,
            base_price,
            status
          )
        )
      `)
      .eq("return_id", id)
      .order("id", { ascending: true });

    if (itemsError) throw new AppError(`Failed to fetch supplier return items: ${itemsError.message}`, 500);

    res.status(200).json({
      success: true,
      data: {
        ...supplierReturn,
        items: items ?? [],
      },
    });
  } catch (err) {
    next(err);
  }
};

export const updateSupplierReturnStatus = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "supplier return id");

    const body = updateSupplierReturnStatusSchema.parse(req.body);

    let existingQuery = supabaseAdmin
      .from("supplier_returns")
      .select("id, seller_id, status")
      .eq("id", id);

    if (!isAdmin(req)) {
      const sellerId = req.userRole?.seller_id;
      if (!sellerId) throw new AppError("No seller profile linked to this account", 403);
      existingQuery = existingQuery.eq("seller_id", sellerId);
    }

    const { data: existing } = await existingQuery.single<{
      id: string;
      seller_id: string;
      status: SupplierReturnStatus;
    }>();

    if (!existing) throw new AppError(`Supplier return with id ${id} not found`, 404);

    const { data, error } = await supabaseAdmin
      .from("supplier_returns")
      .update({ status: body.status })
      .eq("id", id)
      .select(SUPPLIER_RETURN_SELECT)
      .single<SupplierReturn>();

    if (error || !data) throw new AppError(`Failed to update supplier return status: ${error?.message}`, 500);

    res.status(200).json({
      success: true,
      message: "Supplier return status updated successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};
