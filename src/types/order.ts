/**
 * File: src/types/order.ts
 * Path: ecommerce-admin/src/types/order.ts
 *
 * TypeScript interfaces mirroring the orders, order_details, and payment tables.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Schema update (May 2026)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * orders — new column:
 *   sold_by   UUID REFERENCES auth.users(id)
 *     Records the authenticated user who placed / sold the order.
 *     In self-service checkout this equals user_id.
 *     In staff-assisted scenarios this is the staff member's UUID.
 *     Nullable to remain backward-compatible with pre-migration rows.
 *
 * order_details — new column:
 *   selling_price   NUMERIC(12,2)
 *     The effective per-unit price charged to the customer after discounts.
 *     Computed at order placement and stored alongside unit_price for
 *     financial auditability. Nullable for pre-migration rows.
 *
 *     Formula applied by orderController.placeOrder:
 *       percentage discount → base_price × (1 − discount_value / 100)
 *       fixed / flat        → max(0, base_price − discount_value)
 *       no discount         → base_price   (selling_price === unit_price)
 *
 *   inventory_batch_id   UUID REFERENCES inventory_batches(id)
 *     (Pre-existing column — retained for supply-chain traceability.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Complete column lists (post-migration)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * orders:
 *   id, user_id, amount, order_date, status,
 *   shipping_address_id, billing_address_id,
 *   payment_id, shipment_id,
 *   sold_by          ← NEW
 *
 * order_details:
 *   id, order_id, product_id, quantity,
 *   unit_price,
 *   selling_price,   ← NEW
 *   inventory_batch_id
 *
 * payment:
 *   id, type, amount, payment_date, order_id, transaction_id
 */

// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

export type OrderStatus = "pending" | "shipped" | "delivered";

export type PaymentType =
  | "UPI"
  | "Credit Card"
  | "Cash"
  | "Debit Card"
  | "Gift Voucher";

// ─────────────────────────────────────────────
// orders row
// ─────────────────────────────────────────────

export interface Order {
  id:                  string;
  user_id:             string;       // UUID — the customer who owns the order
  amount:              number;       // NUMERIC(12,2) — total charged (post-discount)
  order_date:          string;       // TIMESTAMPTZ
  status:              OrderStatus;  // order_status_enum
  shipping_address_id: string;
  billing_address_id:  string;
  payment_id:          string | null;  // set after payment is confirmed
  shipment_id:         string | null;  // set after shipment is created

  /**
   * sold_by — NEW (May 2026)
   *
   * UUID of the auth.users row representing who placed/sold this order.
   * Equals user_id for standard self-service checkout.
   * Can differ from user_id when a staff member records an in-person sale
   * on behalf of a customer.
   * Nullable: pre-migration orders will have null here.
   */
  sold_by: string | null;
}

// ─────────────────────────────────────────────
// order_details row
// ─────────────────────────────────────────────

export interface OrderDetail {
  id:         string;
  order_id:   string;
  product_id: string;  // UUID FK → product_variants.id (per cart FK pattern)
  quantity:   number;

  /**
   * unit_price — catalogue base price captured at order time.
   * This is the raw base_price from product_variants at the moment the
   * order was placed. It does NOT reflect discounts.
   */
  unit_price: number;   // NUMERIC(12,2)

  /**
   * selling_price — NEW (May 2026)
   *
   * Effective per-unit price actually charged to the customer after any
   * discount is applied. Computed by orderController.placeOrder using:
   *   percentage: base_price × (1 − discount_value / 100)
   *   fixed/flat: max(0, base_price − discount_value)
   *   no discount: equals unit_price
   *
   * The order total (orders.amount) is derived from selling_price × quantity,
   * not from unit_price, so this column is the source of truth for revenue.
   * Nullable for pre-migration rows where the column did not yet exist.
   */
  selling_price: number | null;  // NUMERIC(12,2)

  /**
   * inventory_batch_id — pre-existing column, retained for traceability.
   * Links the order line item back to the inventory batch that supplied it.
   */
  inventory_batch_id: string | null;
}

// ─────────────────────────────────────────────
// payment row — unchanged
// ─────────────────────────────────────────────

export interface Payment {
  id:             string;
  type:           PaymentType;
  amount:         number;          // NUMERIC(12,2)
  payment_date:   string | null;   // TIMESTAMPTZ — set after confirmation
  order_id:       string;
  transaction_id: string | null;   // VARCHAR(255) — gateway reference
}
