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
 * Access model:
 *   - seller: can only access purchase orders where purchase_orders.seller_id matches
 *             the caller's linked seller profile.
 *   - admin:  can access all purchase orders.
 */

export type PurchaseOrderStatus = "pending" | "shipped" | "received";

export interface PurchaseOrder {
  id: string;
  seller_id: string;
  supplier_id: string;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_delivery_date: string | null;
  created_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_variant_id: string;
  quantity: number;
  unit_cost: number | null;
  received_quantity: number;
}
