/**
 * File: src/controllers/supplierReplacementController.ts
 * Path: src/controllers/supplierReplacementController.ts
 *
 * Handlers for supplier replacement endpoints.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints implemented:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   POST /api/supplier-replacements  (Record Replacement)
 *     Full atomic workflow when a `shipment` sub-object is present in the body:
 *       1. Validate the linked supplier_returns record exists and caller has access
 *       2. Validate each inventory_batch_id belongs to the correct return
 *       3. INSERT supplier_return_shipments
 *       4. INSERT supplier_return_shipment_items (one per line item)
 *       5. Compute quantity-proportional shipping cost allocation
 *       6. INSERT return_shipment_cost_allocations
 *       7. INSERT supplier_replacements linking return ↔ shipment
 *     Rollback: if any step after (3) fails, previously inserted rows are
 *     deleted to keep data consistent (compensating rollback pattern — same
 *     approach used throughout the supplier shipment controller).
 *
 *   POST /api/supplier-replacements  (Create replacement record only)
 *     Lightweight path when the body does NOT contain a `shipment` object:
 *       1. Validate the linked supplier_returns record exists and caller has access
 *       2. Optionally validate a pre-existing shipment_id if supplied
 *       3. INSERT supplier_replacements only
 *     No rollback needed — single insert.
 *
 *   GET /api/supplier-replacements
 *     Paginated list of supplier_replacements with joined context:
 *       - supplier_returns (supplier_id, seller_id, reason, status)
 *       - supplier_return_shipments (shipment metadata)
 *     Sellers see only replacements for their own returns.
 *     Admins see all. Optional ?return_id= and ?status= filters.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Access model
 * ─────────────────────────────────────────────────────────────────────────────
 *   Route layer enforces requireAuth + requireRole("seller").
 *   This controller additionally enforces seller-level data scoping:
 *     - Seller users can only access replacements whose underlying
 *       supplier_returns.seller_id matches their linked seller profile.
 *     - Admin users bypass the seller_id ownership check.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Tables used
 * ─────────────────────────────────────────────────────────────────────────────
 *   supplier_replacements             — primary output of POST (both variants)
 *   supplier_return_shipments         — created by the "Record Replacement" path
 *   supplier_return_shipment_items    — line items for the return shipment
 *   return_shipment_cost_allocations  — shipping cost distribution
 *   supplier_returns                  — ownership/existence validation
 *   inventory_batches                 — batch validation
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";
import {
  SupplierReplacement,
  SupplierReturnShipment,
  SupplierReturnShipmentItem,
  ReturnShipmentCostAllocation,
} from "../types/supplierReplacement";
import {
  recordReplacementShipmentSchema,
  createSupplierReplacementSchema,
} from "../validators/supplierReplacementValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** UUID v4 regex used to validate path/query params before querying Supabase */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
}

/**
 * Parses ?page= and ?limit= query params with safe defaults and caps.
 * Returns page/limit values plus the Supabase range offsets.
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
 * Rounds a number to 2 decimal places using the same helper pattern
 * used across the supplier shipment and costs controllers.
 */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Columns selected for the supplier_replacements list/get queries.
 * Joins supplier_returns for ownership checks and display context,
 * and supplier_return_shipments for shipment metadata.
 */
const REPLACEMENT_SELECT = `
  id,
  return_id,
  shipment_id,
  status,
  created_at,
  supplier_returns (
    id,
    supplier_id,
    seller_id,
    reason,
    status
  ),
  supplier_return_shipments (
    id,
    supplier_id,
    courier_name,
    tracking_number,
    shipment_date,
    delivery_date,
    shipping_cost,
    status,
    created_at
  )
`.trim();

/**
 * Columns selected for a supplier_return_shipments row after insertion.
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
  created_at
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — assertReturnAccess
//
// Fetches a supplier_returns row and verifies the caller has permission to
// access it. Sellers may only work with their own returns; admins bypass.
//
// Returns the supplier_returns row so callers can reuse the supplier_id.
// Throws 404 if the return does not exist.
// Throws 403 if the caller is a non-admin seller whose seller_id does not
// match supplier_returns.seller_id.
// ─────────────────────────────────────────────────────────────────────────────
async function assertReturnAccess(
  returnId: string,
  req:      Request
): Promise<{ id: string; supplier_id: string; seller_id: string; status: string | null }> {
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
 * Asserts no duplicate inventory_batch_id values exist within a single
 * request body. Duplicates would create ambiguous cost allocations.
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
// POST /api/supplier-replacements  (Record Replacement)
//
// Full workflow when body includes a `shipment` sub-object:
//   1. Validate supplier_return exists and caller has access
//   2. Assert no duplicate batch IDs in the item list
//   3. Validate each inventory_batch_id references a batch that belongs to
//      the supplier_return's supplier (via supplier_returns.supplier_id)
//   4. INSERT supplier_return_shipments
//   5. INSERT supplier_return_shipment_items
//   6. Compute quantity-proportional shipping cost per item
//   7. INSERT return_shipment_cost_allocations
//   8. INSERT supplier_replacements linking return ↔ new shipment
//
// Rollback strategy (compensating):
//   Tracks inserted IDs in order. On any failure after step 4, deletes in
//   reverse dependency order before re-throwing the error.
// ─────────────────────────────────────────────────────────────────────────────
export const recordReplacementShipment = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  // Track the shipment_id so we can roll back on failure
  let returnShipmentId: string | null = null;

  try {
    const body = recordReplacementShipmentSchema.parse(req.body);

    // ── 1. Validate supplier_return exists and caller has access ─────────────
    const supplierReturn = await assertReturnAccess(body.return_id, req);

    // ── 2. Assert no duplicate batch IDs ─────────────────────────────────────
    assertNoDuplicateBatchIds(body.shipment.items);

    // ── 3. Validate each inventory_batch belongs to the same supplier ─────────
    //    We verify that all referenced batches are linked to the same supplier
    //    as the return to prevent cross-supplier cost allocations.
    const batchIds = body.shipment.items.map((item) => item.inventory_batch_id);

    const { data: batches, error: batchError } = await supabaseAdmin
      .from("inventory_batches")
      .select("id, supplier_id")
      .in("id", batchIds)
      .returns<Array<{ id: string; supplier_id: string | null }>>();

    if (batchError) {
      throw new AppError(
        `Failed to validate inventory batches: ${batchError.message}`,
        500
      );
    }

    // Ensure all requested batch IDs were found
    const foundBatchIds = new Set((batches ?? []).map((b) => b.id));
    for (const batchId of batchIds) {
      if (!foundBatchIds.has(batchId)) {
        throw new AppError(`Inventory batch with id ${batchId} not found`, 404);
      }
    }

    // Build a lookup map for supplier validation
    const batchById = new Map(
      (batches ?? []).map((b) => [b.id, b])
    );

    for (const item of body.shipment.items) {
      const batch = batchById.get(item.inventory_batch_id)!;
      if (batch.supplier_id !== supplierReturn.supplier_id) {
        throw new AppError(
          `Inventory batch ${item.inventory_batch_id} does not belong to the ` +
          `supplier linked to return ${body.return_id}`,
          400
        );
      }
    }

    // ── 4. INSERT supplier_return_shipments ───────────────────────────────────
    const { data: returnShipment, error: returnShipmentError } =
      await supabaseAdmin
        .from("supplier_return_shipments")
        .insert({
          return_id:       body.return_id,
          supplier_id:     supplierReturn.supplier_id,
          courier_name:    body.shipment.courier_name    ?? null,
          tracking_number: body.shipment.tracking_number ?? null,
          shipment_date:   body.shipment.shipment_date   ?? null,
          delivery_date:   body.shipment.delivery_date   ?? null,
          shipping_cost:   body.shipment.shipping_cost,
          status:          body.shipment.status,
        })
        .select(RETURN_SHIPMENT_SELECT)
        .single<SupplierReturnShipment>();

    if (returnShipmentError || !returnShipment) {
      throw new AppError(
        `Failed to create return shipment: ${returnShipmentError?.message}`,
        500
      );
    }

    // Record ID for compensating rollback
    returnShipmentId = returnShipment.id;

    // ── 5. INSERT supplier_return_shipment_items ──────────────────────────────
    const shipmentItemsPayload = body.shipment.items.map((item) => ({
      shipment_id:        returnShipment.id,
      inventory_batch_id: item.inventory_batch_id,
      quantity:           item.quantity,
    }));

    const { data: shipmentItems, error: shipmentItemsError } = await supabaseAdmin
      .from("supplier_return_shipment_items")
      .insert(shipmentItemsPayload)
      .select("id, shipment_id, inventory_batch_id, quantity")
      .returns<SupplierReturnShipmentItem[]>();

    if (shipmentItemsError || !shipmentItems) {
      throw new AppError(
        `Failed to create return shipment items: ${shipmentItemsError?.message}`,
        500
      );
    }

    // ── 6. Compute quantity-proportional shipping cost allocation ─────────────
    //    Uses the same last-item correction strategy used in the supplier
    //    shipment controller to ensure allocated costs sum exactly to the
    //    total shipping_cost without floating-point rounding drift.
    const totalQuantity = shipmentItems.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
    const shippingCost  = body.shipment.shipping_cost;

    let costAllocations: ReturnShipmentCostAllocation[] = [];

    if (shippingCost > 0 && totalQuantity > 0) {
      let allocatedSoFar = 0;

      const allocationsPayload = shipmentItems.map((item, index) => {
        let allocatedCost: number;

        if (index === shipmentItems.length - 1) {
          // Last item absorbs any rounding remainder
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

      // ── 7. INSERT return_shipment_cost_allocations ────────────────────────
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

    // ── 8. INSERT supplier_replacements ──────────────────────────────────────
    //    Status defaults to 'in_transit' when recording a shipment unless the
    //    caller explicitly supplies a different initial status.
    const replacementStatus = body.status ?? "in_transit";

    const { data: replacement, error: replacementError } = await supabaseAdmin
      .from("supplier_replacements")
      .insert({
        return_id:   body.return_id,
        shipment_id: returnShipment.id,
        status:      replacementStatus,
      })
      .select(REPLACEMENT_SELECT)
      .single<SupplierReplacement>();

    if (replacementError || !replacement) {
      throw new AppError(
        `Failed to create supplier replacement: ${replacementError?.message}`,
        500
      );
    }

    res.status(201).json({
      success: true,
      message: "Supplier replacement shipment recorded successfully.",
      data: {
        replacement,
        return_shipment:       returnShipment,
        shipment_items:        shipmentItems,
        cost_allocations:      costAllocations,
        total_quantity:        totalQuantity,
        total_shipping_cost:   shippingCost,
      },
    });
  } catch (err) {
    // ── Compensating rollback ─────────────────────────────────────────────
    // If we created a return shipment but later steps failed, clean up all
    // dependent rows in reverse FK dependency order before propagating the error.
    if (returnShipmentId) {
      // supplier_replacements → supplier_return_shipment_items →
      // return_shipment_cost_allocations → supplier_return_shipments
      await supabaseAdmin
        .from("supplier_replacements")
        .delete()
        .eq("shipment_id", returnShipmentId);

      await supabaseAdmin
        .from("return_shipment_cost_allocations")
        .delete()
        .eq("shipment_id", returnShipmentId);

      await supabaseAdmin
        .from("supplier_return_shipment_items")
        .delete()
        .eq("shipment_id", returnShipmentId);

      await supabaseAdmin
        .from("supplier_return_shipments")
        .delete()
        .eq("id", returnShipmentId);
    }

    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/supplier-replacements  (Create replacement record only)
//
// Lightweight path: creates only the supplier_replacements row.
// Used when the replacement is agreed but the physical shipment has not
// yet been dispatched.
//
//   1. Validate the supplier_return exists and caller has access
//   2. If shipment_id is supplied, verify it references a valid
//      supplier_return_shipments row linked to the same return
//   3. INSERT supplier_replacements
// ─────────────────────────────────────────────────────────────────────────────
export const createSupplierReplacement = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = createSupplierReplacementSchema.parse(req.body);

    // ── 1. Validate supplier_return exists and caller has access ─────────────
    await assertReturnAccess(body.return_id, req);

    // ── 2. Validate optional shipment_id ─────────────────────────────────────
    if (body.shipment_id) {
      const { data: existingShipment, error: shipmentError } =
        await supabaseAdmin
          .from("supplier_return_shipments")
          .select("id, return_id")
          .eq("id", body.shipment_id)
          .single<{ id: string; return_id: string }>();

      if (shipmentError || !existingShipment) {
        throw new AppError(
          `Supplier return shipment with id ${body.shipment_id} not found`,
          404
        );
      }

      // The shipment must belong to the same return being replaced
      if (existingShipment.return_id !== body.return_id) {
        throw new AppError(
          `Shipment ${body.shipment_id} does not belong to return ${body.return_id}`,
          400
        );
      }
    }

    // ── 3. INSERT supplier_replacements ──────────────────────────────────────
    const { data: replacement, error: replacementError } = await supabaseAdmin
      .from("supplier_replacements")
      .insert({
        return_id:   body.return_id,
        shipment_id: body.shipment_id ?? null,
        status:      body.status,
      })
      .select(REPLACEMENT_SELECT)
      .single<SupplierReplacement>();

    if (replacementError || !replacement) {
      throw new AppError(
        `Failed to create supplier replacement: ${replacementError?.message}`,
        500
      );
    }

    res.status(201).json({
      success: true,
      message: "Supplier replacement created successfully.",
      data: replacement,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/supplier-replacements
//
// Paginated list of supplier_replacements enriched with context from
// supplier_returns and supplier_return_shipments.
//
// Query params:
//   ?return_id=<uuid>  — filter to a specific supplier_return
//   ?status=<value>    — filter by supplier_replacements.status
//   ?page=<n>          — page number (default 1)
//   ?limit=<n>         — items per page (default 20, max 100)
//
// Access:
//   Sellers see only replacements whose underlying supplier_returns.seller_id
//   matches their linked seller profile. This is enforced by joining through
//   supplier_returns and filtering on seller_id.
//   Admins see all replacements with an optional ?seller_id= filter.
// ─────────────────────────────────────────────────────────────────────────────
export const listSupplierReplacements = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(
      req.query as Record<string, unknown>
    );

    // ── Validate optional query params ────────────────────────────────────────
    const returnIdParam = req.query.return_id as string | undefined;
    const statusParam   = req.query.status   as string | undefined;
    const sellerIdParam = req.query.seller_id as string | undefined; // admin only

    if (returnIdParam) validateUuid(returnIdParam, "return_id");
    if (sellerIdParam) validateUuid(sellerIdParam, "seller_id");

    if (statusParam &&
        !["pending", "in_transit", "completed"].includes(statusParam)) {
      throw new AppError(
        "status must be 'pending', 'in_transit', or 'completed'",
        400
      );
    }

    // ── Build query ───────────────────────────────────────────────────────────
    let query = supabaseAdmin
      .from("supplier_replacements")
      .select(REPLACEMENT_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    // Apply filters
    if (returnIdParam) {
      query = query.eq("return_id", returnIdParam);
    }

    if (statusParam) {
      query = query.eq("status", statusParam);
    }

    // ── Seller scoping ────────────────────────────────────────────────────────
    // Sellers can only see replacements tied to their own returns.
    // We achieve this by filtering on the nested supplier_returns.seller_id.
    // Admins can optionally filter by ?seller_id= to inspect a specific seller.
    if (!isAdmin(req)) {
      const sellerId = mustGetSellerId(req);
      // Filter via the join: supplier_returns.seller_id = sellerId
      query = query.eq("supplier_returns.seller_id", sellerId);
    } else if (sellerIdParam) {
      query = query.eq("supplier_returns.seller_id", sellerIdParam);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new AppError(
        `Failed to fetch supplier replacements: ${error.message}`,
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
