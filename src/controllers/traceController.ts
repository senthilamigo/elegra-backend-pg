/**
 * File: src/controllers/traceController.ts
 * Path: src/controllers/traceController.ts
 *
 * Traceability handlers — traces the supply chain path from a product
 * variant or customer order back to the originating supplier.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints implemented in this file:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   GET /api/trace/product/:variantId
 *     Traces a single product variant back to its supplier(s) by walking:
 *       product_variants → inventory_batches → suppliers
 *
 *     Returns all inventory batches that have ever stocked this variant,
 *     together with the linked supplier, purchase order, and inbound
 *     supplier shipment for each batch. Multiple batches may exist for a
 *     single variant (e.g. restocks from the same or different suppliers).
 *
 *     Access: requireAuth + requireRole("seller")
 *             Sellers see only batches for variants that belong to their
 *             own seller profile. Admins bypass this check.
 *
 *   GET /api/trace/order/:orderId
 *     Traces a customer order back to the supplier(s) by walking:
 *       orders → order_details → inventory_batches → suppliers
 *
 *     For each line item in the order it finds the inventory batch(es) that
 *     supplied the variant, enriching each with supplier and shipment context.
 *
 *     Access: requireAuth + requireRole("seller")
 *             Sellers see only orders that contain at least one of their
 *             own products. Admins can trace any order.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Traceability chain
 * ─────────────────────────────────────────────────────────────────────────────
 *   order
 *     └── order_details          (product_id = product_variants.id)
 *           └── product_variants (product_id → products.seller_id)
 *                 └── inventory_batches (product_variant_id, supplier_id, shipment_id)
 *                       └── suppliers
 *                       └── supplier_shipments (purchase_order_id)
 *                             └── purchase_orders
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Tables used
 * ─────────────────────────────────────────────────────────────────────────────
 *   product_variants, products, sellers
 *   inventory_batches
 *   suppliers
 *   supplier_shipments, purchase_orders
 *   orders, order_details  (for the order trace endpoint)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Access model
 * ─────────────────────────────────────────────────────────────────────────────
 *   Route layer enforces requireAuth + requireRole("seller").
 *   This permits both seller and admin users via the role hierarchy
 *   (customer < seller < admin).
 *   Controller additionally enforces seller-level data scoping:
 *     - Sellers can only trace variants / orders that belong to their
 *       own seller profile.
 *     - Admin users bypass the seller_id ownership check.
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** UUID v4 regex — validates :id path params before querying Supabase */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
}

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

/**
 * Columns to join from inventory_batches enriched with supplier and
 * supplier_shipments context. Kept in one constant so both handlers
 * return a consistent batch shape.
 */
const BATCH_SELECT = `
  id,
  product_variant_id,
  supplier_id,
  shipment_id,
  quantity,
  remaining_quantity,
  unit_cost,
  landed_cost,
  created_at,
  suppliers (
    id,
    name,
    contact_person,
    email,
    phone,
    status
  ),
  supplier_shipments (
    id,
    purchase_order_id,
    courier_name,
    tracking_number,
    shipment_date,
    delivery_date,
    shipping_cost,
    status,
    purchase_orders (
      id,
      status,
      order_date,
      expected_delivery_date
    )
  )
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/trace/product/:variantId   — seller+
//
// Traces a product variant back to its supplier(s).
//
// Path param:
//   :variantId — UUID of the product_variants row to trace
//
// Response:
//   {
//     variant:  { id, sku, color, size, material, base_price, product: {...} }
//     batches:  InventoryBatch[]   — each with supplier + shipment context
//     summary:  {
//       total_batches:             number
//       total_quantity_received:   number
//       total_remaining_quantity:  number
//       supplier_count:            number   — distinct suppliers
//       suppliers:                 { id, name }[]
//     }
//   }
// ─────────────────────────────────────────────────────────────────────────────
export const traceProductVariant = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { variantId } = req.params;
    validateUuid(variantId, "variantId");

    // ── Fetch the variant with its parent product (for ownership check) ──────
    const { data: variant, error: variantError } = await supabaseAdmin
      .from("product_variants")
      .select(`
        id,
        sku,
        color,
        size,
        material,
        base_price,
        stock,
        status,
        is_active,
        product_id,
        products (
          id,
          name,
          product_code,
          seller_id,
          category_id,
          gender
        )
      `)
      .eq("id", variantId)
      .single<{
        id:         string;
        sku:        string | null;
        color:      string | null;
        size:       string | null;
        material:   string | null;
        base_price: number | null;
        stock:      number | null;
        status:     string | null;
        is_active:  boolean | null;
        product_id: string;
        products:   { id: string; name: string; product_code: string; seller_id: string | null } | null;
      }>();

    if (variantError || !variant) {
      throw new AppError(`Product variant with id ${variantId} not found`, 404);
    }

    // ── Seller ownership check ────────────────────────────────────────────────
    // For non-admin callers: verify the variant's parent product belongs to
    // the calling seller's profile. Return 404 (not 403) to avoid leaking
    // whether variants belonging to other sellers exist.
    if (!isAdmin(req)) {
      const sellerId = mustGetSellerId(req);
      const productSellerId = (
        Array.isArray(variant.products)
          ? (variant.products as any[])[0]
          : variant.products
      )?.seller_id ?? null;

      if (productSellerId !== sellerId) {
        throw new AppError(
          `Product variant with id ${variantId} not found`,
          404
        );
      }
    }

    // ── Fetch all inventory batches for this variant ──────────────────────────
    // A variant may have been stocked multiple times (different batches /
    // different suppliers). We return all of them so the caller has the
    // full supply chain history.
    const { data: batches, error: batchesError } = await supabaseAdmin
      .from("inventory_batches")
      .select(BATCH_SELECT)
      .eq("product_variant_id", variantId)
      .order("created_at", { ascending: false });

    if (batchesError) {
      throw new AppError(
        `Failed to fetch inventory batches: ${batchesError.message}`,
        500
      );
    }

    const batchList = (batches ?? []) as any[];

    // ── Build summary ─────────────────────────────────────────────────────────
    // Collect distinct supplier IDs and aggregate quantities.
    const supplierMap = new Map<string, { id: string; name: string }>();
    let totalQtyReceived  = 0;
    let totalQtyRemaining = 0;

    for (const batch of batchList) {
      totalQtyReceived  += batch.quantity ?? 0;
      totalQtyRemaining += batch.remaining_quantity ?? 0;

      const supplier = Array.isArray(batch.suppliers)
        ? batch.suppliers[0]
        : batch.suppliers;

      if (supplier?.id && !supplierMap.has(supplier.id)) {
        supplierMap.set(supplier.id, { id: supplier.id, name: supplier.name });
      }
    }

    const productDisplay = Array.isArray(variant.products)
      ? (variant.products as any[])[0]
      : variant.products;

    res.status(200).json({
      success: true,
      data: {
        variant: {
          id:         variant.id,
          sku:        variant.sku,
          color:      variant.color,
          size:       variant.size,
          material:   variant.material,
          base_price: variant.base_price,
          stock:      variant.stock,
          status:     variant.status,
          is_active:  variant.is_active,
          product:    productDisplay,
        },
        batches: batchList,
        summary: {
          total_batches:            batchList.length,
          total_quantity_received:  totalQtyReceived,
          total_remaining_quantity: totalQtyRemaining,
          supplier_count:           supplierMap.size,
          suppliers:                Array.from(supplierMap.values()),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/trace/order/:orderId   — seller+
//
// Traces a customer order back to the supplier(s) by walking:
//   orders → order_details → inventory_batches → suppliers
//
// Path param:
//   :orderId — UUID of the orders row to trace
//
// Response:
//   {
//     order:       { id, user_id, amount, status, order_date }
//     line_items:  [
//       {
//         order_detail:  { id, product_id, quantity, unit_price }
//         variant:       { id, sku, color, size, … }
//         batches:       InventoryBatch[]   — with supplier + shipment context
//       }
//       …
//     ]
//     summary: {
//       total_line_items:  number
//       total_batches:     number
//       supplier_count:    number
//       suppliers:         { id, name }[]
//     }
//   }
// ─────────────────────────────────────────────────────────────────────────────
export const traceOrder = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { orderId } = req.params;
    validateUuid(orderId, "orderId");

    // ── Fetch the order header ────────────────────────────────────────────────
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, amount, status, order_date, shipping_address_id, billing_address_id")
      .eq("id", orderId)
      .single<{
        id:                  string;
        user_id:             string;
        amount:              number;
        status:              string;
        order_date:          string;
        shipping_address_id: string;
        billing_address_id:  string;
      }>();

    if (orderError || !order) {
      throw new AppError(`Order with id ${orderId} not found`, 404);
    }

    // ── Fetch line items for this order ───────────────────────────────────────
    // order_details.product_id references product_variants.id (per cart.sql FK
    // pattern — the product_id column in order_details is a variant UUID).
    const { data: details, error: detailsError } = await supabaseAdmin
      .from("order_details")
      .select(`
        id,
        order_id,
        product_id,
        quantity,
        unit_price,
        product_variants:product_id (
          id,
          sku,
          color,
          size,
          material,
          base_price,
          status,
          product_id,
          products:product_id (
            id,
            name,
            product_code,
            seller_id
          )
        )
      `)
      .eq("order_id", orderId)
      .order("id", { ascending: true });

    if (detailsError) {
      throw new AppError(
        `Failed to fetch order details: ${detailsError.message}`,
        500
      );
    }

    const detailList = (details ?? []) as any[];

    // ── Seller ownership check ────────────────────────────────────────────────
    // For non-admin sellers: the order must contain at least one line item
    // whose product belongs to the caller's seller profile.
    if (!isAdmin(req)) {
      const sellerId = mustGetSellerId(req);

      const hasOwnProduct = detailList.some((d) => {
        const variant  = Array.isArray(d.product_variants) ? d.product_variants[0] : d.product_variants;
        const product  = variant
          ? (Array.isArray(variant.products) ? variant.products[0] : variant.products)
          : null;
        return product?.seller_id === sellerId;
      });

      if (!hasOwnProduct) {
        // Return 404 to avoid leaking that the order exists for another seller
        throw new AppError(`Order with id ${orderId} not found`, 404);
      }
    }

    // ── Collect all variant IDs in this order ─────────────────────────────────
    // We need them to batch-fetch inventory batches.
    const variantIds = [
      ...new Set(detailList.map((d) => d.product_id as string)),
    ];

    // ── Fetch inventory batches for all variants at once ──────────────────────
    // Grouping into a single query avoids N+1 round-trips for large orders.
    let allBatches: any[] = [];

    if (variantIds.length > 0) {
      const { data: batchData, error: batchError } = await supabaseAdmin
        .from("inventory_batches")
        .select(BATCH_SELECT)
        .in("product_variant_id", variantIds)
        .order("created_at", { ascending: false });

      if (batchError) {
        throw new AppError(
          `Failed to fetch inventory batches: ${batchError.message}`,
          500
        );
      }

      allBatches = (batchData ?? []) as any[];
    }

    // Build a lookup: variantId → batch[]
    const batchesByVariant = new Map<string, any[]>();
    for (const batch of allBatches) {
      const vid = batch.product_variant_id as string;
      if (!batchesByVariant.has(vid)) batchesByVariant.set(vid, []);
      batchesByVariant.get(vid)!.push(batch);
    }

    // ── Assemble line-item trace objects ──────────────────────────────────────
    const lineItems = detailList.map((d) => {
      const variantRaw = Array.isArray(d.product_variants)
        ? d.product_variants[0]
        : d.product_variants;

      const productRaw = variantRaw
        ? (Array.isArray(variantRaw.products) ? variantRaw.products[0] : variantRaw.products)
        : null;

      return {
        order_detail: {
          id:         d.id,
          product_id: d.product_id,
          quantity:   d.quantity,
          unit_price: d.unit_price,
        },
        variant: variantRaw
          ? {
              id:        variantRaw.id,
              sku:       variantRaw.sku,
              color:     variantRaw.color,
              size:      variantRaw.size,
              material:  variantRaw.material,
              base_price: variantRaw.base_price,
              status:    variantRaw.status,
            }
          : null,
        product: productRaw ?? null,
        batches: batchesByVariant.get(d.product_id) ?? [],
      };
    });

    // ── Build summary ─────────────────────────────────────────────────────────
    const supplierMap = new Map<string, { id: string; name: string }>();
    let totalBatches = 0;

    for (const item of lineItems) {
      totalBatches += item.batches.length;

      for (const batch of item.batches) {
        const supplier = Array.isArray(batch.suppliers)
          ? batch.suppliers[0]
          : batch.suppliers;

        if (supplier?.id && !supplierMap.has(supplier.id)) {
          supplierMap.set(supplier.id, { id: supplier.id, name: supplier.name });
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        order,
        line_items: lineItems,
        summary: {
          total_line_items: lineItems.length,
          total_batches:    totalBatches,
          supplier_count:   supplierMap.size,
          suppliers:        Array.from(supplierMap.values()),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};
