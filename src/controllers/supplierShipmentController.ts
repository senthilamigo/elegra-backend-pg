/**
 * File: src/controllers/supplierShipmentController.ts
 * Path: src/controllers/supplierShipmentController.ts
 *
 * Handler for supplier shipment creation endpoint.
 *
 * Endpoint:
 *   - POST /api/supplier-shipments
 *
 * Access:
 *   - seller and admin roles (enforced at route layer)
 *
 * Create-shipment workflow implemented in this file:
 *   1) Insert supplier_shipments
 *   2) Insert supplier_shipment_items
 *   3) Create inventory_batches (one per product_variant in payload)
 *      - quantity = shipped quantity
 *      - remaining_quantity = shipped quantity
 *      - unit_cost = purchase_order_items.unit_cost
 *   4) Calculate total quantity
 *   5) Distribute shipping_cost into shipment_cost_allocations
 *      and update inventory_batches.landed_cost
 *
 * Note on transactions:
 *   Supabase REST calls do not expose explicit BEGIN/COMMIT from here.
 *   This controller uses a compensating rollback strategy: if any step fails
 *   after creating a shipment row, it deletes inserted dependent rows to keep
 *   data consistent.
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import { ApiResponse } from "../types";
import { SupplierShipment, SupplierShipmentItem, InventoryBatch, ShipmentCostAllocation } from "../types/supplierShipment";
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
};

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

function isAdmin(req: Request): boolean {
  return req.userRole?.role_name === "admin";
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export const createSupplierShipment = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  let shipmentId: string | null = null;

  try {
    const body = createSupplierShipmentSchema.parse(req.body);

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

    const variantIds = body.items.map((item) => item.product_variant_id);

    const { data: poItems, error: poItemsError } = await supabaseAdmin
      .from("purchase_order_items")
      .select("id, purchase_order_id, product_variant_id, quantity, unit_cost")
      .eq("purchase_order_id", po.id)
      .in("product_variant_id", variantIds)
      .returns<PurchaseOrderItemRow[]>();

    if (poItemsError) {
      throw new AppError(`Failed to fetch purchase order items: ${poItemsError.message}`, 500);
    }

    const poItemByVariant = new Map<string, PurchaseOrderItemRow>();
    for (const row of poItems ?? []) {
      poItemByVariant.set(row.product_variant_id, row);
    }

    for (const shipmentItem of body.items) {
      const poItem = poItemByVariant.get(shipmentItem.product_variant_id);
      if (!poItem) {
        throw new AppError(
          `Product variant ${shipmentItem.product_variant_id} is not part of purchase order ${po.id}`,
          400
        );
      }

      if (shipmentItem.quantity > poItem.quantity) {
        throw new AppError(
          `Shipment quantity for variant ${shipmentItem.product_variant_id} cannot exceed purchase order quantity ${poItem.quantity}`,
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
      .single<SupplierShipment>();

    if (shipmentError || !shipment) {
      throw new AppError(`Failed to create supplier shipment: ${shipmentError?.message}`, 500);
    }

    shipmentId = shipment.id;

    const shipmentItemsPayload = body.items.map((item) => ({
      shipment_id: shipment.id,
      product_variant_id: item.product_variant_id,
      quantity: item.quantity,
    }));

    const { data: shipmentItems, error: shipmentItemsError } = await supabaseAdmin
      .from("supplier_shipment_items")
      .insert(shipmentItemsPayload)
      .select("id, shipment_id, product_variant_id, quantity")
      .returns<SupplierShipmentItem[]>();

    if (shipmentItemsError || !shipmentItems) {
      throw new AppError(`Failed to create supplier shipment items: ${shipmentItemsError?.message}`, 500);
    }

    const inventoryBatchesPayload = body.items.map((item) => {
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
      .returns<InventoryBatch[]>();

    if (inventoryBatchesError || !inventoryBatches) {
      throw new AppError(`Failed to create inventory batches: ${inventoryBatchesError?.message}`, 500);
    }

    const totalQuantity = inventoryBatches.reduce((sum, batch) => sum + batch.quantity, 0);

    let allocations: ShipmentCostAllocation[] = [];

    if (body.shipping_cost > 0 && totalQuantity > 0) {
      let allocatedSoFar = 0;
      const allocationsPayload = inventoryBatches.map((batch, index) => {
        let allocatedCost: number;

        if (index === inventoryBatches.length - 1) {
          allocatedCost = round2(body.shipping_cost - allocatedSoFar);
        } else {
          allocatedCost = round2((body.shipping_cost * batch.quantity) / totalQuantity);
          allocatedSoFar += allocatedCost;
        }

        const extraPerUnit = allocatedCost / batch.quantity;
        const landedCost = round2((batch.unit_cost ?? 0) + extraPerUnit);

        return {
          inventory_batch_id: batch.id,
          allocated_cost: allocatedCost,
          landed_cost: landedCost,
        };
      });

      const { error: landedCostError } = await Promise.all(
        allocationsPayload.map((entry) =>
          supabaseAdmin
            .from("inventory_batches")
            .update({ landed_cost: entry.landed_cost })
            .eq("id", entry.inventory_batch_id)
        )
      ).then((results) => {
        const firstError = results.find((result) => result.error)?.error;
        return { error: firstError ?? null };
      });

      if (landedCostError) {
        throw new AppError(`Failed to update inventory landed cost: ${landedCostError.message}`, 500);
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
        .returns<ShipmentCostAllocation[]>();

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
