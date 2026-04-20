/**
 * File: src/controllers/analyticsController.ts
 * Path: src/controllers/analyticsController.ts
 *
 * Analytics handlers for supplier performance and cost analysis.
 * All endpoints require the seller role or above (seller + admin).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints implemented in this file:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   GET /api/analytics/suppliers
 *     Supplier performance metrics aggregated per supplier.
 *
 *     Metrics returned per supplier:
 *       - total_supplied_quantity    — sum of inventory_batches.quantity
 *       - avg_unit_cost              — average inventory_batches.unit_cost
 *       - avg_landed_cost            — average inventory_batches.landed_cost
 *       - avg_delivery_time_days     — average days between purchase_orders.order_date
 *                                      and supplier_shipments.delivery_date
 *       - return_rate_pct            — (total units returned / total units supplied) × 100
 *                                      derived from supplier_return_items quantity vs
 *                                      inventory_batches quantity for the same supplier
 *       - total_inbound_shipments    — count of supplier_shipments rows
 *       - total_purchase_orders      — count of purchase_orders rows
 *       - total_returns              — count of supplier_returns rows
 *
 *     Access: seller+
 *       Sellers see metrics only for suppliers linked to their own products
 *       (via inventory_batches → product_variants → products.seller_id).
 *       Admins see all suppliers.
 *
 *     Optional query params:
 *       ?seller_id=<uuid>   — admin only: scope metrics to a specific seller
 *
 *   GET /api/analytics/costs
 *     Cost analysis for the caller's inventory showing the full financial
 *     picture from inbound procurement through returns.
 *
 *     Metrics returned in the summary:
 *       - total_inbound_cost         — sum of all inventory_batches.unit_cost × quantity
 *       - total_inbound_shipping_cost — sum of shipment_cost_allocations.allocated_cost
 *       - total_landed_cost          — sum of inventory_batches.landed_cost × remaining_quantity
 *       - total_return_cost          — sum of return_shipment_cost_allocations.allocated_cost
 *       - net_inventory_cost         — total_landed_cost − total_return_cost
 *
 *     Additionally returns a per-product breakdown and a per-supplier breakdown.
 *
 *     Access: seller+
 *       Sellers see costs only for their own products.
 *       Admins see all costs and can filter by ?seller_id=.
 *
 *     Optional query params:
 *       ?seller_id=<uuid>   — admin only: scope costs to a specific seller
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Tables used
 * ─────────────────────────────────────────────────────────────────────────────
 *   inventory_batches
 *   product_variants, products, sellers
 *   suppliers
 *   supplier_shipments, purchase_orders
 *   supplier_returns, supplier_return_items
 *   shipment_cost_allocations
 *   return_shipment_cost_allocations
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Access model
 * ─────────────────────────────────────────────────────────────────────────────
 *   Route layer enforces requireAuth + requireRole("seller").
 *   This permits both seller and admin users via the role hierarchy
 *   (customer < seller < admin).
 *   Controller additionally enforces seller-level data scoping when the
 *   caller is not an admin.
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** UUID v4 regex — validates query params before forwarding to Supabase */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true when the authenticated user has the admin role */
function isAdmin(req: Request): boolean {
  return req.userRole?.role_name === "admin";
}

/**
 * Reads seller_id from req.userRole.
 * Throws 403 if the authenticated seller user has no linked seller profile.
 * Not called for admin users.
 */
function mustGetSellerId(req: Request): string {
  const sellerId = req.userRole?.seller_id;
  if (!sellerId) {
    throw new AppError("No seller profile linked to this account", 403);
  }
  return sellerId;
}

/** Rounds a number to 2 decimal places */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Resolves the seller_id to use for data scoping.
 *   - For admin callers: uses the optional ?seller_id= query param if present,
 *     otherwise returns null (no scoping → all sellers).
 *   - For seller callers: always returns the caller's own seller_id.
 *     The ?seller_id= query param is ignored for non-admin callers.
 *
 * Returns null when the caller is an admin and no filter is applied.
 */
function resolveSellerIdFilter(
  req:             Request,
  sellerIdParam?:  string
): string | null {
  if (isAdmin(req)) {
    if (sellerIdParam) {
      if (!UUID_RE.test(sellerIdParam)) {
        throw new AppError("'seller_id' must be a valid UUID", 400);
      }
      return sellerIdParam;
    }
    return null; // admin with no filter → all sellers
  }

  // Non-admin: always use their own seller_id
  return mustGetSellerId(req);
}

/**
 * Fetches the product IDs owned by a given seller.
 * Returns null when sellerIdFilter is null (no scoping).
 */
async function fetchSellerProductIds(
  sellerIdFilter: string | null
): Promise<string[] | null> {
  if (!sellerIdFilter) return null; // no filter → all products

  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("seller_id", sellerIdFilter);

  if (error) {
    throw new AppError(`Failed to resolve seller products: ${error.message}`, 500);
  }

  return (data ?? []).map((p: any) => p.id as string);
}

/**
 * Fetches the product_variant IDs for a list of product IDs.
 * Returns null when productIds is null (no scoping).
 * Returns an empty array when the seller has no products.
 */
async function fetchVariantIdsByProductIds(
  productIds: string[] | null
): Promise<string[] | null> {
  if (productIds === null) return null; // no filter
  if (productIds.length === 0) return []; // seller has no products

  const { data, error } = await supabaseAdmin
    .from("product_variants")
    .select("id")
    .in("product_id", productIds);

  if (error) {
    throw new AppError(
      `Failed to resolve product variants: ${error.message}`,
      500
    );
  }

  return (data ?? []).map((v: any) => v.id as string);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/suppliers   — seller+
//
// Supplier performance analytics.
//
// The strategy:
//   1. Determine visible product variants based on caller's role / seller filter.
//   2. Load all inventory_batches for those variants, grouped by supplier.
//   3. For each supplier compute aggregated metrics from the batches.
//   4. Fetch additional counts (purchase orders, returns, shipments) per supplier.
//   5. Compute return rate from supplier_return_items joined to those batches.
// ─────────────────────────────────────────────────────────────────────────────
export const getSupplierAnalytics = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const sellerIdParam = req.query.seller_id as string | undefined;
    const sellerIdFilter = resolveSellerIdFilter(req, sellerIdParam);

    // ── Step 1: Resolve visible variant IDs ───────────────────────────────────
    const productIds = await fetchSellerProductIds(sellerIdFilter);
    const variantIds = await fetchVariantIdsByProductIds(productIds);

    // If the seller has no products, return empty analytics immediately
    if (variantIds !== null && variantIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: { suppliers: [], total_suppliers: 0 },
      }) as any;
    }

    // ── Step 2: Load inventory batches ────────────────────────────────────────
    let batchQuery = supabaseAdmin
      .from("inventory_batches")
      .select(`
        id,
        product_variant_id,
        supplier_id,
        shipment_id,
        quantity,
        remaining_quantity,
        unit_cost,
        landed_cost,
        created_at,
        suppliers ( id, name, contact_person, email, phone, status )
      `);

    if (variantIds !== null) {
      batchQuery = batchQuery.in("product_variant_id", variantIds);
    }

    const { data: batches, error: batchError } = await batchQuery;

    if (batchError) {
      throw new AppError(
        `Failed to fetch inventory batches: ${batchError.message}`,
        500
      );
    }

    const batchList = (batches ?? []) as any[];

    // ── Step 3: Aggregate per-supplier batch metrics ──────────────────────────
    type SupplierAgg = {
      supplier_id:                string;
      supplier:                   unknown;
      batch_ids:                  string[];
      total_supplied_quantity:    number;
      total_remaining_quantity:   number;
      unit_cost_sum:              number;
      unit_cost_count:            number;
      landed_cost_sum:            number;
      landed_cost_count:          number;
    };

    const supplierAggMap = new Map<string, SupplierAgg>();

    for (const batch of batchList) {
      const supplierId = batch.supplier_id as string;
      if (!supplierId) continue;

      if (!supplierAggMap.has(supplierId)) {
        const supplierRow = Array.isArray(batch.suppliers)
          ? batch.suppliers[0]
          : batch.suppliers;

        supplierAggMap.set(supplierId, {
          supplier_id:                supplierId,
          supplier:                   supplierRow ?? null,
          batch_ids:                  [],
          total_supplied_quantity:    0,
          total_remaining_quantity:   0,
          unit_cost_sum:              0,
          unit_cost_count:            0,
          landed_cost_sum:            0,
          landed_cost_count:          0,
        });
      }

      const agg = supplierAggMap.get(supplierId)!;
      agg.batch_ids.push(batch.id);
      agg.total_supplied_quantity  += batch.quantity          ?? 0;
      agg.total_remaining_quantity += batch.remaining_quantity ?? 0;

      if (batch.unit_cost != null) {
        agg.unit_cost_sum   += Number(batch.unit_cost);
        agg.unit_cost_count += 1;
      }
      if (batch.landed_cost != null) {
        agg.landed_cost_sum   += Number(batch.landed_cost);
        agg.landed_cost_count += 1;
      }
    }

    // ── Step 4a: Average delivery time per supplier ───────────────────────────
    // Fetch supplier_shipments + linked purchase_orders for each supplier.
    // delivery_time = shipment.delivery_date − purchase_order.order_date (days)
    const allSupplierIds = Array.from(supplierAggMap.keys());

    const deliveryTimeMap = new Map<string, { sum: number; count: number }>();

    if (allSupplierIds.length > 0) {
      const { data: shipments } = await supabaseAdmin
        .from("supplier_shipments")
        .select(`
          id,
          supplier_id,
          shipment_date,
          delivery_date,
          purchase_order_id,
          purchase_orders ( id, order_date )
        `)
        .in("supplier_id", allSupplierIds)
        .not("delivery_date", "is", null);

      for (const s of (shipments ?? []) as any[]) {
        const po = Array.isArray(s.purchase_orders)
          ? s.purchase_orders[0]
          : s.purchase_orders;

        if (!po?.order_date || !s.delivery_date) continue;

        const orderMs    = new Date(po.order_date).getTime();
        const deliveryMs = new Date(s.delivery_date).getTime();
        const days       = (deliveryMs - orderMs) / (1000 * 60 * 60 * 24);

        if (days >= 0) {
          const sid = s.supplier_id as string;
          if (!deliveryTimeMap.has(sid)) {
            deliveryTimeMap.set(sid, { sum: 0, count: 0 });
          }
          const dt = deliveryTimeMap.get(sid)!;
          dt.sum   += days;
          dt.count += 1;
        }
      }
    }

    // ── Step 4b: Return rate per supplier ─────────────────────────────────────
    // return_rate = (total returned units / total supplied units) × 100
    // "Returned units" = sum of supplier_return_items.quantity where the
    // batch belongs to this supplier.
    const returnQtyMap = new Map<string, number>(); // supplierId → returned_units

    if (allSupplierIds.length > 0) {
      // Fetch return items with their batch supplier linkage
      const { data: returnItems } = await supabaseAdmin
        .from("supplier_return_items")
        .select(`
          id,
          inventory_batch_id,
          quantity,
          inventory_batches (
            id,
            supplier_id
          )
        `)
        .not("inventory_batch_id", "is", null);

      for (const ri of (returnItems ?? []) as any[]) {
        const ib = Array.isArray(ri.inventory_batches)
          ? ri.inventory_batches[0]
          : ri.inventory_batches;

        const supplierId = ib?.supplier_id as string | undefined;
        if (!supplierId) continue;

        // Only count returns for suppliers visible to this caller
        if (!supplierAggMap.has(supplierId)) continue;

        returnQtyMap.set(
          supplierId,
          (returnQtyMap.get(supplierId) ?? 0) + (ri.quantity ?? 0)
        );
      }
    }

    // ── Step 4c: Count purchase orders and returns per supplier ───────────────
    const poCountMap     = new Map<string, number>();
    const returnCountMap = new Map<string, number>();
    const shipmentCountMap = new Map<string, number>();

    if (allSupplierIds.length > 0) {
      // Purchase orders
      const { data: poData } = await supabaseAdmin
        .from("purchase_orders")
        .select("id, supplier_id")
        .in("supplier_id", allSupplierIds);

      for (const po of (poData ?? []) as any[]) {
        const sid = po.supplier_id as string;
        poCountMap.set(sid, (poCountMap.get(sid) ?? 0) + 1);
      }

      // Supplier returns
      const { data: returnData } = await supabaseAdmin
        .from("supplier_returns")
        .select("id, supplier_id")
        .in("supplier_id", allSupplierIds);

      for (const sr of (returnData ?? []) as any[]) {
        const sid = sr.supplier_id as string;
        returnCountMap.set(sid, (returnCountMap.get(sid) ?? 0) + 1);
      }

      // Supplier shipments
      const { data: shipmentData } = await supabaseAdmin
        .from("supplier_shipments")
        .select("id, supplier_id")
        .in("supplier_id", allSupplierIds);

      for (const ss of (shipmentData ?? []) as any[]) {
        const sid = ss.supplier_id as string;
        shipmentCountMap.set(sid, (shipmentCountMap.get(sid) ?? 0) + 1);
      }
    }

    // ── Step 5: Assemble final supplier records ───────────────────────────────
    const suppliers = Array.from(supplierAggMap.values()).map((agg) => {
      const sid = agg.supplier_id;

      const returnedQty   = returnQtyMap.get(sid) ?? 0;
      const suppliedQty   = agg.total_supplied_quantity;
      const returnRatePct = suppliedQty > 0
        ? round2((returnedQty / suppliedQty) * 100)
        : 0;

      const dt = deliveryTimeMap.get(sid);
      const avgDeliveryDays = dt && dt.count > 0
        ? round2(dt.sum / dt.count)
        : null;

      return {
        supplier_id:                  sid,
        supplier:                     agg.supplier,
        total_supplied_quantity:      agg.total_supplied_quantity,
        total_remaining_quantity:     agg.total_remaining_quantity,
        avg_unit_cost:                agg.unit_cost_count > 0
          ? round2(agg.unit_cost_sum / agg.unit_cost_count)
          : null,
        avg_landed_cost:              agg.landed_cost_count > 0
          ? round2(agg.landed_cost_sum / agg.landed_cost_count)
          : null,
        avg_delivery_time_days:       avgDeliveryDays,
        return_rate_pct:              returnRatePct,
        total_units_returned:         returnedQty,
        total_inbound_shipments:      shipmentCountMap.get(sid) ?? 0,
        total_purchase_orders:        poCountMap.get(sid)       ?? 0,
        total_returns:                returnCountMap.get(sid)    ?? 0,
      };
    });

    // Sort by total supplied quantity descending for easy reading
    suppliers.sort(
      (a, b) => b.total_supplied_quantity - a.total_supplied_quantity
    );

    res.status(200).json({
      success: true,
      data: {
        suppliers,
        total_suppliers: suppliers.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/costs   — seller+
//
// Cost analysis: inbound cost, return cost, and net cost breakdown.
//
// Metric definitions:
//   inbound_cost          — unit_cost × quantity per batch (procurement cost)
//   inbound_shipping_cost — allocated shipping cost from shipment_cost_allocations
//   total_landed_cost     — landed_cost × remaining_quantity per active batch
//   return_cost           — sum of return_shipment_cost_allocations.allocated_cost
//                           for batches belonging to the caller's products
//   net_inventory_cost    — total_landed_cost − return_cost
//
// Response shape:
//   {
//     summary: {
//       total_inbound_cost,
//       total_inbound_shipping_cost,
//       total_landed_cost,
//       total_return_cost,
//       net_inventory_cost,
//       currency: "INR"
//     },
//     by_product: [
//       { product_id, product_name, product_code,
//         inbound_cost, inbound_shipping_cost, landed_cost, return_cost, net_cost }
//     ],
//     by_supplier: [
//       { supplier_id, supplier_name,
//         inbound_cost, inbound_shipping_cost, landed_cost, return_cost, net_cost }
//     ]
//   }
// ─────────────────────────────────────────────────────────────────────────────
export const getCostAnalytics = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const sellerIdParam  = req.query.seller_id as string | undefined;
    const sellerIdFilter = resolveSellerIdFilter(req, sellerIdParam);

    // ── Resolve visible variant IDs ───────────────────────────────────────────
    const productIds = await fetchSellerProductIds(sellerIdFilter);
    const variantIds = await fetchVariantIdsByProductIds(productIds);

    // Empty result for a seller with no products
    if (variantIds !== null && variantIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          summary: {
            total_inbound_cost:          0,
            total_inbound_shipping_cost: 0,
            total_landed_cost:           0,
            total_return_cost:           0,
            net_inventory_cost:          0,
            currency:                    "INR",
          },
          by_product:  [],
          by_supplier: [],
        },
      }) as any;
    }

    // ── Fetch inventory batches with product and supplier context ─────────────
    let batchQuery = supabaseAdmin
      .from("inventory_batches")
      .select(`
        id,
        product_variant_id,
        supplier_id,
        shipment_id,
        quantity,
        remaining_quantity,
        unit_cost,
        landed_cost,
        product_variants:product_variant_id (
          id,
          product_id,
          products:product_id (
            id,
            name,
            product_code
          )
        ),
        suppliers:supplier_id (
          id,
          name
        )
      `);

    if (variantIds !== null) {
      batchQuery = batchQuery.in("product_variant_id", variantIds);
    }

    const { data: batches, error: batchError } = await batchQuery;

    if (batchError) {
      throw new AppError(
        `Failed to fetch inventory batches: ${batchError.message}`,
        500
      );
    }

    const batchList = (batches ?? []) as any[];
    const batchIds  = batchList.map((b) => b.id as string);

    // ── Fetch inbound shipping cost allocations ───────────────────────────────
    // shipment_cost_allocations links inventory_batch_id → allocated_cost
    // (the portion of the inbound shipment's courier cost allocated to this batch).
    const inboundShippingMap = new Map<string, number>(); // batchId → allocated_cost

    if (batchIds.length > 0) {
      const { data: inboundAllocs } = await supabaseAdmin
        .from("shipment_cost_allocations")
        .select("inventory_batch_id, allocated_cost")
        .in("inventory_batch_id", batchIds);

      for (const alloc of (inboundAllocs ?? []) as any[]) {
        const bid = alloc.inventory_batch_id as string;
        inboundShippingMap.set(
          bid,
          (inboundShippingMap.get(bid) ?? 0) + Number(alloc.allocated_cost ?? 0)
        );
      }
    }

    // ── Fetch return shipping cost allocations ────────────────────────────────
    // return_shipment_cost_allocations links inventory_batch_id → allocated_cost
    // (the portion of the return shipment's courier cost for each batch).
    const returnCostMap = new Map<string, number>(); // batchId → allocated_cost

    if (batchIds.length > 0) {
      const { data: returnAllocs } = await supabaseAdmin
        .from("return_shipment_cost_allocations")
        .select("inventory_batch_id, allocated_cost")
        .in("inventory_batch_id", batchIds);

      for (const alloc of (returnAllocs ?? []) as any[]) {
        const bid = alloc.inventory_batch_id as string;
        returnCostMap.set(
          bid,
          (returnCostMap.get(bid) ?? 0) + Number(alloc.allocated_cost ?? 0)
        );
      }
    }

    // ── Aggregate summary totals + by-product + by-supplier ───────────────────
    type ProductCostAgg = {
      product_id:                  string;
      product_name:                string;
      product_code:                string;
      inbound_cost:                number;
      inbound_shipping_cost:       number;
      landed_cost:                 number;
      return_cost:                 number;
    };

    type SupplierCostAgg = {
      supplier_id:                 string;
      supplier_name:               string;
      inbound_cost:                number;
      inbound_shipping_cost:       number;
      landed_cost:                 number;
      return_cost:                 number;
    };

    const productCostMap  = new Map<string, ProductCostAgg>();
    const supplierCostMap = new Map<string, SupplierCostAgg>();

    let summaryInboundCost         = 0;
    let summaryInboundShippingCost = 0;
    let summaryLandedCost          = 0;
    let summaryReturnCost          = 0;

    for (const batch of batchList) {
      const batchId        = batch.id as string;
      const qty            = Number(batch.quantity            ?? 0);
      const remainingQty   = Number(batch.remaining_quantity  ?? 0);
      const unitCost       = Number(batch.unit_cost           ?? 0);
      const landedCost     = Number(batch.landed_cost         ?? 0);
      const inboundShipping = inboundShippingMap.get(batchId) ?? 0;
      const returnCost      = returnCostMap.get(batchId)       ?? 0;

      const batchInboundCost  = unitCost   * qty;
      const batchLandedCost   = landedCost * remainingQty;

      // Summary totals
      summaryInboundCost         += batchInboundCost;
      summaryInboundShippingCost += inboundShipping;
      summaryLandedCost          += batchLandedCost;
      summaryReturnCost          += returnCost;

      // ── Per-product aggregation ──────────────────────────────────────────
      const variantRaw = Array.isArray(batch.product_variants)
        ? batch.product_variants[0]
        : batch.product_variants;

      const productRaw = variantRaw
        ? (Array.isArray(variantRaw.products)
            ? variantRaw.products[0]
            : variantRaw.products)
        : null;

      const productId   = productRaw?.id          as string | undefined;
      const productName = (productRaw?.name        as string | undefined) ?? "Unknown";
      const productCode = (productRaw?.product_code as string | undefined) ?? "";

      if (productId) {
        if (!productCostMap.has(productId)) {
          productCostMap.set(productId, {
            product_id:            productId,
            product_name:          productName,
            product_code:          productCode,
            inbound_cost:          0,
            inbound_shipping_cost: 0,
            landed_cost:           0,
            return_cost:           0,
          });
        }
        const pc = productCostMap.get(productId)!;
        pc.inbound_cost          += batchInboundCost;
        pc.inbound_shipping_cost += inboundShipping;
        pc.landed_cost           += batchLandedCost;
        pc.return_cost           += returnCost;
      }

      // ── Per-supplier aggregation ─────────────────────────────────────────
      const supplierId   = batch.supplier_id as string | undefined;
      const supplierRaw  = Array.isArray(batch.suppliers)
        ? batch.suppliers[0]
        : batch.suppliers;
      const supplierName = (supplierRaw?.name as string | undefined) ?? "Unknown";

      if (supplierId) {
        if (!supplierCostMap.has(supplierId)) {
          supplierCostMap.set(supplierId, {
            supplier_id:           supplierId,
            supplier_name:         supplierName,
            inbound_cost:          0,
            inbound_shipping_cost: 0,
            landed_cost:           0,
            return_cost:           0,
          });
        }
        const sc = supplierCostMap.get(supplierId)!;
        sc.inbound_cost          += batchInboundCost;
        sc.inbound_shipping_cost += inboundShipping;
        sc.landed_cost           += batchLandedCost;
        sc.return_cost           += returnCost;
      }
    }

    // ── Finalise by-product records ───────────────────────────────────────────
    const byProduct = Array.from(productCostMap.values())
      .map((p) => ({
        product_id:                  p.product_id,
        product_name:                p.product_name,
        product_code:                p.product_code,
        inbound_cost:                round2(p.inbound_cost),
        inbound_shipping_cost:       round2(p.inbound_shipping_cost),
        landed_cost:                 round2(p.landed_cost),
        return_cost:                 round2(p.return_cost),
        net_cost:                    round2(p.landed_cost - p.return_cost),
      }))
      .sort((a, b) => b.landed_cost - a.landed_cost);

    // ── Finalise by-supplier records ──────────────────────────────────────────
    const bySupplier = Array.from(supplierCostMap.values())
      .map((s) => ({
        supplier_id:                 s.supplier_id,
        supplier_name:               s.supplier_name,
        inbound_cost:                round2(s.inbound_cost),
        inbound_shipping_cost:       round2(s.inbound_shipping_cost),
        landed_cost:                 round2(s.landed_cost),
        return_cost:                 round2(s.return_cost),
        net_cost:                    round2(s.landed_cost - s.return_cost),
      }))
      .sort((a, b) => b.inbound_cost - a.inbound_cost);

    res.status(200).json({
      success: true,
      data: {
        summary: {
          total_inbound_cost:          round2(summaryInboundCost),
          total_inbound_shipping_cost: round2(summaryInboundShippingCost),
          total_landed_cost:           round2(summaryLandedCost),
          total_return_cost:           round2(summaryReturnCost),
          net_inventory_cost:          round2(summaryLandedCost - summaryReturnCost),
          currency:                    "INR",
        },
        by_product:  byProduct,
        by_supplier: bySupplier,
      },
    });
  } catch (err) {
    next(err);
  }
};
