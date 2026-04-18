/**
 * File: src/controllers/costsController.ts
 * Path: src/controllers/costsController.ts
 *
 * Cost allocation handlers for inbound and return shipments.
 *
 * Endpoints implemented in this file:
 *   - GET /api/costs/inbound/:shipmentId
 *       Recomputes and persists shipping-cost allocation for a supplier inbound
 *       shipment. Allocation is proportional to each shipment item's quantity,
 *       writes rows into shipment_cost_allocations, and updates
 *       inventory_batches.landed_cost.
 *
 *   - GET /api/costs/return/:shipmentId
 *       Recomputes and persists shipping-cost allocation for a supplier return
 *       shipment. Allocation is proportional to each return shipment item's
 *       quantity and writes rows into return_shipment_cost_allocations.
 *       This flow intentionally does not update inventory_batches.landed_cost.
 *
 * Access model:
 *   - Route layer enforces requireAuth + requireRole("seller")
 *   - Controller enforces seller-level ownership:
 *       inbound shipment  -> purchase_orders.seller_id
 *       return shipment   -> supplier_returns.seller_id
 *     Admin can access all shipments.
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { ApiResponse } from "../types";
import { AppError } from "../middleware/errorHandler";

type InboundShipmentRow = {
  id: string;
  purchase_order_id: string | null;
  shipping_cost: number | null;
  purchase_orders: {
    seller_id: string;
  } | null;
};

type InboundShipmentItemRow = {
  id: string;
  shipment_id: string;
  product_variant_id: string;
  quantity: number;
};

type InventoryBatchRow = {
  id: string;
  shipment_id: string | null;
  product_variant_id: string;
  quantity: number;
  unit_cost: number | null;
  landed_cost: number | null;
};

type ReturnShipmentRow = {
  id: string;
  return_id: string;
  shipping_cost: number | null;
  supplier_returns: {
    seller_id: string;
  } | null;
};

type ReturnShipmentItemRow = {
  id: string;
  shipment_id: string;
  inventory_batch_id: string;
  quantity: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAdmin(req: Request): boolean {
  return req.userRole?.role_name === "admin";
}

function mustGetSellerId(req: Request): string {
  const sellerId = req.userRole?.seller_id;
  if (!sellerId) {
    throw new AppError("No seller profile linked to this account", 403);
  }
  return sellerId;
}

function validateShipmentId(shipmentId: string): void {
  if (!UUID_RE.test(shipmentId)) {
    throw new AppError("Invalid shipmentId — must be a valid UUID", 400);
  }
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export const getInboundShipmentCostAllocation = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const shipmentId = req.params.shipmentId;
    validateShipmentId(shipmentId);

    const { data: shipment, error: shipmentError } = await supabaseAdmin
      .from("supplier_shipments")
      .select("id, purchase_order_id, shipping_cost, purchase_orders(seller_id)")
      .eq("id", shipmentId)
      .single<InboundShipmentRow>();

    if (shipmentError || !shipment) {
      throw new AppError(`Supplier shipment with id ${shipmentId} not found`, 404);
    }

    if (!isAdmin(req)) {
      const sellerId = mustGetSellerId(req);
      if (shipment.purchase_orders?.seller_id !== sellerId) {
        throw new AppError("You do not have permission to access this shipment", 403);
      }
    }

    const { data: shipmentItems, error: itemsError } = await supabaseAdmin
      .from("supplier_shipment_items")
      .select("id, shipment_id, product_variant_id, quantity")
      .eq("shipment_id", shipmentId)
      .returns<InboundShipmentItemRow[]>();

    if (itemsError) {
      throw new AppError(`Failed to fetch shipment items: ${itemsError.message}`, 500);
    }

    if (!shipmentItems || shipmentItems.length === 0) {
      throw new AppError("No shipment items found for this shipment", 400);
    }

    const variantIds = shipmentItems.map((item) => item.product_variant_id);

    const { data: batches, error: batchesError } = await supabaseAdmin
      .from("inventory_batches")
      .select("id, shipment_id, product_variant_id, quantity, unit_cost, landed_cost")
      .eq("shipment_id", shipmentId)
      .in("product_variant_id", variantIds)
      .returns<InventoryBatchRow[]>();

    if (batchesError) {
      throw new AppError(`Failed to fetch inventory batches: ${batchesError.message}`, 500);
    }

    const batchByVariant = new Map<string, InventoryBatchRow>();
    for (const batch of batches ?? []) {
      if (!batchByVariant.has(batch.product_variant_id)) {
        batchByVariant.set(batch.product_variant_id, batch);
      }
    }

    for (const item of shipmentItems) {
      if (!batchByVariant.has(item.product_variant_id)) {
        throw new AppError(
          `No inventory batch found for product_variant_id ${item.product_variant_id} in shipment ${shipmentId}`,
          400
        );
      }
    }

    const totalQuantity = shipmentItems.reduce((sum, item) => sum + item.quantity, 0);
    const shippingCost = Number(shipment.shipping_cost ?? 0);

    await supabaseAdmin.from("shipment_cost_allocations").delete().eq("shipment_id", shipmentId);

    let allocatedSoFar = 0;
    const allocationsPayload = shipmentItems.map((item, index) => {
      const batch = batchByVariant.get(item.product_variant_id)!;

      let allocatedCost = 0;
      if (shippingCost > 0 && totalQuantity > 0) {
        if (index === shipmentItems.length - 1) {
          allocatedCost = round2(shippingCost - allocatedSoFar);
        } else {
          allocatedCost = round2((shippingCost * item.quantity) / totalQuantity);
          allocatedSoFar += allocatedCost;
        }
      }

      const extraPerUnit = item.quantity > 0 ? allocatedCost / item.quantity : 0;
      const landedCost = round2((batch.unit_cost ?? 0) + extraPerUnit);

      return {
        shipment_id: shipmentId,
        inventory_batch_id: batch.id,
        allocated_cost: allocatedCost,
        landed_cost: landedCost,
      };
    });

    const landedCostUpdates = allocationsPayload.map((entry) =>
      supabaseAdmin
        .from("inventory_batches")
        .update({ landed_cost: entry.landed_cost })
        .eq("id", entry.inventory_batch_id)
    );

    const landedCostResults = await Promise.all(landedCostUpdates);
    const landedCostError = landedCostResults.find((result) => result.error)?.error;
    if (landedCostError) {
      throw new AppError(`Failed to update inventory batch landed cost: ${landedCostError.message}`, 500);
    }

    const { data: insertedAllocations, error: allocationsError } = await supabaseAdmin
      .from("shipment_cost_allocations")
      .insert(
        allocationsPayload.map((entry) => ({
          shipment_id: entry.shipment_id,
          inventory_batch_id: entry.inventory_batch_id,
          allocated_cost: entry.allocated_cost,
        }))
      )
      .select("id, shipment_id, inventory_batch_id, allocated_cost");

    if (allocationsError) {
      throw new AppError(`Failed to create shipment cost allocations: ${allocationsError.message}`, 500);
    }

    res.status(200).json({
      success: true,
      message: "Inbound shipment cost allocation computed successfully.",
      data: {
        shipment_id: shipmentId,
        shipping_cost: shippingCost,
        total_quantity: totalQuantity,
        shipment_cost_allocations: insertedAllocations ?? [],
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getReturnShipmentCostAllocation = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const shipmentId = req.params.shipmentId;
    validateShipmentId(shipmentId);

    const { data: shipment, error: shipmentError } = await supabaseAdmin
      .from("supplier_return_shipments")
      .select("id, return_id, shipping_cost, supplier_returns(seller_id)")
      .eq("id", shipmentId)
      .single<ReturnShipmentRow>();

    if (shipmentError || !shipment) {
      throw new AppError(`Supplier return shipment with id ${shipmentId} not found`, 404);
    }

    if (!isAdmin(req)) {
      const sellerId = mustGetSellerId(req);
      if (shipment.supplier_returns?.seller_id !== sellerId) {
        throw new AppError("You do not have permission to access this return shipment", 403);
      }
    }

    const { data: shipmentItems, error: itemsError } = await supabaseAdmin
      .from("supplier_return_shipment_items")
      .select("id, shipment_id, inventory_batch_id, quantity")
      .eq("shipment_id", shipmentId)
      .returns<ReturnShipmentItemRow[]>();

    if (itemsError) {
      throw new AppError(`Failed to fetch return shipment items: ${itemsError.message}`, 500);
    }

    if (!shipmentItems || shipmentItems.length === 0) {
      throw new AppError("No return shipment items found for this shipment", 400);
    }

    const totalQuantity = shipmentItems.reduce((sum, item) => sum + item.quantity, 0);
    const shippingCost = Number(shipment.shipping_cost ?? 0);

    await supabaseAdmin.from("return_shipment_cost_allocations").delete().eq("shipment_id", shipmentId);

    let allocatedSoFar = 0;
    const allocationsPayload = shipmentItems.map((item, index) => {
      let allocatedCost = 0;
      if (shippingCost > 0 && totalQuantity > 0) {
        if (index === shipmentItems.length - 1) {
          allocatedCost = round2(shippingCost - allocatedSoFar);
        } else {
          allocatedCost = round2((shippingCost * item.quantity) / totalQuantity);
          allocatedSoFar += allocatedCost;
        }
      }

      return {
        shipment_id: shipmentId,
        inventory_batch_id: item.inventory_batch_id,
        allocated_cost: allocatedCost,
      };
    });

    const { data: insertedAllocations, error: allocationsError } = await supabaseAdmin
      .from("return_shipment_cost_allocations")
      .insert(allocationsPayload)
      .select("id, shipment_id, inventory_batch_id, allocated_cost");

    if (allocationsError) {
      throw new AppError(`Failed to create return shipment cost allocations: ${allocationsError.message}`, 500);
    }

    res.status(200).json({
      success: true,
      message: "Return shipment cost allocation computed successfully.",
      data: {
        shipment_id: shipmentId,
        shipping_cost: shippingCost,
        total_quantity: totalQuantity,
        return_shipment_cost_allocations: insertedAllocations ?? [],
      },
    });
  } catch (err) {
    next(err);
  }
};
