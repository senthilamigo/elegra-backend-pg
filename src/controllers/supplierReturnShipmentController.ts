/**
 * File: src/controllers/supplierReturnShipmentController.ts
 * Path: src/controllers/supplierReturnShipmentController.ts
 *
 * Handlers for supplier return shipment endpoints.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints implemented in this file:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   POST /api/supplier-return-shipments  — createSupplierReturnShipment
 *     Atomic workflow:
 *       1. Validate supplier_return exists and caller has access
 *       2. Assert no duplicate inventory_batch_id values in items
 *       3. Validate each inventory_batch exists, belongs to the correct
 *          supplier, and has sufficient remaining_quantity
 *       4. INSERT supplier_return_shipments
 *       5. INSERT supplier_return_shipment_items (one per line item)
 *       6. Calculate total quantity across all items
 *       7. Compute proportional shipping cost per item
 *       8. INSERT return_shipment_cost_allocations
 *     Rollback: on any failure after step 4, previously inserted rows are
 *     deleted in reverse FK dependency order (compensating rollback — same
 *     pattern used across supplier* controllers).
 *
 *   GET /api/supplier-return-shipments   — listSupplierReturnShipments
 *     Paginated list of return shipments visible to the caller.
 *     Sellers see only shipments linked to their own supplier_returns.
 *     Admins see all. Supports ?return_id=, ?status=, ?page=, ?limit=.
 *
 *   GET /api/supplier-return-shipments/:id  — getSupplierReturnShipment
 *     Single return shipment enriched with:
 *       - supplier_return context (reason, status, seller_id)
 *       - supplier context (name, status)
 *       - items (supplier_return_shipment_items with batch details)
 *       - cost allocations (return_shipment_cost_allocations)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Access model
 * ─────────────────────────────────────────────────────────────────────────────
 *   Route layer enforces requireAuth + requireRole("seller").
 *   This controller additionally enforces seller-level data scoping:
 *     - Seller users can only access return shipments whose underlying
 *       supplier_returns.seller_id matches their linked seller profile.
 *     - Admin users bypass the seller_id ownership check.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Tables used
 * ─────────────────────────────────────────────────────────────────────────────
 *   supplier_return_shipments          — primary table for all three endpoints
 *   supplier_return_shipment_items     — line items per return shipment
 *   return_shipment_cost_allocations   — proportional shipping cost per batch
 *   supplier_returns                   — ownership/existence validation + context
 *   inventory_batches                  — batch validation (supplier, remaining qty)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Rollback strategy (compensating pattern)
 * ─────────────────────────────────────────────────────────────────────────────
 *   Supabase REST does not support server-side transactions across multiple
 *   table inserts. The controller tracks the shipmentId of any successfully
 *   inserted supplier_return_shipments row. If a later step fails, cleanup
 *   deletes rows in reverse FK dependency order before re-throwing the error.
 *   This is the same approach used in supplierShipmentController.ts and
 *   supplierReplacementController.ts.
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";
import {
  SupplierReturnShipment,
  SupplierReturnShipmentItem,
  ReturnShipmentCostAllocation,
  SupplierReturnShipmentWithContext,
} from "../types/supplierReturnShipment";
import { createSupplierReturnShipmentSchema } from "../validators/supplierReturnShipmentValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** UUID v4 regex — validates :id path params before querying Supabase */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that a string is a valid UUID.
 * Throws a 400 AppError if the format is wrong.
 */
function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
}

/**
 * Parses ?page= and ?limit= query params with safe defaults and caps.
 * Defaults: page=1, limit=20. Cap: limit ≤ 100.
 */
function parsePage(query: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(query.page  ?? "1"),  10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20)
  );
  return {
    page,
    limit,
    from: (page - 1) * limit,
    to:   (page - 1) * limit + limit - 1,
  };
}

/** Returns true when the authenticated user has the admin role */
function isAdmin(req: Request): boolean {
  return req.userRole?.role_name === "admin";
}

/**
 * Reads seller_id from req.userRole.
 * Throws 403 if the user has no linked seller profile.
 * Used for non-admin callers only.
 */
function mustGetSellerId(req: Request): string {
  const sellerId = req.userRole?.seller_id;
  if (!sellerId) {
    throw new AppError("No seller profile linked to this account", 403);
  }
  return sellerId;
}

/**
 * Rounds a number to 2 decimal places.
 * Used for shipping cost allocation to avoid floating-point drift.
 * Consistent with the helper used in costsController.ts and
 * supplierReplacementController.ts.
 */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Columns selected for supplier_return_shipments rows.
 * Joins supplier_returns and suppliers for ownership checks and display context.
 */
const RETURN_SHIPMENT_SELECT = `
  id,
  return_id,
  supplier_id,
  courier_name,
  tracking_number,
  shipment_date,
  delivery_date,
  shipping_cost,
  status,
  created_at,
  supplier_returns (
    id,
    supplier_id,
    seller_id,
    reason,
    status
  ),
  suppliers (
    id,
    name,
    status
  )
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — assertReturnAccess
//
// Fetches a supplier_returns row and verifies the caller has permission to
// work with it. Sellers may only access their own returns; admins bypass.
//
// Returns the supplier_returns row so callers can reuse supplier_id and
// seller_id without a second query.
//
// Throws 404 if the return does not exist.
// Throws 404 (not 403) for non-admin sellers whose seller_id does not
// match — avoids leaking whether the return exists for another seller.
// ─────────────────────────────────────────────────────────────────────────────
async function assertReturnAccess(
  returnId: string,
  req:      Request
): Promise<{
  id:          string;
  supplier_id: string;
  seller_id:   string;
  status:      string | null;
}> {
  const { data, error } = await supabaseAdmin
    .from("supplier_returns")
    .select("id, supplier_id, seller_id, status")
    .eq("id", returnId)
    .single<{ id: string; supplier_id: string; seller_id: string; status: string | null }>();

  if (error || !data) {
    throw new AppError(`Supplier return with id ${returnId} not found`, 404);
  }

  if (!isAdmin(req)) {
    const sellerId = mustGetSellerId(req);
    if (data.seller_id !== sellerId) {
      // Return 404 to avoid leaking whether the return exists for another seller
      throw new AppError(`Supplier return with id ${returnId} not found`, 404);
    }
  }

  return data;
}

/**
 * Asserts no duplicate inventory_batch_id values within the items array.
 * Duplicates would create ambiguous cost allocations.
 * Consistent with the check in supplierReturnController.ts and
 * supplierReplacementController.ts.
 */
function assertNoDuplicateBatchIds(
  items: Array<{ inventory_batch_id: string }>
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.inventory_batch_id)) {
      throw new AppError(
        `Duplicate inventory_batch_id found: ${item.inventory_batch_id}`,
        400
      );
    }
    seen.add(item.inventory_batch_id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/supplier-return-shipments   — seller+
//
// Transactional creation flow:
//   1. Validate the supplier_return exists and caller has access
//   2. Assert no duplicate inventory_batch_id values in the items array
//   3. Fetch and validate each inventory_batch:
//      (a) exists,
//      (b) belongs to the same supplier as the supplier_return,
//      (c) has sufficient remaining_quantity
//   4. INSERT supplier_return_shipments
//   5. INSERT supplier_return_shipment_items (one per item)
//   6. Calculate total quantity
//   7. Compute proportional shipping cost allocation per item
//   8. INSERT return_shipment_cost_allocations
//
// On any failure after step 4, the controller cleans up in reverse
// FK dependency order before re-throwing the error.
// ─────────────────────────────────────────────────────────────────────────────
export const createSupplierReturnShipment = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  // Track the shipment_id so we can roll back on failure
  let shipmentId: string | null = null;

  try {
    const body = createSupplierReturnShipmentSchema.parse(req.body);

    // ── Step 1: Validate supplier_return exists and caller has access ─────────
    const supplierReturn = await assertReturnAccess(body.return_id, req);

    // ── Step 2: Assert no duplicate batch IDs ─────────────────────────────────
    assertNoDuplicateBatchIds(body.items);

    // ── Step 3: Validate each inventory batch ─────────────────────────────────
    const batchIds = body.items.map((item) => item.inventory_batch_id);

    const { data: batches, error: batchError } = await supabaseAdmin
      .from("inventory_batches")
      .select("id, supplier_id, remaining_quantity")
      .in("id", batchIds)
      .returns<Array<{
        id:                 string;
        supplier_id:        string | null;
        remaining_quantity: number;
      }>>();

    if (batchError) {
      throw new AppError(
        `Failed to validate inventory batches: ${batchError.message}`,
        500
      );
    }

    // Ensure every requested batch was found
    const foundBatchIds = new Set((batches ?? []).map((b) => b.id));
    for (const batchId of batchIds) {
      if (!foundBatchIds.has(batchId)) {
        throw new AppError(`Inventory batch with id ${batchId} not found`, 404);
      }
    }

    // Build a lookup map for subsequent validations
    const batchById = new Map(
      (batches ?? []).map((b) => [b.id, b])
    );

    // Validate supplier ownership and sufficient stock for each item
    for (const item of body.items) {
      const batch = batchById.get(item.inventory_batch_id)!;

      // Each batch must be linked to the same supplier as the return
      if (!batch.supplier_id) {
        throw new AppError(
          `Inventory batch ${item.inventory_batch_id} is not linked to a supplier`,
          400
        );
      }

      if (batch.supplier_id !== supplierReturn.supplier_id) {
        throw new AppError(
          `Inventory batch ${item.inventory_batch_id} belongs to a different supplier ` +
          `than the one referenced by supplier return ${body.return_id}`,
          400
        );
      }

      // Prevent returning more units than are currently in stock
      if (batch.remaining_quantity < item.quantity) {
        throw new AppError(
          `Insufficient inventory in batch ${item.inventory_batch_id}. ` +
          `Available: ${batch.remaining_quantity}, requested: ${item.quantity}`,
          400
        );
      }
    }

    // ── Step 4: INSERT supplier_return_shipments ──────────────────────────────
    const { data: returnShipment, error: shipmentError } = await supabaseAdmin
      .from("supplier_return_shipments")
      .insert({
        return_id:       body.return_id,
        supplier_id:     supplierReturn.supplier_id,
        courier_name:    body.courier_name    ?? null,
        tracking_number: body.tracking_number ?? null,
        shipment_date:   body.shipment_date   ?? null,
        delivery_date:   body.delivery_date   ?? null,
        shipping_cost:   body.shipping_cost,
        status:          body.status,
      })
      .select(RETURN_SHIPMENT_SELECT)
      .single<SupplierReturnShipmentWithContext>();

    if (shipmentError || !returnShipment) {
      throw new AppError(
        `Failed to create return shipment: ${shipmentError?.message}`,
        500
      );
    }

    // Record the shipment id for compensating rollback if later steps fail
    shipmentId = returnShipment.id;

    // ── Step 5: INSERT supplier_return_shipment_items ─────────────────────────
    const itemsPayload = body.items.map((item) => ({
      shipment_id:        returnShipment.id,
      inventory_batch_id: item.inventory_batch_id,
      quantity:           item.quantity,
    }));

    const { data: insertedItems, error: itemsError } = await supabaseAdmin
      .from("supplier_return_shipment_items")
      .insert(itemsPayload)
      .select("id, shipment_id, inventory_batch_id, quantity")
      .returns<SupplierReturnShipmentItem[]>();

    if (itemsError || !insertedItems) {
      throw new AppError(
        `Failed to create return shipment items: ${itemsError?.message}`,
        500
      );
    }

    // ── Step 6: Calculate total quantity ─────────────────────────────────────
    const totalQuantity = insertedItems.reduce(
      (sum, item) => sum + item.quantity,
      0
    );

    // ── Steps 7 & 8: Compute and INSERT cost allocations ─────────────────────
    // Only allocate when there is a non-zero shipping cost and at least one unit.
    // When cost is 0, insert zero-value allocation rows so the data model
    // is complete and downstream cost queries work without special-casing.
    const shippingCost = body.shipping_cost;
    let costAllocations: ReturnShipmentCostAllocation[] = [];

    if (totalQuantity > 0) {
      let allocatedSoFar = 0;

      // Distribute shipping_cost proportionally across line items by quantity.
      // The last item absorbs any rounding remainder to ensure allocations
      // sum exactly to the total shipping_cost (same last-item correction
      // strategy used in supplierShipmentController.ts and costsController.ts).
      const allocationsPayload = insertedItems.map((item, index) => {
        let allocatedCost: number;

        if (shippingCost === 0 || totalQuantity === 0) {
          // No cost to distribute — record zero allocations
          allocatedCost = 0;
        } else if (index === insertedItems.length - 1) {
          // Last item: absorb remaining amount to avoid rounding drift
          allocatedCost = round2(shippingCost - allocatedSoFar);
        } else {
          allocatedCost = round2(
            (shippingCost * item.quantity) / totalQuantity
          );
          allocatedSoFar += allocatedCost;
        }

        return {
          shipment_id:        returnShipment.id,
          inventory_batch_id: item.inventory_batch_id,
          allocated_cost:     allocatedCost,
        };
      });

      const { data: insertedAllocations, error: allocationsError } =
        await supabaseAdmin
          .from("return_shipment_cost_allocations")
          .insert(allocationsPayload)
          .select("id, shipment_id, inventory_batch_id, allocated_cost")
          .returns<ReturnShipmentCostAllocation[]>();

      if (allocationsError) {
        throw new AppError(
          `Failed to create return shipment cost allocations: ${allocationsError.message}`,
          500
        );
      }

      costAllocations = insertedAllocations ?? [];
    }

    // ── Success response ──────────────────────────────────────────────────────
    res.status(201).json({
      success: true,
      message: "Supplier return shipment created successfully.",
      data: {
        return_shipment:    returnShipment,
        items:              insertedItems,
        cost_allocations:   costAllocations,
        total_quantity:     totalQuantity,
        total_shipping_cost: shippingCost,
      },
    });
  } catch (err) {
    // ── Compensating rollback ─────────────────────────────────────────────────
    // If the supplier_return_shipments row was inserted but a later step failed,
    // clean up all dependent rows in reverse FK dependency order before
    // propagating the error. This mirrors the pattern in
    // supplierReplacementController.ts and supplierShipmentController.ts.
    if (shipmentId) {
      // Order matters: delete dependants before the parent row
      await supabaseAdmin
        .from("return_shipment_cost_allocations")
        .delete()
        .eq("shipment_id", shipmentId);

      await supabaseAdmin
        .from("supplier_return_shipment_items")
        .delete()
        .eq("shipment_id", shipmentId);

      await supabaseAdmin
        .from("supplier_return_shipments")
        .delete()
        .eq("id", shipmentId);
    }

    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/supplier-return-shipments   — seller+
//
// Paginated list of supplier return shipments.
// Sellers see only return shipments linked to their own supplier_returns.
// Admins see all shipments and can optionally filter by ?seller_id=.
//
// Query params:
//   ?return_id=<uuid>   — filter to a specific supplier_return
//   ?status=<value>     — filter by supplier_return_shipments.status
//   ?seller_id=<uuid>   — admin only: filter by seller
//   ?page=<n>           — page number (default 1)
//   ?limit=<n>          — items per page (default 20, max 100)
//
// Note: seller scoping is achieved by joining through supplier_returns and
// filtering on supplier_returns.seller_id, consistent with the pattern
// used in supplierReplacementController.ts.
// ─────────────────────────────────────────────────────────────────────────────
export const listSupplierReturnShipments = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(
      req.query as Record<string, unknown>
    );

    // ── Validate optional query params ────────────────────────────────────────
    const returnIdParam  = req.query.return_id  as string | undefined;
    const statusParam    = req.query.status     as string | undefined;
    const sellerIdParam  = req.query.seller_id  as string | undefined; // admin only

    if (returnIdParam)  validateUuid(returnIdParam,  "return_id");
    if (sellerIdParam)  validateUuid(sellerIdParam,  "seller_id");

    if (statusParam &&
        !["in_transit", "delivered"].includes(statusParam)) {
      throw new AppError(
        "status must be 'in_transit' or 'delivered'",
        400
      );
    }

    // ── Build base query ──────────────────────────────────────────────────────
    let query = supabaseAdmin
      .from("supplier_return_shipments")
      .select(RETURN_SHIPMENT_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    // ── Apply optional filters ────────────────────────────────────────────────
    if (returnIdParam) {
      query = query.eq("return_id", returnIdParam);
    }

    if (statusParam) {
      query = query.eq("status", statusParam);
    }

    // ── Seller scoping ────────────────────────────────────────────────────────
    // Non-admin sellers see only return shipments tied to their own returns.
    // Filtering via the joined supplier_returns.seller_id column is consistent
    // with the approach used in supplierReplacementController.ts.
    if (!isAdmin(req)) {
      const sellerId = mustGetSellerId(req);
      query = query.eq("supplier_returns.seller_id", sellerId);
    } else if (sellerIdParam) {
      // Admins may optionally narrow results to a specific seller
      query = query.eq("supplier_returns.seller_id", sellerIdParam);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new AppError(
        `Failed to fetch supplier return shipments: ${error.message}`,
        500
      );
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
// GET /api/supplier-return-shipments/:id   — seller+
//
// Returns a single return shipment enriched with:
//   - supplier_returns context (reason, status, seller_id)
//   - suppliers context (name, status)
//   - items (supplier_return_shipment_items with inventory_batch details)
//   - cost allocations (return_shipment_cost_allocations)
//
// Access: sellers can only view return shipments for their own returns.
// ─────────────────────────────────────────────────────────────────────────────
export const getSupplierReturnShipment = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "supplier return shipment id");

    // ── Fetch the shipment with join context ──────────────────────────────────
    const { data: shipment, error: shipmentError } = await supabaseAdmin
      .from("supplier_return_shipments")
      .select(RETURN_SHIPMENT_SELECT)
      .eq("id", id)
      .single<SupplierReturnShipmentWithContext>();

    if (shipmentError || !shipment) {
      throw new AppError(`Supplier return shipment with id ${id} not found`, 404);
    }

    // ── Seller ownership check ────────────────────────────────────────────────
    // Verify the underlying supplier_return belongs to the calling seller.
    // Returns 404 (not 403) to avoid leaking resource existence for other sellers.
    if (!isAdmin(req)) {
      const sellerId = mustGetSellerId(req);
      const returnSellerIdFromJoin =
        (Array.isArray(shipment.supplier_returns)
          ? (shipment.supplier_returns as any[])[0]
          : shipment.supplier_returns
        )?.seller_id ?? null;

      if (returnSellerIdFromJoin !== sellerId) {
        throw new AppError(
          `Supplier return shipment with id ${id} not found`,
          404
        );
      }
    }

    // ── Fetch line items with inventory batch context ─────────────────────────
    const { data: items, error: itemsError } = await supabaseAdmin
      .from("supplier_return_shipment_items")
      .select(`
        id,
        shipment_id,
        inventory_batch_id,
        quantity,
        inventory_batches (
          id,
          product_variant_id,
          supplier_id,
          shipment_id,
          quantity,
          remaining_quantity,
          unit_cost,
          landed_cost,
          created_at,
          product_variants (
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
      .eq("shipment_id", id)
      .order("id", { ascending: true });

    if (itemsError) {
      throw new AppError(
        `Failed to fetch return shipment items: ${itemsError.message}`,
        500
      );
    }

    // ── Fetch cost allocations ────────────────────────────────────────────────
    const { data: costAllocations, error: allocationsError } = await supabaseAdmin
      .from("return_shipment_cost_allocations")
      .select("id, shipment_id, inventory_batch_id, allocated_cost")
      .eq("shipment_id", id)
      .order("id", { ascending: true })
      .returns<ReturnShipmentCostAllocation[]>();

    if (allocationsError) {
      throw new AppError(
        `Failed to fetch return shipment cost allocations: ${allocationsError.message}`,
        500
      );
    }

    // ── Compute total allocated shipping cost for convenience ─────────────────
    const totalAllocatedCost = round2(
      (costAllocations ?? []).reduce(
        (sum, row) => sum + (row.allocated_cost ?? 0),
        0
      )
    );

    res.status(200).json({
      success: true,
      data: {
        ...shipment,
        items:                items ?? [],
        cost_allocations:     costAllocations ?? [],
        total_allocated_cost: totalAllocatedCost,
      },
    });
  } catch (err) {
    next(err);
  }
};
