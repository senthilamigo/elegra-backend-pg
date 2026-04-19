
/**
 * File: src/validators/supplierShipmentValidators.ts
 * Path: src/validators/supplierShipmentValidators.ts
 *
 * Zod schemas for supplier shipment endpoints.
 *
 * Endpoints validated:
 *   - POST /api/supplier-shipments
 *
 * Validation goals:
 *   - Ensure valid UUID references.
 *   - Ensure at least one shipment line item is provided.
 *   - Ensure line-item quantities are positive integers.
 *   - Accept optional shipment metadata (courier/tracking/dates/status/shipping_cost).
 */

import { z } from "zod";

const uuidSchema = z.string().uuid("Must be a valid UUID");

export const createSupplierShipmentSchema = z.object({
  purchase_order_id: uuidSchema,
  seller_id: uuidSchema.optional(),
  courier_name: z.string().trim().max(100).optional().nullable(),
  tracking_number: z.string().trim().max(100).optional().nullable(),
  shipment_date: z.string().datetime().optional().nullable(),
  delivery_date: z.string().datetime().optional().nullable(),
  shipping_cost: z.number().nonnegative("shipping_cost cannot be negative").optional().default(0),
  status: z.string().trim().max(50).optional().nullable(),
  items: z
    .array(
      z.object({
        product_variant_id: uuidSchema,
        quantity: z.number().int("quantity must be an integer").positive("quantity must be greater than 0"),
      })
    )
    .min(1, "At least one supplier shipment item is required"),
});

export type CreateSupplierShipmentInput = z.infer<typeof createSupplierShipmentSchema>;
