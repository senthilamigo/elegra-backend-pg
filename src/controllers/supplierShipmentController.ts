
/**
 * File: src/controllers/supplierShipmentController.ts
 * Path: src/controllers/supplierShipmentController.ts
 *
 * Handlers for supplier shipment endpoints.
 *
 * Endpoints in this file:
 *   - POST /api/supplier-shipments      (Create shipment)
 *   - GET  /api/supplier-shipments      (List shipments)
 *   - GET  /api/supplier-shipments/:id  (Get shipment)
 *
 * Tables used:
 *   - supplier_shipments
 *   - supplier_shipment_items
 *   - purchase_orders
 *   - purchase_order_items
 *   - inventory_batches
 *   - shipment_cost_allocations
 *   - suppliers, product_variants (join metadata)
 *
 * Access model:
 *   - seller: restricted to shipments tied to own seller_id via purchase_orders
 *   - admin: unrestricted (optionally filter by seller_id)
 *
 * Transaction note:
 *   Supabase REST calls are independent HTTP operations; this controller
 *   implements a transaction-like workflow with explicit rollback cleanup
 *   if any step fails after partial inserts.
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import { ApiResponse } from "../types";
import {
  InventoryBatch,
  ShipmentCostAllocation,
  SupplierShipment,
  SupplierShipmentItem,
} from "../types/supplierShipment";
import { createSupplierShipmentSchema } from "../validators/supplierShipmentValidators";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPPLIER_SHIPMENT_SELECT = `
  id, supplier_id, purchase_order_id, courier_name, tracking_number,
  shipment_date, delivery_date, shipping_cost, status, created_at,
  suppliers ( id, name, status ),
  purchase_orders!inner ( id, seller_id, status, order_date )
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

function resolveSellerId(req: Request, sellerIdFromBodyOrQuery?: string): string {
  if (isAdmin(req)) {
    const sellerId = sellerIdFromBodyOrQuery ?? req.userRole?.seller_id;
    if (!sellerId) {
      throw new AppError("seller_id is required when admin account has no linked seller profile", 400);
    }
    return sellerId;
  }

  const sellerId = req.userRole?.seller_id;
  if (!sellerId) throw new AppError("No seller profile linked to this account", 403);
  return sellerId;
}

function toNumeric(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export const listSupplierShipments = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const admin = isAdmin(req);

    let query = supabaseAdmin
      .from("supplier_shipments")
      .select(SUPPLIER_SHIPMENT_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (!admin) {
      const sellerId = resolveSellerId(req);
      query = query.eq("purchase_orders.seller_id", sellerId);
    } else if (req.query.seller_id) {
      const sellerId = String(req.query.seller_id);
      validateUuid(sellerId, "seller_id");
      query = query.eq("purchase_orders.seller_id", sellerId);
    }

    if (req.query.purchase_order_id) {
      const purchaseOrderId = String(req.query.purchase_order_id);
      validateUuid(purchaseOrderId, "purchase_order_id");
      query = query.eq("purchase_order_id", purchaseOrderId);
    }

    const { data, error, count } = await query;
    if (error) throw new AppError(`Failed to fetch supplier shipments: ${error.message}`, 500);

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

export const getSupplierShipment = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "supplier shipment id");

    const admin = isAdmin(req);
    let query = supabaseAdmin.from("supplier_shipments").select(SUPPLIER_SHIPMENT_SELECT).eq("id", id);

    if (!admin) {
      const sellerId = resolveSellerId(req);
      query = query.eq("purchase_orders.seller_id", sellerId);
    }

    const { data: shipment, error } = await query.single<SupplierShipment & { purchase_orders?: unknown; suppliers?: unknown }>();
    if (error || !shipment) throw new AppError(`Supplier shipment with id ${id} not found`, 404);

    const { data: items, error: itemsError } = await supabaseAdmin
      .from("supplier_shipment_items")
      .select("id, shipment_id, product_variant_id, quantity, product_variants ( id, product_id, sku, color, size, base_price, status )")
      .eq("shipment_id", id)
      .order("id", { ascending: true });

    if (itemsError) throw new AppError(`Failed to fetch supplier shipment items: ${itemsError.message}`, 500);

    const { data: batches, error: batchesError } = await supabaseAdmin
      .from("inventory_batches")
      .select("id, product_variant_id, supplier_id, shipment_id, quantity, remaining_quantity, unit_cost, landed_cost, created_at")
      .eq("shipment_id", id)
      .order("created_at", { ascending: true })
      .returns<InventoryBatch[]>();

    if (batchesError) throw new AppError(`Failed to fetch inventory batches: ${batchesError.message}`, 500);

    const { data: allocations, error: allocationsError } = await supabaseAdmin
      .from("shipment_cost_allocations")
      .select("id, shipment_id, inventory_batch_id, allocated_cost")
      .eq("shipment_id", id)
      .order("id", { ascending: true })
      .returns<ShipmentCostAllocation[]>();

    if (allocationsError) throw new AppError(`Failed to fetch shipment cost allocations: ${allocationsError.message}`, 500);

    res.status(200).json({
      success: true,
      data: {
        ...shipment,
        items: items ?? [],
        inventory_batches: batches ?? [],
        shipment_cost_allocations: allocations ?? [],
      },
    });
  } catch (err) {
    next(err);
  }
};

export const createSupplierShipment = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  let shipmentId: string | null = null;

  try {
    const body = createSupplierShipmentSchema.parse(req.body);
    const admin = isAdmin(req);
    const sellerId = resolveSellerId(req, body.seller_id);

    const { data: purchaseOrder, error: poError } = await supabaseAdmin
      .from("purchase_orders")
      .select("id, seller_id, supplier_id")
      .eq("id", body.purchase_order_id)
      .single<{ id: string; seller_id: string; supplier_id: string }>();

    if (poError || !purchaseOrder) {
      throw new AppError(`Purchase order with id ${body.purchase_order_id} not found`, 404);
    }

    if (!admin && purchaseOrder.seller_id !== sellerId) {
      throw new AppError("You do not have permission to create shipments for this purchase order", 403);
    }

    if (admin && purchaseOrder.seller_id !== sellerId) {
      throw new AppError(`purchase_order_id ${body.purchase_order_id} does not belong to seller_id ${sellerId}`, 400);
    }

    const variantIds = [...new Set(body.items.map((item) => item.product_variant_id))];

    const { data: poItems, error: poItemsError } = await supabaseAdmin
      .from("purchase_order_items")
      .select("product_variant_id, quantity, unit_cost")
      .eq("purchase_order_id", body.purchase_order_id)
      .in("product_variant_id", variantIds)
      .returns<Array<{ product_variant_id: string; quantity: number; unit_cost: number | null }>>();

    if (poItemsError) throw new AppError(`Failed to validate purchase order items: ${poItemsError.message}`, 500);

    if (!poItems || poItems.length !== variantIds.length) {
      throw new AppError("All shipped product variants must exist in the selected purchase order", 400);
    }

    const poItemMap = new Map(poItems.map((item) => [item.product_variant_id, item]));

    const consolidatedItems = new Map<string, number>();
    for (const item of body.items) {
      const current = consolidatedItems.get(item.product_variant_id) ?? 0;
      consolidatedItems.set(item.product_variant_id, current + item.quantity);
    }

    const normalizedItems = Array.from(consolidatedItems.entries()).map(([product_variant_id, quantity]) => ({
      product_variant_id,
      quantity,
    }));

    for (const item of normalizedItems) {
      const poItem = poItemMap.get(item.product_variant_id);
      if (!poItem) {
        throw new AppError(`product_variant_id ${item.product_variant_id} does not exist in purchase order`, 400);
      }
      if (item.quantity > poItem.quantity) {
        throw new AppError(
          `Shipped quantity (${item.quantity}) exceeds purchase order quantity (${poItem.quantity}) for variant ${item.product_variant_id}`,
          400
        );
      }
    }

    const shippingCost = toNumeric(body.shipping_cost);

    const { data: shipment, error: shipmentError } = await supabaseAdmin
      .from("supplier_shipments")
      .insert({
        supplier_id: purchaseOrder.supplier_id,
        purchase_order_id: purchaseOrder.id,
        courier_name: body.courier_name ?? null,
        tracking_number: body.tracking_number ?? null,
        shipment_date: body.shipment_date ?? null,
        delivery_date: body.delivery_date ?? null,
        shipping_cost: shippingCost,
        status: body.status ?? "in_transit",
      })
      .select(SUPPLIER_SHIPMENT_SELECT)
      .single<SupplierShipment & { purchase_orders?: unknown; suppliers?: unknown }>();

    if (shipmentError || !shipment) throw new AppError(`Failed to create supplier shipment: ${shipmentError?.message}`, 500);
    shipmentId = shipment.id;

    const shipmentItemsPayload = normalizedItems.map((item) => ({
      shipment_id: shipment.id,
      product_variant_id: item.product_variant_id,
      quantity: item.quantity,
    }));

    const { data: insertedShipmentItems, error: shipmentItemsError } = await supabaseAdmin
      .from("supplier_shipment_items")
      .insert(shipmentItemsPayload)
      .select("id, shipment_id, product_variant_id, quantity")
      .returns<SupplierShipmentItem[]>();

    if (shipmentItemsError) throw new AppError(`Failed to create supplier shipment items: ${shipmentItemsError.message}`, 500);

    const inventoryBatchesPayload = normalizedItems.map((item) => ({
      product_variant_id: item.product_variant_id,
      supplier_id: purchaseOrder.supplier_id,
      shipment_id: shipment.id,
      quantity: item.quantity,
      remaining_quantity: item.quantity,
      unit_cost: poItemMap.get(item.product_variant_id)?.unit_cost ?? null,
      landed_cost: null as number | null,
    }));

    const { data: insertedBatches, error: batchesError } = await supabaseAdmin
      .from("inventory_batches")
      .insert(inventoryBatchesPayload)
      .select("id, product_variant_id, supplier_id, shipment_id, quantity, remaining_quantity, unit_cost, landed_cost, created_at")
      .returns<InventoryBatch[]>();

    if (batchesError) throw new AppError(`Failed to create inventory batches: ${batchesError.message}`, 500);

    const totalQuantity = insertedBatches.reduce((sum, batch) => sum + batch.quantity, 0);

    if (shippingCost > 0 && totalQuantity > 0) {
      let allocatedRunningTotal = 0;

      const allocationRows = insertedBatches.map((batch, index) => {
        let allocatedCost = 0;

        if (index === insertedBatches.length - 1) {
          allocatedCost = Number((shippingCost - allocatedRunningTotal).toFixed(2));
        } else {
          allocatedCost = Number(((shippingCost * batch.quantity) / totalQuantity).toFixed(2));
          allocatedRunningTotal = Number((allocatedRunningTotal + allocatedCost).toFixed(2));
        }

        const unitCost = toNumeric(batch.unit_cost);
        const landedCostPerUnit = Number((unitCost + allocatedCost / batch.quantity).toFixed(2));

        return {
          shipment_id: shipment.id,
          inventory_batch_id: batch.id,
          allocated_cost: allocatedCost,
          landed_cost: landedCostPerUnit,
        };
      });

      const { error: allocationError } = await supabaseAdmin
        .from("shipment_cost_allocations")
        .insert(
          allocationRows.map(({ shipment_id, inventory_batch_id, allocated_cost }) => ({
            shipment_id,
            inventory_batch_id,
            allocated_cost,
          }))
        );

      if (allocationError) throw new AppError(`Failed to create shipment cost allocations: ${allocationError.message}`, 500);

      for (const row of allocationRows) {
        const { error: batchUpdateError } = await supabaseAdmin
          .from("inventory_batches")
          .update({ landed_cost: row.landed_cost })
          .eq("id", row.inventory_batch_id);

        if (batchUpdateError) {
          throw new AppError(`Failed to update landed cost on inventory batch ${row.inventory_batch_id}`, 500);
        }
      }
    } else {
      for (const batch of insertedBatches) {
        const { error: batchUpdateError } = await supabaseAdmin
          .from("inventory_batches")
          .update({ landed_cost: batch.unit_cost })
          .eq("id", batch.id);

        if (batchUpdateError) {
          throw new AppError(`Failed to update landed cost on inventory batch ${batch.id}`, 500);
        }
      }
    }

    const { data: finalShipment } = await supabaseAdmin
      .from("supplier_shipments")
      .select(SUPPLIER_SHIPMENT_SELECT)
      .eq("id", shipment.id)
      .single<SupplierShipment & { purchase_orders?: unknown; suppliers?: unknown }>();

    const { data: finalBatches } = await supabaseAdmin
      .from("inventory_batches")
      .select("id, product_variant_id, supplier_id, shipment_id, quantity, remaining_quantity, unit_cost, landed_cost, created_at")
      .eq("shipment_id", shipment.id)
      .order("created_at", { ascending: true })
      .returns<InventoryBatch[]>();

    const { data: finalAllocations } = await supabaseAdmin
      .from("shipment_cost_allocations")
      .select("id, shipment_id, inventory_batch_id, allocated_cost")
      .eq("shipment_id", shipment.id)
      .order("id", { ascending: true })
      .returns<ShipmentCostAllocation[]>();

    res.status(201).json({
      success: true,
      message: "Supplier shipment created successfully.",
      data: {
        shipment: finalShipment ?? shipment,
        items: insertedShipmentItems ?? [],
        inventory_batches: finalBatches ?? [],
        shipment_cost_allocations: finalAllocations ?? [],
      },
    });
  } catch (err) {
    if (shipmentId) {
      await supabaseAdmin.from("supplier_shipments").delete().eq("id", shipmentId);
    }
    next(err);
  }
};
