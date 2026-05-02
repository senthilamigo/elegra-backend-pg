/**
 * File: src/controllers/supplierReplacementController.ts
 * Path: src/controllers/supplierReplacementController.ts
 *
 * Handlers for supplier replacement endpoints.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUG FIX 1 — Wrong FK join target in REPLACEMENT_SELECT (root 500 cause)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * supplier_replacements.shipment_id references supplier_shipments(id)
 * (inbound replacement shipments FROM supplier), NOT supplier_return_shipments.
 *
 * Schema (sql/supplier_replacements.sql):
 *   shipment_id UUID REFERENCES supplier_shipments(id)   ← inbound
 *
 * The original REPLACEMENT_SELECT joined supplier_return_shipments, which has
 * no FK relationship with supplier_replacements. PostgREST threw:
 *   "Could not find a relationship between supplier_replacements
 *    and supplier_return_shipments in the schema cache"
 * This caused a 500 on every GET /api/supplier-replacements request.
 *
 * Fix: join supplier_shipments instead of supplier_return_shipments.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUG FIX 2 — Frontend ?select= param overrides controller's Supabase query
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The admin frontend isJoinError() retry appends ?select=... to the URL.
 * The Supabase JS SDK passes all req.query params to PostgREST, which
 * treats ?select= as an override for the column list — ignoring the
 * controller's own .select() call. Any unrecognised column in that param
 * causes another 500.
 *
 * Fix: delete req.query.select at the top of listSupplierReplacements before
 * any Supabase call. The controller's REPLACEMENT_SELECT is always authoritative.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUG FIX 3 — Seller scoping used unsupported dot-notation join filter
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Replaced: query.eq("supplier_returns.seller_id", sellerId)  ← PostgREST rejects
 * With: two-step ID pre-fetch via resolveVisibleReturnIds()    ← safe direct filter
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints:
 *   POST /api/supplier-replacements  — recordReplacementShipment (body.shipment present)
 *                                    — createSupplierReplacement  (body.shipment absent)
 *   GET  /api/supplier-replacements  — listSupplierReplacements
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
}

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

function round2(value: number): number {
  return Number(value.toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────
// REPLACEMENT_SELECT
//
// FIX 1: Join supplier_shipments (correct FK target), NOT supplier_return_shipments.
//
// supplier_replacements.shipment_id → supplier_shipments.id
//
// supplier_return_shipments is a separate table for outbound returns TO the
// supplier. It has no FK relationship with supplier_replacements and cannot
// be joined here. Using it caused a PostgREST schema cache error → 500.
// ─────────────────────────────────────────────────────────────────────────────
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
  supplier_shipments (
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
 * Select string for supplier_return_shipments rows created during
 * recordReplacementShipment. This table is only written to in the POST
 * handler — it is NOT joined in REPLACEMENT_SELECT for the GET handler.
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
// assertReturnAccess
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
      // 404 not 403 — avoids leaking resource existence for other sellers
      throw new AppError(`Supplier return with id ${returnId} not found`, 404);
    }
  }

  return data;
}

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
// resolveVisibleReturnIds  (FIX 3 — replaces broken dot-notation join filter)
//
// Step 1 of two-step seller scoping:
//   SELECT id FROM supplier_returns WHERE seller_id = sellerIdFilter
//
// Returns:
//   null      — admin with no scope filter (all replacements visible)
//   string[]  — IDs of returns visible to this seller (may be empty)
// ─────────────────────────────────────────────────────────────────────────────
async function resolveVisibleReturnIds(
  sellerIdFilter: string | null
): Promise<string[] | null> {
  if (!sellerIdFilter) return null;

  const { data, error } = await supabaseAdmin
    .from("supplier_returns")
    .select("id")
    .eq("seller_id", sellerIdFilter);

  if (error) {
    throw new AppError(
      `Failed to resolve visible supplier returns: ${error.message}`,
      500
    );
  }

  return (data ?? []).map((row: { id: string }) => row.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/supplier-replacements  (Record Replacement — body.shipment present)
// ─────────────────────────────────────────────────────────────────────────────
export const recordReplacementShipment = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  let returnShipmentId: string | null = null;

  try {
    const body = recordReplacementShipmentSchema.parse(req.body);

    // 1. Validate supplier_return exists and caller has access
    const supplierReturn = await assertReturnAccess(body.return_id, req);

    // 2. Assert no duplicate batch IDs
    assertNoDuplicateBatchIds(body.shipment.items);

    // 3. Validate each inventory_batch belongs to the return's supplier
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

    const foundBatchIds = new Set((batches ?? []).map((b) => b.id));
    for (const batchId of batchIds) {
      if (!foundBatchIds.has(batchId)) {
        throw new AppError(`Inventory batch with id ${batchId} not found`, 404);
      }
    }

    const batchById = new Map((batches ?? []).map((b) => [b.id, b]));

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

    // 4. INSERT supplier_return_shipments
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

    returnShipmentId = returnShipment.id;

    // 5. INSERT supplier_return_shipment_items
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

    // 6 & 7. Compute and INSERT proportional cost allocations
    const totalQuantity = shipmentItems.reduce((sum, item) => sum + item.quantity, 0);
    const shippingCost  = body.shipment.shipping_cost;
    let costAllocations: ReturnShipmentCostAllocation[] = [];

    if (shippingCost > 0 && totalQuantity > 0) {
      let allocatedSoFar = 0;
      const allocationsPayload = shipmentItems.map((item, index) => {
        let allocatedCost: number;
        if (index === shipmentItems.length - 1) {
          allocatedCost = round2(shippingCost - allocatedSoFar);
        } else {
          allocatedCost = round2((shippingCost * item.quantity) / totalQuantity);
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

    // 8. INSERT supplier_replacements
    const { data: replacement, error: replacementError } = await supabaseAdmin
      .from("supplier_replacements")
      .insert({
        return_id:   body.return_id,
        shipment_id: returnShipment.id,
        status:      body.status ?? "in_transit",
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
        return_shipment:     returnShipment,
        shipment_items:      shipmentItems,
        cost_allocations:    costAllocations,
        total_quantity:      totalQuantity,
        total_shipping_cost: shippingCost,
      },
    });
  } catch (err) {
    // Compensating rollback — reverse FK dependency order
    if (returnShipmentId) {
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
// ─────────────────────────────────────────────────────────────────────────────
export const createSupplierReplacement = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = createSupplierReplacementSchema.parse(req.body);

    await assertReturnAccess(body.return_id, req);

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

      if (existingShipment.return_id !== body.return_id) {
        throw new AppError(
          `Shipment ${body.shipment_id} does not belong to return ${body.return_id}`,
          400
        );
      }
    }

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
// ─────────────────────────────────────────────────────────────────────────────
export const listSupplierReplacements = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    // ── FIX 2: Strip ?select= before any Supabase call ────────────────────────
    // The frontend isJoinError() retry appends ?select=... to the URL.
    // The Supabase JS SDK forwards all req.query params to PostgREST, which
    // treats ?select= as an override that replaces the controller's own
    // .select() call. Any unrecognised column or join syntax in the param
    // causes PostgREST to return a 500.
    //
    // Deleting it here ensures REPLACEMENT_SELECT (with the corrected FK join)
    // is always used, regardless of what the client appends.
    delete (req.query as Record<string, unknown>).select;

    const { page, limit, from, to } = parsePage(
      req.query as Record<string, unknown>
    );

    const returnIdParam = req.query.return_id as string | undefined;
    const statusParam   = req.query.status    as string | undefined;
    const sellerIdParam = req.query.seller_id as string | undefined;

    if (returnIdParam) validateUuid(returnIdParam, "return_id");
    if (sellerIdParam) validateUuid(sellerIdParam, "seller_id");

    if (statusParam && !["pending", "in_transit", "completed"].includes(statusParam)) {
      throw new AppError(
        "status must be 'pending', 'in_transit', or 'completed'",
        400
      );
    }

    // ── Determine seller scope ─────────────────────────────────────────────────
    let sellerIdFilter: string | null = null;
    if (!isAdmin(req)) {
      sellerIdFilter = mustGetSellerId(req);
    } else if (sellerIdParam) {
      sellerIdFilter = sellerIdParam;
    }

    // ── FIX 3: Two-step return ID pre-fetch for seller scoping ────────────────
    const visibleReturnIds = await resolveVisibleReturnIds(sellerIdFilter);

    // Short-circuit: seller has no returns → cannot have any replacements
    if (visibleReturnIds !== null && visibleReturnIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: { data: [], total: 0, page, limit, hasMore: false },
      }) as any;
    }

    // ── Main query — direct-column filters only ───────────────────────────────
    let query = supabaseAdmin
      .from("supplier_replacements")
      .select(REPLACEMENT_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    // Direct column filters (safe — no dot-notation join paths)
    if (returnIdParam) query = query.eq("return_id", returnIdParam);
    if (statusParam)   query = query.eq("status",    statusParam);

    // Seller scoping via return_id IN list (FIX 3 — replaces dot-notation)
    if (visibleReturnIds !== null) {
      query = query.in("return_id", visibleReturnIds);
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
