/**
 * File: src/types/order.ts
 * Path: ecommerce-admin/src/types/order.ts
 *
 * TypeScript interfaces mirroring the orders, order_details, and payment tables.
 *
 * orders:
 *   id, user_id, amount, order_date, status, shipping_address_id,
 *   billing_address_id, payment_id, shipment_id
 *
 * order_details:
 *   id, order_id, product_id, quantity, unit_price
 *
 * payment:
 *   id, type, amount, payment_date, order_id, transaction_id
 */

export type OrderStatus  = "pending" | "shipped" | "delivered";
export type PaymentType  = "UPI" | "Credit Card" | "Cash" | "Debit Card" | "Gift Voucher";

export interface Order {
  id:                  string;
  user_id:             string;
  amount:              number;         // NUMERIC(12,2)
  order_date:          string;         // TIMESTAMPTZ
  status:              OrderStatus;    // order_status_enum
  shipping_address_id: string;
  billing_address_id:  string;
  payment_id:          string | null;  // set after payment is confirmed
  shipment_id:         string | null;  // set after shipment is created
}

export interface OrderDetail {
  id:         string;
  order_id:   string;
  product_id: string;
  quantity:   number;
  unit_price: number;  // NUMERIC(12,2) — captured at time of order
}

export interface Payment {
  id:             string;
  type:           PaymentType;
  amount:         number;          // NUMERIC(12,2)
  payment_date:   string | null;   // TIMESTAMPTZ — set after confirmation
  order_id:       string;
  transaction_id: string | null;   // VARCHAR(255) — gateway reference
}
