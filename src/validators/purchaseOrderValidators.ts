/**
 * File: src/validators/purchaseOrderValidators.ts
 * Path: src/validators/purchaseOrderValidators.ts
 *
 * Zod schemas for purchase order endpoints.
 *
 * Endpoints validated:
 *   - POST /api/purchase-orders
 *   - PUT  /api/purchase-orders/:id/status
 *
 * Notes:
 *   - seller/admin access is enforced at the route layer.
 *   - body-level constraints are enforced here to keep controllers lean.
 */

import { z } from "zod";

const uuidSchema = z.string().uuid("Must be a valid UUID");

export const purchaseOrderStatusSchema = z.enum(["pending", "shipped", "received"], {
  errorMap: () => ({ message: "status must be 'pending', 'shipped', or 'received'" }),
});

export const createPurchaseOrderSchema = z.object({
  supplier_id: uuidSchema,
  seller_id: uuidSchema.optional(),
  expected_delivery_date: z.string().datetime().optional().nullable(),
  items: z
    .array(
      z.object({
        product_variant_id: uuidSchema,
        quantity: z.number().int().positive("quantity must be greater than 0"),
        unit_cost: z.number().nonnegative("unit_cost cannot be negative").optional().nullable(),
      })
    )
    .min(1, "At least one purchase order item is required"),
});

export const updatePurchaseOrderStatusSchema = z.object({
  status: purchaseOrderStatusSchema,
});
