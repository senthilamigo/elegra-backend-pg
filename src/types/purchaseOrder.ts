/**
 * File: src/types/purchaseOrder.ts
 * Path: src/types/purchaseOrder.ts
 *
 * TypeScript interfaces for purchase order endpoints.
 *
 * Tables covered:
 *   - purchase_orders
 *   - purchase_order_items
 *
 * Schema update (May 2026):
 *   Added tax columns: cgst_percent, sgst_percent, igst_percent,
 *   cgst_amount, sgst_amount, igst_amount.
 *   Added discount columns: discount_type, discount_value, discount_amount.
 *   These are computed by the controller on create/update and
 *   enriched with effective_unit_cost + tax_amount on read.
 *
 * Access model:
 *   - seller: can only access purchase orders where purchase_orders.seller_id
 *             matches the caller's linked seller profile.
 *   - admin:  can access all purchase orders.
 */

// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

export type PurchaseOrderStatus = "pending" | "shipped" | "received";

/** Valid values for purchase_order_items.discount_type */
export type DiscountType = "percentage" | "flat";

// ─────────────────────────────────────────────
// purchase_orders row
// ─────────────────────────────────────────────

export interface PurchaseOrder {
  id:                     string;
  seller_id:              string;
  supplier_id:            string;
  status:                 PurchaseOrderStatus;
  order_date:             string;
  expected_delivery_date: string | null;
  created_at:             string;
}

// ─────────────────────────────────────────────
// purchase_order_items row
//
// Columns mirror the database table exactly.
// The controller computes and stores:
//   cgst_amount, sgst_amount, igst_amount  — derived from percent × taxable_value
//   discount_amount                         — derived from type + value
//
// The controller enriches GET responses with virtual fields (not in DB):
//   tax_amount           = cgst_amount + sgst_amount + igst_amount
//   effective_unit_cost  = (total_cost - discount_amount + tax_amount) / quantity
// ─────────────────────────────────────────────

export interface PurchaseOrderItem {
  id:                 string;
  purchase_order_id:  string;
  product_variant_id: string;
  quantity:           number;
  unit_cost:          number | null;
  received_quantity:  number;

  // Tax rates (raw inputs stored for reference / recalculation)
  cgst_percent: number | null; // NUMERIC(5,2)
  sgst_percent: number | null; // NUMERIC(5,2)
  igst_percent: number | null; // NUMERIC(5,2)

  // Tax amounts (computed: taxable_value × rate / 100)
  cgst_amount:  number | null; // NUMERIC(12,2)
  sgst_amount:  number | null; // NUMERIC(12,2)
  igst_amount:  number | null; // NUMERIC(12,2)

  // Discount
  discount_type:   DiscountType | null; // VARCHAR(20): 'percentage' | 'flat'
  discount_value:  number | null;       // NUMERIC(12,2)
  discount_amount: number | null;       // NUMERIC(12,2) — computed by controller
}

/**
 * PurchaseOrderItem enriched with virtual computed fields that the
 * controller derives at read time (not stored as DB columns).
 *
 *   tax_amount          = cgst_amount + sgst_amount + igst_amount
 *   effective_unit_cost = (total_cost - discount_amount + tax_amount) / quantity
 */
export interface PurchaseOrderItemEnriched extends PurchaseOrderItem {
  /** Sum of all tax components; null when no tax rates were supplied */
  tax_amount: number | null;

  /**
   * The all-in per-unit cost after applying discounts and adding taxes.
   * Formula: (qty × unit_cost − discount_amount + tax_amount) / qty
   * Null when unit_cost is null.
   */
  effective_unit_cost: number | null;
}
