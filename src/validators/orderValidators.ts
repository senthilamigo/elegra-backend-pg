/**
 * File: src/validators/orderValidators.ts
 * Path: ecommerce-admin/src/validators/orderValidators.ts
 *
 * Zod schemas for order and payment request bodies.
 */

import { z } from "zod";

const uuidSchema = z.string().uuid("Must be a valid UUID");

// ─────────────────────────────────────────────
// POST /api/orders — place order from cart
// ─────────────────────────────────────────────

export const createOrderSchema = z.object({
  shipping_address_id: uuidSchema,
  billing_address_id:  uuidSchema,
});

// ─────────────────────────────────────────────
// PATCH /api/orders/:id/status — admin update
// ─────────────────────────────────────────────

export const updateOrderStatusSchema = z.object({
  status: z.enum(["pending", "shipped", "delivered"], {
    errorMap: () => ({ message: "status must be 'pending', 'shipped', or 'delivered'" }),
  }),
});

// ─────────────────────────────────────────────
// POST /api/payments/initiate
// ─────────────────────────────────────────────

export const initiatePaymentSchema = z.object({
  order_id: uuidSchema,
  type:     z.enum(["UPI", "Credit Card", "Cash", "Debit Card", "Gift Voucher"], {
    errorMap: () => ({ message: "type must be one of: UPI, Credit Card, Cash, Debit Card, Gift Voucher" }),
  }),
});

// ─────────────────────────────────────────────
// POST /api/payments/verify — webhook / confirmation
// ─────────────────────────────────────────────

export const verifyPaymentSchema = z.object({
  payment_id:     uuidSchema,
  transaction_id: z.string().min(1, "transaction_id is required").max(255),
  // Webhooks may include a signature or secret for authenticity verification
  webhook_secret: z.string().optional(),
});

// ─────────────────────────────────────────────
// POST /api/payments/:id/refund
// ─────────────────────────────────────────────

export const refundPaymentSchema = z.object({
  reason: z.string().max(500).optional(),
});

// ─────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────

export type CreateOrderInput       = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type InitiatePaymentInput   = z.infer<typeof initiatePaymentSchema>;
export type VerifyPaymentInput     = z.infer<typeof verifyPaymentSchema>;
export type RefundPaymentInput     = z.infer<typeof refundPaymentSchema>;
