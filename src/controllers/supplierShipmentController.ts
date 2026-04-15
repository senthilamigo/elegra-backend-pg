/**
 * File: src/controllers/supplierShipmentController.ts
 * Path: src/controllers/supplierShipmentController.ts
 *
 * Handlers for supplier shipment endpoints.
 *
 * Endpoints:
 *   - POST /api/supplier-shipments      (create shipment + inventory + allocations)
 *   - GET  /api/supplier-shipments      (list shipments)
 *   - GET  /api/supplier-shipments/:id  (get one shipment)
 *
 * Access:
 *   - seller and admin roles (enforced at route layer via requireRole("seller"))
 *
 * Create workflow:
 *   1) Insert supplier_shipments
 *   2) Insert supplier_shipment_items
 *   3) Create inventory_batches (one per product_variant)
 *   4) Calculate total quantity
 *   5) Distribute shipping_cost into shipment_cost_allocations
 *      and update inventory_batches.landed_cost
 *
 * Transaction note:
 *   Supabase REST calls do not provide explicit BEGIN/COMMIT control in this layer.
 *   This file implements compensating rollback cleanup when a downstream step fails.
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import { ApiResponse } from "../types";
import type {
  SupplierShipment as SupplierShipmentRecord,
  SupplierShipmentItem as SupplierShipmentItemRecord,
  InventoryBatch as InventoryBatchRecord,
  ShipmentCostAllocation as ShipmentCostAllocationRecord,
} from "../types/supplierShipment";
import { createSupplierShipmentSchema } from "../validators/supplierShipmentValidators";

type PurchaseOrderRow = {
  id: string;
  seller_id: string;
  supplier_id: string;
};

type PurchaseOrderItemRow = {
  id: string;
  purchase_order_id: string;
  product_variant_id: string;
  quantity: number;
  unit_cost: number | null;
  received_quantity: number | null;
};

type ShipmentListRow = SupplierShipmentRecord & {
  purchase_orders?: {
    id: string;
    seller_id: string;
  } | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPPLIER_SHIPMENT_SELECT = `
  id,
  supplier_id,
  purchase_order_id,
  courier_name,
  tracking_number,
  shipment_date,
  delivery_date,
  shipping_cost,
  status,
  created_at
`.trim();

const SUPPLIER_SHIPMENT_LIST_SELECT = `
  id,
  supplier_id,
  purchase_order_id,
  courier_name,
  tracking_number,
  shipment_date,
  delivery_date,
  shipping_cost,
  status,
  created_at,
  purchase_orders ( id, seller_id )
`.trim();

function isAdmin(req: Request): boolean {
  return req.userRole?.role_name === "admin";
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
}

function parsePage(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  return { page, limit, from: (page - 1) * limit, to: (page - 1) * limit + limit - 1 };
}

function normalizeItems(items: Array<{ product_variant_id: string; quantity: number }>) {
  const grouped = new Map<string, number>();

  for (const item of items) {
    grouped.set(item.product_variant_id, (grouped.get(item.product_variant_id) ?? 0) + item.quantity);
  }

  return Array.from(grouped.entries()).map(([product_variant_id, quantity]) => ({
    product_variant_id,
    quantity,
  }));
}

async function fetchShipmentDetails(shipmentId: string) {
  const { data: shipment, error: shipmentError } = await supabaseAdmin
    .from("supplier_shipments")
    .select(SUPPLIER_SHIPMENT_SELECT)
    .eq("id", shipmentId)
    .single<SupplierShipmentRecord>();

  if (shipmentError || !shipment) {
    throw new AppError(`Supplier shipment with id ${shipmentId} not found`, 404);
  }

  const { data: shipmentItems, error: shipmentItemsError } = await supabaseAdmin
    .from("supplier_shipment_items")
    .select("id, shipment_id, product_variant_id, quantity")
    .eq("shipment_id", shipmentId)
    .order("id", { ascending: true })
    .returns<SupplierShipmentItemRecord[]>();

  if (shipmentItemsError) {
    throw new AppError(`Failed to fetch supplier shipment items: ${shipmentItemsError.message}`, 500);
  }

  const { data: inventoryBatches, error: inventoryBatchesError } = await supabaseAdmin
    .from("inventory_batches")
    .select("id, product_variant_id, supplier_id, shipment_id, quantity, remaining_quantity, unit_cost, landed_cost, created_at")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: true })
    .returns<InventoryBatchRecord[]>();

  if (inventoryBatchesError) {
    throw new AppError(`Failed to fetch inventory batches: ${inventoryBatchesError.message}`, 500);
  }

  const { data: allocations, error: allocationsError } = await supabaseAdmin
    .from("shipment_cost_allocations")
    .select("id, shipment_id, inventory_batch_id, allocated_cost")
    .eq("shipment_id", shipmentId)
    .order("id", { ascending: true })
    .returns<ShipmentCostAllocationRecord[]>();

  if (allocationsError) {
    throw new AppError(`Failed to fetch shipment cost allocations: ${allocationsError.message}`, 500);
  }

  const totalQuantity = (shipmentItems ?? []).reduce((sum, item) => sum + item.quantity, 0);

  return {
    shipment,
    shipment_items: shipmentItems ?? [],
    inventory_batches: inventoryBatches ?? [],
    total_quantity: totalQuantity,
    shipment_cost_allocations: allocations ?? [],
  };
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
      .select(SUPPLIER_SHIPMENT_LIST_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (!admin) {
      const callerSellerId = req.userRole?.seller_id;
      if (!callerSellerId) throw new AppError("No seller profile linked to this account", 403);
      query = query.eq("purchase_orders.seller_id", callerSellerId);
    }

    if (req.query.purchase_order_id) {
      const purchaseOrderId = String(req.query.purchase_order_id);
      validateUuid(purchaseOrderId, "purchase_order_id");
      query = query.eq("purchase_order_id", purchaseOrderId);
    }

    if (req.query.supplier_id) {
      const supplierId = String(req.query.supplier_id);
      validateUuid(supplierId, "supplier_id");
      query = query.eq("supplier_id", supplierId);
    }

    if (req.query.status) {
      const status = String(req.query.status);
      if (![
        "in_transit",
        "delivered",
      ].includes(status)) throw new AppError("status must be 'in_transit' or 'delivered'", 400);
      query = query.eq("status", status);
    }

    const { data, error, count } = await query.returns<ShipmentListRow[]>();

    if (error) throw new AppError(`Failed to fetch supplier shipments: ${error.message}`, 500);

    const shipments = (data ?? []).map((row) => ({
      id: row.id,
      supplier_id: row.supplier_id,
      purchase_order_id: row.purchase_order_id,
      courier_name: row.courier_name,
      tracking_number: row.tracking_number,
      shipment_date: row.shipment_date,
      delivery_date: row.delivery_date,
      shipping_cost: row.shipping_cost,
      status: row.status,
      created_at: row.created_at,
    }));

    res.status(200).json({
      success: true,
      data: {
        data: shipments,
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

    const { data: shipmentWithOwner, error: shipmentOwnerError } = await supabaseAdmin
      .from("supplier_shipments")
      .select("id, purchase_order_id, purchase_orders ( id, seller_id )")
      .eq("id", id)
      .single<{ id: string; purchase_order_id: string | null; purchase_orders?: { id: string; seller_id: string } | null }>();

    if (shipmentOwnerError || !shipmentWithOwner) {
      throw new AppError(`Supplier shipment with id ${id} not found`, 404);
    }

    if (!isAdmin(req)) {
      const callerSellerId = req.userRole?.seller_id;
      if (!callerSellerId) throw new AppError("No seller profile linked to this account", 403);

      if (!shipmentWithOwner.purchase_orders || shipmentWithOwner.purchase_orders.seller_id !== callerSellerId) {
        throw new AppError(`Supplier shipment with id ${id} not found`, 404);
      }
    }

    const details = await fetchShipmentDetails(id);

    res.status(200).json({ success: true, data: details });
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
    const normalizedItems = normalizeItems(body.items);

    const { data: po, error: poError } = await supabaseAdmin
      .from("purchase_orders")
      .select("id, seller_id, supplier_id")
      .eq("id", body.purchase_order_id)
      .single<PurchaseOrderRow>();

    if (poError || !po) {
      throw new AppError(`Purchase order with id ${body.purchase_order_id} not found`, 404);
    }

    if (!isAdmin(req)) {
      const callerSellerId = req.userRole?.seller_id;
      if (!callerSellerId) throw new AppError("No seller profile linked to this account", 403);
      if (po.seller_id !== callerSellerId) {
        throw new AppError("You do not have permission to create shipments for this purchase order", 403);
      }
    }

    const variantIds = normalizedItems.map((item) => item.product_variant_id);

    const { data: poItems, error: poItemsError } = await supabaseAdmin
      .from("purchase_order_items")
      .select("id, purchase_order_id, product_variant_id, quantity, unit_cost, received_quantity")
      .eq("purchase_order_id", po.id)
      .in("product_variant_id", variantIds)
      .returns<PurchaseOrderItemRow[]>();

    if (poItemsError) {
      throw new AppError(`Failed to fetch purchase order items: ${poItemsError.message}`, 500);
    }

    const poItemByVariant = new Map<string, PurchaseOrderItemRow>();
    for (const row of poItems ?? []) poItemByVariant.set(row.product_variant_id, row);

    for (const shipmentItem of normalizedItems) {
      const poItem = poItemByVariant.get(shipmentItem.product_variant_id);
      if (!poItem) {
        throw new AppError(
          `Product variant ${shipmentItem.product_variant_id} is not part of purchase order ${po.id}`,
          400
        );
      }

      const alreadyReceived = poItem.received_quantity ?? 0;
      const remainingAllowed = Math.max(0, poItem.quantity - alreadyReceived);

      if (shipmentItem.quantity > remainingAllowed) {
        throw new AppError(
          `Shipment quantity for variant ${shipmentItem.product_variant_id} cannot exceed remaining purchase order quantity ${remainingAllowed}`,
          400
        );
      }
    }

    const { data: shipment, error: shipmentError } = await supabaseAdmin
      .from("supplier_shipments")
      .insert({
        supplier_id: po.supplier_id,
        purchase_order_id: po.id,
        courier_name: body.courier_name ?? null,
        tracking_number: body.tracking_number ?? null,
        shipment_date: body.shipment_date ?? null,
        delivery_date: body.delivery_date ?? null,
        shipping_cost: body.shipping_cost,
        status: body.status,
      })
      .select(SUPPLIER_SHIPMENT_SELECT)
      .single<SupplierShipmentRecord>();

    if (shipmentError || !shipment) {
      throw new AppError(`Failed to create supplier shipment: ${shipmentError?.message}`, 500);
    }

    shipmentId = shipment.id;

    const shipmentItemsPayload = normalizedItems.map((item) => ({
      shipment_id: shipment.id,
      product_variant_id: item.product_variant_id,
      quantity: item.quantity,
    }));

    const { data: shipmentItems, error: shipmentItemsError } = await supabaseAdmin
      .from("supplier_shipment_items")
      .insert(shipmentItemsPayload)
      .select("id, shipment_id, product_variant_id, quantity")
      .returns<SupplierShipmentItemRecord[]>();

    if (shipmentItemsError || !shipmentItems) {
      throw new AppError(`Failed to create supplier shipment items: ${shipmentItemsError?.message}`, 500);
    }

    const inventoryBatchesPayload = normalizedItems.map((item) => {
      const poItem = poItemByVariant.get(item.product_variant_id)!;
      return {
        product_variant_id: item.product_variant_id,
        supplier_id: po.supplier_id,
        shipment_id: shipment.id,
        quantity: item.quantity,
        remaining_quantity: item.quantity,
        unit_cost: poItem.unit_cost,
        landed_cost: poItem.unit_cost,
      };
    });

    const { data: inventoryBatches, error: inventoryBatchesError } = await supabaseAdmin
      .from("inventory_batches")
      .insert(inventoryBatchesPayload)
      .select("id, product_variant_id, supplier_id, shipment_id, quantity, remaining_quantity, unit_cost, landed_cost, created_at")
      .returns<InventoryBatchRecord[]>();

    if (inventoryBatchesError || !inventoryBatches) {
      throw new AppError(`Failed to create inventory batches: ${inventoryBatchesError?.message}`, 500);
    }

    for (const shipmentItem of normalizedItems) {
      const poItem = poItemByVariant.get(shipmentItem.product_variant_id)!;
      const updatedReceivedQuantity = (poItem.received_quantity ?? 0) + shipmentItem.quantity;

      const { error: receivedQtyUpdateError } = await supabaseAdmin
        .from("purchase_order_items")
        .update({ received_quantity: updatedReceivedQuantity })
        .eq("id", poItem.id);

      if (receivedQtyUpdateError) {
        throw new AppError(
          `Failed to update purchase order item received quantity: ${receivedQtyUpdateError.message}`,
          500
        );
      }
    }

    const totalQuantity = inventoryBatches.reduce((sum, batch) => sum + batch.quantity, 0);
    let allocations: ShipmentCostAllocationRecord[] = [];

    if (body.shipping_cost > 0 && totalQuantity > 0) {
      let allocatedSoFar = 0;
      const allocationsPayload = inventoryBatches.map((batch, index) => {
        const allocatedCost =
          index === inventoryBatches.length - 1
            ? round2(body.shipping_cost - allocatedSoFar)
            : round2((body.shipping_cost * batch.quantity) / totalQuantity);

        if (index !== inventoryBatches.length - 1) allocatedSoFar += allocatedCost;

        const extraPerUnit = allocatedCost / batch.quantity;
        const landedCost = round2((batch.unit_cost ?? 0) + extraPerUnit);

        return {
          inventory_batch_id: batch.id,
          allocated_cost: allocatedCost,
          landed_cost: landedCost,
        };
      });

      for (const entry of allocationsPayload) {
        const { error: landedCostError } = await supabaseAdmin
          .from("inventory_batches")
          .update({ landed_cost: entry.landed_cost })
          .eq("id", entry.inventory_batch_id);

        if (landedCostError) {
          throw new AppError(`Failed to update inventory landed cost: ${landedCostError.message}`, 500);
        }
      }

      const { data: insertedAllocations, error: allocationsError } = await supabaseAdmin
        .from("shipment_cost_allocations")
        .insert(
          allocationsPayload.map((entry) => ({
            shipment_id: shipment.id,
            inventory_batch_id: entry.inventory_batch_id,
            allocated_cost: entry.allocated_cost,
          }))
        )
        .select("id, shipment_id, inventory_batch_id, allocated_cost")
        .returns<ShipmentCostAllocationRecord[]>();

      if (allocationsError) {
        throw new AppError(`Failed to create shipment cost allocations: ${allocationsError.message}`, 500);
      }

      allocations = insertedAllocations ?? [];
    }

    res.status(201).json({
      success: true,
      message: "Supplier shipment created successfully.",
      data: {
        shipment,
        shipment_items: shipmentItems,
        inventory_batches: inventoryBatches,
        total_quantity: totalQuantity,
        shipment_cost_allocations: allocations,
      },
    });
  } catch (err) {
    if (shipmentId) {
      await supabaseAdmin.from("shipment_cost_allocations").delete().eq("shipment_id", shipmentId);
      await supabaseAdmin.from("inventory_batches").delete().eq("shipment_id", shipmentId);
      await supabaseAdmin.from("supplier_shipment_items").delete().eq("shipment_id", shipmentId);
      await supabaseAdmin.from("supplier_shipments").delete().eq("id", shipmentId);
    }

    next(err);
  }
};
