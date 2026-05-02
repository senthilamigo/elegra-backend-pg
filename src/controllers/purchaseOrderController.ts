/**
 * File: src/controllers/purchaseOrderController.ts
 * Path: src/controllers/purchaseOrderController.ts
 *
 * Handlers for purchase order endpoints.
 *
 * Endpoints in this file:
 *   - GET  /api/purchase-orders
 *   - GET  /api/purchase-orders/:id
 *   - PUT  /api/purchase-orders/:id/status
 *   - POST /api/purchase-orders
 *
 * Tables used:
 *   - purchase_orders
 *   - purchase_order_items  (now includes tax + discount columns)
 *   - suppliers             (supplier validation)
 *   - sellers               (admin seller validation)
 *   - product_variants + products (seller ownership checks for line items)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Tax & Discount calculation (May 2026)
 * ─────────────────────────────────────────────────────────────────────────────
 * New columns added to purchase_order_items:
 *   cgst_percent, sgst_percent, igst_percent   NUMERIC(5,2)
 *   cgst_amount,  sgst_amount,  igst_amount    NUMERIC(12,2)
 *   discount_type  VARCHAR(20)   — 'percentage' | 'flat'
 *   discount_value NUMERIC(12,2)
 *   discount_amount NUMERIC(12,2)
 *
 * Derived values computed by this controller:
 *
 *   taxable_value    = quantity × unit_cost
 *   cgst_amount      = taxable_value × cgst_percent / 100
 *   sgst_amount      = taxable_value × sgst_percent / 100
 *   igst_amount      = taxable_value × igst_percent / 100
 *   tax_amount       = cgst_amount + sgst_amount + igst_amount
 *
 *   discount_amount:
 *     if discount_type = 'percentage':
 *       discount_amount = unit_cost × quantity × (discount_value / 100)
 *     if discount_type = 'flat':
 *       discount_amount = discount_value
 *
 *   total_cost       = unit_cost × quantity
 *   effective_unit_cost = (total_cost - discount_amount + tax_amount) / quantity
 *
 * All derived amounts are rounded to 2 decimal places before storage.
 * If unit_cost is null (not yet confirmed), all derived amounts are null too.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Access model
 * ─────────────────────────────────────────────────────────────────────────────
 *   - seller: restricted to own seller_id rows
 *   - admin:  unrestricted
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import { ApiResponse } from "../types";
import { PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from "../types/purchaseOrder";
import {
  createPurchaseOrderSchema,
  updatePurchaseOrderStatusSchema,
  PurchaseOrderItemInput,
} from "../validators/purchaseOrderValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that a string is a valid UUID v4.
 * Throws 400 AppError immediately if the format is wrong.
 */
function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
}

/**
 * Parses ?page= and ?limit= with safe defaults and caps.
 * Default: page=1, limit=20. Cap: limit ≤ 100.
 */
function parsePage(query: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(query.page  ?? "1"),  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  return { page, limit, from: (page - 1) * limit, to: (page - 1) * limit + limit - 1 };
}

/** Returns true when the authenticated user has the admin role */
function isAdmin(req: Request): boolean {
  return req.userRole?.role_name === "admin";
}

/**
 * Resolves the seller_id to use for the operation.
 *   - Admin callers: uses body/query seller_id or falls back to their own profile.
 *   - Seller callers: always uses their own seller_id from userRole.
 */
function resolveSellerId(req: Request, sellerIdFromBody?: string): string {
  if (isAdmin(req)) {
    const sellerId = sellerIdFromBody ?? req.userRole?.seller_id;
    if (!sellerId) {
      throw new AppError(
        "seller_id is required when admin account has no linked seller profile",
        400
      );
    }
    return sellerId;
  }

  const sellerId = req.userRole?.seller_id;
  if (!sellerId) {
    throw new AppError("No seller profile linked to this account", 403);
  }
  return sellerId;
}

/** Rounds a number to 2 decimal places — consistent with DB NUMERIC(12,2) */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tax & Discount calculation
//
// All calculations return null when unit_cost is null (price not yet confirmed).
// This keeps derived columns null rather than persisting misleading zeros.
// ─────────────────────────────────────────────────────────────────────────────

interface DerivedItemAmounts {
  /** quantity × unit_cost */
  taxable_value:        number | null;
  /** taxable_value × cgst_percent / 100 */
  cgst_amount:          number | null;
  /** taxable_value × sgst_percent / 100 */
  sgst_amount:          number | null;
  /** taxable_value × igst_percent / 100 */
  igst_amount:          number | null;
  /** cgst_amount + sgst_amount + igst_amount */
  tax_amount:           number | null;
  /**
   * 'percentage': unit_cost × quantity × (discount_value / 100)
   * 'flat':       discount_value (absolute INR amount)
   */
  discount_amount:      number | null;
  /** (total_cost - discount_amount + tax_amount) / quantity */
  effective_unit_cost:  number | null;
}

/**
 * Computes all derived monetary amounts for a single purchase order line item.
 *
 * @param item     - Validated request body for the line item
 * @returns        - Derived amounts rounded to 2 decimal places; null when
 *                   unit_cost is not yet known.
 */
function computeItemAmounts(item: PurchaseOrderItemInput): DerivedItemAmounts {
  // When unit_cost is not yet known, all derived amounts must be null to
  // avoid storing misleading values in the DB.
  if (item.unit_cost == null) {
    return {
      taxable_value:       null,
      cgst_amount:         null,
      sgst_amount:         null,
      igst_amount:         null,
      tax_amount:          null,
      discount_amount:     null,
      effective_unit_cost: null,
    };
  }

  const unitCost  = item.unit_cost;
  const qty       = item.quantity;

  // Base: taxable value before any adjustments
  const taxableValue = round2(qty * unitCost);

  // Tax amounts — default to 0 when percent not supplied, then null-check
  // to avoid writing zeros when the caller intentionally omitted them.
  const cgstAmount = item.cgst_percent != null
    ? round2(taxableValue * item.cgst_percent / 100)
    : null;

  const sgstAmount = item.sgst_percent != null
    ? round2(taxableValue * item.sgst_percent / 100)
    : null;

  const igstAmount = item.igst_percent != null
    ? round2(taxableValue * item.igst_percent / 100)
    : null;

  // Total tax: sum of whichever components are present; null when none present
  const taxAmount = (cgstAmount != null || sgstAmount != null || igstAmount != null)
    ? round2((cgstAmount ?? 0) + (sgstAmount ?? 0) + (igstAmount ?? 0))
    : null;

  // Discount amount
  let discountAmount: number | null = null;

  if (item.discount_type != null && item.discount_value != null) {
    if (item.discount_type === "percentage") {
      // Percentage of the full line total (unit_cost × quantity)
      discountAmount = round2(unitCost * qty * (item.discount_value / 100));
    } else {
      // Flat absolute amount in INR — not per-unit, it's the full line discount
      discountAmount = round2(item.discount_value);
    }
  }

  // Effective unit cost:
  //   (total_cost - discount_amount + tax_amount) / quantity
  // Treat null components as zero for this calculation so the formula
  // always produces a meaningful result when unit_cost is known.
  const totalCost      = taxableValue;                     // qty × unit_cost
  const discountForCalc = discountAmount ?? 0;
  const taxForCalc      = taxAmount      ?? 0;

  const effectiveUnitCost = round2(
    (totalCost - discountForCalc + taxForCalc) / qty
  );

  return {
    taxable_value:       taxableValue,
    cgst_amount:         cgstAmount,
    sgst_amount:         sgstAmount,
    igst_amount:         igstAmount,
    tax_amount:          taxAmount,
    discount_amount:     discountAmount,
    effective_unit_cost: effectiveUnitCost,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECT strings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Columns selected for purchase_orders rows in list/get responses.
 * Includes a join to suppliers for display context.
 */
const PURCHASE_ORDER_SELECT = `
  id, seller_id, supplier_id, status, order_date, expected_delivery_date, created_at,
  suppliers ( id, name, status )
`.trim();

/**
 * Columns selected for purchase_order_items rows.
 * Includes all new tax/discount columns alongside existing fields.
 */
const PURCHASE_ORDER_ITEM_SELECT = `
  id,
  purchase_order_id,
  product_variant_id,
  quantity,
  unit_cost,
  received_quantity,
  cgst_percent,
  sgst_percent,
  igst_percent,
  cgst_amount,
  sgst_amount,
  igst_amount,
  discount_type,
  discount_value,
  discount_amount,
  product_variants (
    id,
    product_id,
    sku,
    color,
    size,
    base_price,
    status
  )
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Confirms the sellers row exists; throws 404 otherwise. */
async function assertSellerExists(sellerId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("sellers")
    .select("id")
    .eq("id", sellerId)
    .single<{ id: string }>();

  if (!data) {
    throw new AppError(`Seller with id ${sellerId} not found`, 404);
  }
}

/** Confirms the supplier exists and is not suspended/inactive; throws otherwise. */
async function assertSupplierExists(supplierId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("suppliers")
    .select("id, status")
    .eq("id", supplierId)
    .single<{ id: string; status: string | null }>();

  if (!data) {
    throw new AppError(`Supplier with id ${supplierId} not found`, 404);
  }

  if (data.status === "suspended" || data.status === "inactive") {
    throw new AppError(`Supplier with id ${supplierId} is not active`, 400);
  }
}

/**
 * Validates that the caller has access to the given product variant.
 * For seller callers: the variant's parent product must belong to their seller_id.
 * Admin callers bypass this check.
 */
async function assertVariantAccess(
  variantId: string,
  sellerId:  string,
  admin:     boolean
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("product_variants")
    .select("id, product_id, products!inner ( seller_id )")
    .eq("id", variantId)
    .single<{
      id:         string;
      product_id: string;
      products:   { seller_id: string } | { seller_id: string }[];
    }>();

  if (!data) {
    throw new AppError(`Product variant with id ${variantId} not found`, 404);
  }

  const productsJoin = Array.isArray(data.products) ? data.products[0] : data.products;

  if (!admin && productsJoin?.seller_id !== sellerId) {
    throw new AppError(
      `You do not have permission to use product variant ${variantId}`,
      403
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/purchase-orders   — seller+
//
// Paginated list of purchase orders.
// Sellers see only their own orders; admins see all and can filter by seller.
//
// Query params:
//   ?status=pending|shipped|received
//   ?seller_id=<uuid>   — admin only
//   ?page=  ?limit=
// ─────────────────────────────────────────────────────────────────────────────
export const listPurchaseOrders = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const status = req.query.status as PurchaseOrderStatus | undefined;
    const admin  = isAdmin(req);

    // Validate the status filter value if provided
    if (status && !["pending", "shipped", "received"].includes(status)) {
      throw new AppError("status must be 'pending', 'shipped', or 'received'", 400);
    }

    let query = supabaseAdmin
      .from("purchase_orders")
      .select(PURCHASE_ORDER_SELECT, { count: "exact" })
      .order("order_date", { ascending: false })
      .range(from, to);

    // Sellers are scoped to their own orders; admins can optionally filter
    if (!admin) {
      const sellerId = req.userRole?.seller_id;
      if (!sellerId) {
        throw new AppError("No seller profile linked to this account", 403);
      }
      query = query.eq("seller_id", sellerId);
    } else if (req.query.seller_id) {
      const sellerId = String(req.query.seller_id);
      validateUuid(sellerId, "seller_id");
      query = query.eq("seller_id", sellerId);
    }

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new AppError(`Failed to fetch purchase orders: ${error.message}`, 500);
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
// GET /api/purchase-orders/:id   — seller+
//
// Returns a single purchase order with all its line items.
// The line items include all tax and discount columns plus the derived amounts
// so the client can display a full financial breakdown without recalculating.
//
// Response shape:
//   {
//     ...purchase_order,
//     items: [
//       {
//         ...item_columns,
//         effective_unit_cost: number | null,   ← computed at read time
//         tax_amount:          number | null,   ← cgst + sgst + igst
//         product_variants:    { ... }
//       }
//     ]
//   }
// ─────────────────────────────────────────────────────────────────────────────
export const getPurchaseOrder = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "purchase order id");

    const admin = isAdmin(req);

    // Build the purchase_orders query
    let query = supabaseAdmin
      .from("purchase_orders")
      .select(PURCHASE_ORDER_SELECT)
      .eq("id", id);

    // Sellers can only see their own orders
    if (!admin) {
      const sellerId = req.userRole?.seller_id;
      if (!sellerId) {
        throw new AppError("No seller profile linked to this account", 403);
      }
      query = query.eq("seller_id", sellerId);
    }

    const { data: po, error } = await query.single<PurchaseOrder & { suppliers?: unknown }>();

    if (error || !po) {
      throw new AppError(`Purchase order with id ${id} not found`, 404);
    }

    // Fetch line items with all columns including new tax/discount fields
    const { data: items, error: itemsError } = await supabaseAdmin
      .from("purchase_order_items")
      .select(PURCHASE_ORDER_ITEM_SELECT)
      .eq("purchase_order_id", id)
      .order("id", { ascending: true });

    if (itemsError) {
      throw new AppError(
        `Failed to fetch purchase order items: ${itemsError.message}`,
        500
      );
    }

    // Enrich each item with computed effective_unit_cost and tax_amount
    // These are derived at read time from the stored percent/amount columns
    // so the client always sees consistent numbers.
    const enrichedItems = (items ?? []).map((item: any) => {
      const cgst = Number(item.cgst_amount ?? 0);
      const sgst = Number(item.sgst_amount ?? 0);
      const igst = Number(item.igst_amount ?? 0);

      // tax_amount: sum of stored amounts (null when none are present)
      const taxAmount =
        item.cgst_amount != null || item.sgst_amount != null || item.igst_amount != null
          ? round2(cgst + sgst + igst)
          : null;

      // effective_unit_cost derived from stored values
      let effectiveUnitCost: number | null = null;
      if (item.unit_cost != null && item.quantity > 0) {
        const totalCost      = round2(Number(item.unit_cost) * Number(item.quantity));
        const discountAmount = Number(item.discount_amount ?? 0);
        const taxForCalc     = taxAmount ?? 0;
        effectiveUnitCost    = round2((totalCost - discountAmount + taxForCalc) / Number(item.quantity));
      }

      return {
        ...item,
        tax_amount:          taxAmount,
        effective_unit_cost: effectiveUnitCost,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        ...po,
        items: enrichedItems,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/purchase-orders/:id/status   — seller+
//
// Updates the status of a purchase order.
// Sellers can only update their own orders; admins can update any.
// ─────────────────────────────────────────────────────────────────────────────
export const updatePurchaseOrderStatus = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "purchase order id");

    const body  = updatePurchaseOrderStatusSchema.parse(req.body);
    const admin = isAdmin(req);

    // Build existence + ownership check query
    let existingQuery = supabaseAdmin
      .from("purchase_orders")
      .select("id, seller_id, status")
      .eq("id", id);

    if (!admin) {
      const sellerId = req.userRole?.seller_id;
      if (!sellerId) {
        throw new AppError("No seller profile linked to this account", 403);
      }
      existingQuery = existingQuery.eq("seller_id", sellerId);
    }

    const { data: existing } = await existingQuery.single<{
      id:        string;
      seller_id: string;
      status:    PurchaseOrderStatus;
    }>();

    if (!existing) {
      throw new AppError(`Purchase order with id ${id} not found`, 404);
    }

    // Apply the status update
    const { data, error } = await supabaseAdmin
      .from("purchase_orders")
      .update({ status: body.status })
      .eq("id", id)
      .select(PURCHASE_ORDER_SELECT)
      .single<PurchaseOrder>();

    if (error || !data) {
      throw new AppError(
        `Failed to update purchase order status: ${error?.message}`,
        500
      );
    }

    res.status(200).json({
      success: true,
      message: "Purchase order status updated successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/purchase-orders   — seller+
//
// Creates a new purchase order with line items.
// For each line item the controller:
//   1. Validates variant access (seller ownership check)
//   2. Computes derived tax and discount amounts from the input percentages
//   3. Persists all computed amounts alongside the raw inputs
//
// The response includes enriched items with effective_unit_cost and tax_amount.
// ─────────────────────────────────────────────────────────────────────────────
export const createPurchaseOrder = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body     = createPurchaseOrderSchema.parse(req.body);
    const admin    = isAdmin(req);
    const sellerId = resolveSellerId(req, body.seller_id);

    // Confirm the seller and supplier both exist before creating anything
    await assertSellerExists(sellerId);
    await assertSupplierExists(body.supplier_id);

    // Validate that each variant is accessible to this seller
    for (const item of body.items) {
      await assertVariantAccess(item.product_variant_id, sellerId, admin);
    }

    // ── Insert the purchase_orders header row ──────────────────────────────
    const { data: po, error: poError } = await supabaseAdmin
      .from("purchase_orders")
      .insert({
        seller_id:              sellerId,
        supplier_id:            body.supplier_id,
        status:                 "pending",
        expected_delivery_date: body.expected_delivery_date ?? null,
      })
      .select(PURCHASE_ORDER_SELECT)
      .single<PurchaseOrder>();

    if (poError || !po) {
      throw new AppError(
        `Failed to create purchase order: ${poError?.message}`,
        500
      );
    }

    // ── Compute derived amounts and build items payload ────────────────────
    //
    // For each line item we:
    //   1. Compute all derived monetary amounts (tax/discount/effective cost)
    //      using computeItemAmounts().
    //   2. Build the DB insert payload combining raw inputs + derived amounts.
    //
    // This keeps all calculation logic in one place (computeItemAmounts) and
    // makes the controller easy to audit — no math scattered across the handler.
    const itemsPayload = body.items.map((item) => {
      const derived = computeItemAmounts(item);

      return {
        purchase_order_id:  po.id,
        product_variant_id: item.product_variant_id,
        quantity:           item.quantity,
        unit_cost:          item.unit_cost ?? null,
        received_quantity:  0,

        // Tax rates (raw input — stored for reference)
        cgst_percent: item.cgst_percent  ?? null,
        sgst_percent: item.sgst_percent  ?? null,
        igst_percent: item.igst_percent  ?? null,

        // Tax amounts (computed)
        cgst_amount:  derived.cgst_amount,
        sgst_amount:  derived.sgst_amount,
        igst_amount:  derived.igst_amount,

        // Discount (raw input + computed amount)
        discount_type:   item.discount_type   ?? null,
        discount_value:  item.discount_value  ?? null,
        discount_amount: derived.discount_amount,
      };
    });

    // ── Insert line items ──────────────────────────────────────────────────
    const { data: insertedItems, error: itemsError } = await supabaseAdmin
      .from("purchase_order_items")
      .insert(itemsPayload)
      .select(PURCHASE_ORDER_ITEM_SELECT)
      .returns<any[]>();

    if (itemsError) {
      // Rollback the purchase order header to avoid an orphaned row
      await supabaseAdmin.from("purchase_orders").delete().eq("id", po.id);
      throw new AppError(
        `Failed to create purchase order items: ${itemsError.message}`,
        500
      );
    }

    // ── Enrich items with effective_unit_cost and tax_amount for the response
    const enrichedItems = (insertedItems ?? []).map((item: any) => {
      const cgst = Number(item.cgst_amount ?? 0);
      const sgst = Number(item.sgst_amount ?? 0);
      const igst = Number(item.igst_amount ?? 0);

      const taxAmount =
        item.cgst_amount != null || item.sgst_amount != null || item.igst_amount != null
          ? round2(cgst + sgst + igst)
          : null;

      let effectiveUnitCost: number | null = null;
      if (item.unit_cost != null && item.quantity > 0) {
        const totalCost      = round2(Number(item.unit_cost) * Number(item.quantity));
        const discountAmount = Number(item.discount_amount ?? 0);
        const taxForCalc     = taxAmount ?? 0;
        effectiveUnitCost    = round2((totalCost - discountAmount + taxForCalc) / Number(item.quantity));
      }

      return {
        ...item,
        tax_amount:          taxAmount,
        effective_unit_cost: effectiveUnitCost,
      };
    });

    res.status(201).json({
      success: true,
      message: "Purchase order created successfully.",
      data: {
        ...po,
        items: enrichedItems,
      },
    });
  } catch (err) {
    next(err);
  }
};
