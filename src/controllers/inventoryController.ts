/**
 * File: src/controllers/inventoryController.ts
 * Path: src/controllers/inventoryController.ts
 *
 * Inventory reporting handlers exposed under /api/inventory.
 *
 * Endpoints implemented in this controller:
 *   - GET /api/inventory
 *       Returns inventory summary grouped by product across all inventory batches
 *       visible to the caller (admin = all sellers, seller = own seller_id only).
 *
 *   - GET /api/inventory/:productId
 *       Returns product-level inventory breakdown with variant-wise and batch-wise
 *       details for a single product.
 *
 *   - GET /api/inventory/batches/:id
 *       Returns a single inventory batch with related product/variant/supplier/
 *       shipment context and shipping-cost allocation totals.
 *
 * Authorization model:
 *   - Route layer enforces requireAuth + requireRole("seller") so only seller and
 *     admin roles can access these endpoints.
 *   - This controller additionally enforces seller scoping at the data level:
 *       seller users can only read inventory tied to products belonging to their
 *       own seller profile.
 *
 * Schema update (May 2026):
 *   - inventory_batches.tax_amount NUMERIC(12,2) column added.
 *   - All three endpoints now select and surface tax_amount in their responses.
 *   - The inventory cost calculation in getInventorySummary uses
 *     (landed_cost ?? unit_cost ?? 0) as before; tax_amount is returned as a
 *     raw field and does NOT alter the cost aggregation — it is informational,
 *     recording the tax component captured at the time of the purchase order.
 *
 * Tables used:
 *   - inventory_batches (source of stock quantities and costs)
 *   - product_variants  (variant metadata)
 *   - products          (product ownership and product-level grouping)
 *   - suppliers         (batch supplier info)
 *   - supplier_shipments (shipment context)
 *   - shipment_cost_allocations (allocated shipping cost per batch)
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import { ApiResponse } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a single row from the inventory_batches table joined with its
 * related product_variants, products, suppliers, and supplier_shipments rows.
 *
 * tax_amount: NUMERIC(12,2) — the tax component recorded at intake time,
 * sourced from purchase_order_items tax fields and stored on the batch.
 * Null when the batch was created before tax tracking was introduced, or
 * when no tax was applicable.
 */
type InventoryBatchJoinedRow = {
  id: string;
  product_variant_id: string;
  supplier_id: string | null;
  shipment_id: string | null;
  quantity: number;
  remaining_quantity: number;
  unit_cost: number | null;
  landed_cost: number | null;
  /** Tax amount captured at purchase order time — NEW column (May 2026) */
  tax_amount: number | null;
  created_at: string;
  product_variants: {
    id: string;
    sku: string | null;
    color: string | null;
    size: string | null;
    material: string | null;
    product_id: string;
    products: {
      id: string;
      name: string;
      product_code: string;
      seller_id: string | null;
    } | null;
  } | null;
  suppliers: {
    id: string;
    name: string;
    status: string | null;
  } | null;
  supplier_shipments: {
    id: string;
    tracking_number: string | null;
    courier_name: string | null;
    shipment_date: string | null;
    delivery_date: string | null;
    status: string | null;
  } | null;
};

type ShipmentCostAllocationRow = {
  inventory_batch_id: string;
  allocated_cost: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label: string): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
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

async function fetchSellerProductIds(sellerId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("seller_id", sellerId);

  if (error) {
    throw new AppError(`Failed to fetch seller products: ${error.message}`, 500);
  }

  return (data ?? []).map((row: any) => row.id);
}

async function fetchVariantIdsByProducts(productIds: string[]): Promise<string[]> {
  if (productIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("product_variants")
    .select("id")
    .in("product_id", productIds);

  if (error) {
    throw new AppError(`Failed to fetch product variants: ${error.message}`, 500);
  }

  return (data ?? []).map((row: any) => row.id);
}

/**
 * Resolves the set of product_variant IDs the caller is allowed to see.
 * Returns null for admin callers (no scoping → all variants visible).
 * Returns a string[] for seller callers (may be empty if they have no products).
 */
async function fetchVisibleVariantIds(req: Request): Promise<string[] | null> {
  if (isAdmin(req)) return null;

  const sellerId = mustGetSellerId(req);
  const productIds = await fetchSellerProductIds(sellerId);
  const variantIds = await fetchVariantIdsByProducts(productIds);
  return variantIds;
}

/**
 * Core data-fetch helper used by both getInventorySummary and
 * getInventoryByProduct.
 *
 * Includes tax_amount in the SELECT list so all downstream handlers
 * can surface it without additional queries.
 *
 * @param variantIds  null → fetch all batches (admin); string[] → scoped list
 */
async function fetchInventoryRowsByVariantIds(
  variantIds: string[] | null
): Promise<InventoryBatchJoinedRow[]> {
  // Short-circuit: seller has no products → no batches to return
  if (variantIds && variantIds.length === 0) return [];

  let query = supabaseAdmin
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
      tax_amount,
      created_at,
      product_variants(
        id,
        sku,
        color,
        size,
        material,
        product_id,
        products(
          id,
          name,
          product_code,
          seller_id
        )
      ),
      suppliers(
        id,
        name,
        status
      ),
      supplier_shipments(
        id,
        tracking_number,
        courier_name,
        shipment_date,
        delivery_date,
        status
      )
    `)
    .order("created_at", { ascending: false });

  if (variantIds !== null) {
    query = query.in("product_variant_id", variantIds);
  }

  const { data, error } = await query.returns<InventoryBatchJoinedRow[]>();

  if (error) {
    throw new AppError(`Failed to fetch inventory batches: ${error.message}`, 500);
  }

  return data ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory   — seller+
//
// Returns a summary of all inventory batches grouped by product.
//
// Per-product totals:
//   total_batches             — number of distinct inventory batches
//   total_quantity            — total units ever received
//   total_remaining_quantity  — units currently in stock
//   total_inventory_cost      — sum of (landed_cost ?? unit_cost) × remaining_quantity
//   total_tax_amount          — sum of tax_amount across all batches for this product
//                               (null when none of the batches have a tax_amount)
//
// Per-variant summary within each product:
//   product_variant_id, sku, quantity, remaining_quantity
//   (tax_amount is not broken out per variant in the summary — use the
//    /api/inventory/:productId endpoint for variant+batch-level tax detail)
//
// Overview object:
//   products_count, batches_count, total_quantity,
//   total_remaining_quantity, total_inventory_cost
// ─────────────────────────────────────────────────────────────────────────────
export const getInventorySummary = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const visibleVariantIds = await fetchVisibleVariantIds(req);
    const rows = await fetchInventoryRowsByVariantIds(visibleVariantIds);

    // ── Per-product aggregation ───────────────────────────────────────────────
    type ProductSummary = {
      product_id: string;
      product_name: string;
      product_code: string;
      seller_id: string | null;
      total_batches: number;
      total_quantity: number;
      total_remaining_quantity: number;
      total_inventory_cost: number;
      /** Sum of tax_amount across all batches; null when no batch has a tax_amount */
      total_tax_amount: number | null;
      variants: {
        product_variant_id: string;
        sku: string | null;
        quantity: number;
        remaining_quantity: number;
      }[];
    };

    const productMap = new Map<string, ProductSummary>();

    for (const row of rows) {
      const product = row.product_variants?.products;
      if (!product) continue;

      if (!productMap.has(product.id)) {
        productMap.set(product.id, {
          product_id: product.id,
          product_name: product.name,
          product_code: product.product_code,
          seller_id: product.seller_id,
          total_batches: 0,
          total_quantity: 0,
          total_remaining_quantity: 0,
          total_inventory_cost: 0,
          total_tax_amount: null,
          variants: [],
        });
      }

      const summary = productMap.get(product.id)!;
      summary.total_batches += 1;
      summary.total_quantity += row.quantity;
      summary.total_remaining_quantity += row.remaining_quantity;

      // Use landed_cost when available (includes allocated shipping); fall back to unit_cost
      summary.total_inventory_cost +=
        (row.landed_cost ?? row.unit_cost ?? 0) * row.remaining_quantity;

      // Accumulate tax_amount — keep null until we see at least one non-null value
      if (row.tax_amount != null) {
        summary.total_tax_amount = (summary.total_tax_amount ?? 0) + Number(row.tax_amount);
      }

      // Aggregate variant-level quantity within this product
      const variant = summary.variants.find(
        (v) => v.product_variant_id === row.product_variant_id
      );
      if (variant) {
        variant.quantity += row.quantity;
        variant.remaining_quantity += row.remaining_quantity;
      } else {
        summary.variants.push({
          product_variant_id: row.product_variant_id,
          sku: row.product_variants?.sku ?? null,
          quantity: row.quantity,
          remaining_quantity: row.remaining_quantity,
        });
      }
    }

    // ── Finalise product list ─────────────────────────────────────────────────
    const products = Array.from(productMap.values()).map((item) => ({
      ...item,
      total_inventory_cost: Number(item.total_inventory_cost.toFixed(2)),
      total_tax_amount:
        item.total_tax_amount !== null
          ? Number(item.total_tax_amount.toFixed(2))
          : null,
    }));

    // ── Overview totals ───────────────────────────────────────────────────────
    const overview = {
      products_count: products.length,
      batches_count: products.reduce((acc, p) => acc + p.total_batches, 0),
      total_quantity: products.reduce((acc, p) => acc + p.total_quantity, 0),
      total_remaining_quantity: products.reduce(
        (acc, p) => acc + p.total_remaining_quantity,
        0
      ),
      total_inventory_cost: Number(
        products.reduce((acc, p) => acc + p.total_inventory_cost, 0).toFixed(2)
      ),
    };

    res.status(200).json({
      success: true,
      data: {
        overview,
        products,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory/:productId   — seller+
//
// Returns a detailed breakdown for a single product:
//   - product-level totals (total_variants, total_batches, total_quantity,
//     total_remaining_quantity)
//   - per-variant breakdown, each with its own batch list
//
// Each batch in the response now includes tax_amount alongside the existing
// unit_cost and landed_cost fields.
//
// Path param:
//   :productId — UUID of the products row
// ─────────────────────────────────────────────────────────────────────────────
export const getInventoryByProduct = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { productId } = req.params;
    validateUuid(productId, "product id");

    // ── Fetch and authorise the product ───────────────────────────────────────
    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("id, name, product_code, seller_id")
      .eq("id", productId)
      .single<{ id: string; name: string; product_code: string; seller_id: string | null }>();

    if (productError || !product) {
      throw new AppError(`Product with id ${productId} not found`, 404);
    }

    // Sellers may only view inventory for their own products
    if (!isAdmin(req)) {
      const sellerId = mustGetSellerId(req);
      if (product.seller_id !== sellerId) {
        throw new AppError(
          "You do not have permission to view inventory for this product",
          403
        );
      }
    }

    // ── Fetch all variants for this product ───────────────────────────────────
    const { data: variants, error: variantsError } = await supabaseAdmin
      .from("product_variants")
      .select("id, sku, color, size, material")
      .eq("product_id", productId)
      .returns<
        { id: string; sku: string | null; color: string | null; size: string | null; material: string | null }[]
      >();

    if (variantsError) {
      throw new AppError(
        `Failed to fetch product variants: ${variantsError.message}`,
        500
      );
    }

    // ── Fetch all inventory batches for these variants ─────────────────────────
    const variantIds = (variants ?? []).map((v) => v.id);
    const rows = await fetchInventoryRowsByVariantIds(variantIds);

    // ── Build per-variant breakdown ───────────────────────────────────────────
    const inventoryByVariant = (variants ?? []).map((variant) => {
      const variantBatches = rows.filter(
        (row) => row.product_variant_id === variant.id
      );

      return {
        variant_id: variant.id,
        sku: variant.sku,
        color: variant.color,
        size: variant.size,
        material: variant.material,
        total_batches: variantBatches.length,
        total_quantity: variantBatches.reduce((sum, row) => sum + row.quantity, 0),
        total_remaining_quantity: variantBatches.reduce(
          (sum, row) => sum + row.remaining_quantity,
          0
        ),
        batches: variantBatches.map((row) => ({
          batch_id: row.id,
          supplier_id: row.supplier_id,
          supplier_name: row.suppliers?.name ?? null,
          shipment_id: row.shipment_id,
          quantity: row.quantity,
          remaining_quantity: row.remaining_quantity,
          unit_cost: row.unit_cost,
          landed_cost: row.landed_cost,
          // tax_amount — NEW: surfaced per-batch for full financial visibility
          tax_amount: row.tax_amount,
          created_at: row.created_at,
        })),
      };
    });

    res.status(200).json({
      success: true,
      data: {
        product,
        totals: {
          total_variants: inventoryByVariant.length,
          total_batches: inventoryByVariant.reduce(
            (sum, item) => sum + item.total_batches,
            0
          ),
          total_quantity: inventoryByVariant.reduce(
            (sum, item) => sum + item.total_quantity,
            0
          ),
          total_remaining_quantity: inventoryByVariant.reduce(
            (sum, item) => sum + item.total_remaining_quantity,
            0
          ),
        },
        variants: inventoryByVariant,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory/batches/:id   — seller+
//
// Returns a single inventory batch enriched with:
//   - product/variant context
//   - supplier details
//   - supplier_shipments context
//   - allocated_shipping_cost from shipment_cost_allocations
//   - inventory_value = (landed_cost ?? unit_cost) × remaining_quantity
//   - tax_amount — NEW: the tax component recorded at purchase order intake
//
// Path param:
//   :id — UUID of the inventory_batches row
// ─────────────────────────────────────────────────────────────────────────────
export const getInventoryBatchDetails = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "batch id");

    // ── Fetch the batch with all join context ─────────────────────────────────
    // tax_amount is included alongside the existing cost columns so callers
    // can see the full cost breakdown for this batch in a single request.
    const { data: batch, error: batchError } = await supabaseAdmin
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
        tax_amount,
        created_at,
        product_variants(
          id,
          sku,
          color,
          size,
          material,
          product_id,
          products(
            id,
            name,
            product_code,
            seller_id
          )
        ),
        suppliers(
          id,
          name,
          contact_person,
          email,
          phone,
          status
        ),
        supplier_shipments(
          id,
          purchase_order_id,
          courier_name,
          tracking_number,
          shipment_date,
          delivery_date,
          status,
          shipping_cost,
          created_at
        )
      `)
      .eq("id", id)
      .single<InventoryBatchJoinedRow>();

    if (batchError || !batch) {
      throw new AppError(`Inventory batch with id ${id} not found`, 404);
    }

    // ── Seller ownership check ────────────────────────────────────────────────
    const ownerSellerId = batch.product_variants?.products?.seller_id ?? null;
    if (!isAdmin(req)) {
      const sellerId = mustGetSellerId(req);
      if (ownerSellerId !== sellerId) {
        throw new AppError("You do not have permission to view this batch", 403);
      }
    }

    // ── Fetch shipment cost allocations for this batch ────────────────────────
    const { data: allocations, error: allocationsError } = await supabaseAdmin
      .from("shipment_cost_allocations")
      .select("inventory_batch_id, allocated_cost")
      .eq("inventory_batch_id", id)
      .returns<ShipmentCostAllocationRow[]>();

    if (allocationsError) {
      throw new AppError(
        `Failed to fetch shipment cost allocations: ${allocationsError.message}`,
        500
      );
    }

    // ── Compute derived summary values ────────────────────────────────────────
    const allocatedShippingCost = Number(
      (allocations ?? [])
        .reduce((sum, row) => sum + (row.allocated_cost ?? 0), 0)
        .toFixed(2)
    );

    const inventoryValue = Number(
      (
        (batch.landed_cost ?? batch.unit_cost ?? 0) * batch.remaining_quantity
      ).toFixed(2)
    );

    res.status(200).json({
      success: true,
      data: {
        batch,
        // tax_amount is already present inside `batch` above; we also surface
        // it at the top level as a convenience for callers that want a flat
        // cost summary without drilling into the batch object.
        tax_amount: batch.tax_amount ?? null,
        allocated_shipping_cost: allocatedShippingCost,
        inventory_value: inventoryValue,
      },
    });
  } catch (err) {
    next(err);
  }
};
