/**
 * File: src/validators/supplierProductValidators.ts
 * Path: ecommerce-admin/src/validators/supplierProductValidators.ts
 *
 * Zod request validation schemas for supplier-product mapping endpoints.
 *
 * Schemas:
 *   - createSupplierProductSchema
 *       Validates POST /api/supplier-products request body.
 *       Requires supplier_id + product_id UUIDs and accepts optional
 *       cost_price / lead_time_days.
 *
 *   - updateSupplierProductSchema
 *       Validates PUT /api/supplier-products/:id request body.
 *       Allows only cost_price and lead_time_days updates and enforces
 *       that at least one field is present.
 */
import { z } from "zod";

export const createSupplierProductSchema = z.object({
  supplier_id: z.string().uuid("supplier_id must be a valid UUID"),
  product_id: z.string().uuid("product_id must be a valid UUID"),
  cost_price: z.number().nonnegative("cost_price must be 0 or greater").optional().nullable(),
  lead_time_days: z.number().int("lead_time_days must be an integer").nonnegative("lead_time_days must be 0 or greater").optional().nullable(),
});

export const updateSupplierProductSchema = z
  .object({
    cost_price: z.number().nonnegative("cost_price must be 0 or greater").optional().nullable(),
    lead_time_days: z.number().int("lead_time_days must be an integer").nonnegative("lead_time_days must be 0 or greater").optional().nullable(),
  })
  .refine((data) => data.cost_price !== undefined || data.lead_time_days !== undefined, {
    message: "At least one of cost_price or lead_time_days must be provided",
  });
