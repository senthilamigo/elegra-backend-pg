/**
 * File: src/validators/supplierReturnValidators.ts
 * Path: src/validators/supplierReturnValidators.ts
 *
 * Zod schemas for supplier return endpoints.
 *
 * Endpoints validated:
 *   - POST /api/supplier-returns
 *   - PUT  /api/supplier-returns/:id/status
 */

import { z } from "zod";

const uuidSchema = z.string().uuid("Must be a valid UUID");

export const supplierReturnStatusSchema = z.enum(["initiated", "shipped", "completed"], {
  errorMap: () => ({ message: "status must be 'initiated', 'shipped', or 'completed'" }),
});

export const createSupplierReturnSchema = z.object({
  supplier_id: uuidSchema,
  seller_id: uuidSchema.optional(),
  reason: z.string().trim().min(1, "reason cannot be empty").max(100).optional().nullable(),
  items: z
    .array(
      z.object({
        inventory_batch_id: uuidSchema,
        quantity: z.number().int().positive("quantity must be greater than 0"),
      })
    )
    .min(1, "At least one supplier return item is required"),
});

export const updateSupplierReturnStatusSchema = z.object({
  status: supplierReturnStatusSchema,
});
