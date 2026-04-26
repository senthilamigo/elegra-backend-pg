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
 *       supplier_product_name, supplier_sku, cost_price, and lead_time_days.
 *
 *   - updateSupplierProductSchema
 *       Validates PUT /api/supplier-products/:id request body.
 *       Allows supplier_product_name, supplier_sku, cost_price, and
 *       lead_time_days updates and enforces at least one field is present.
 */
import { z } from "zod";

export const createSupplierProductSchema = z.object({
  supplier_id: z.string().uuid("supplier_id must be a valid UUID"),
  product_id: z.string().uuid("product_id must be a valid UUID"),
  supplier_product_name: z.string().max(255, "supplier_product_name must be 255 characters or fewer").optional().nullable(),
  supplier_sku: z.string().max(100, "supplier_sku must be 100 characters or fewer").optional().nullable(),
  cost_price: z.number().nonnegative("cost_price must be 0 or greater").optional().nullable(),
  lead_time_days: z.number().int("lead_time_days must be an integer").nonnegative("lead_time_days must be 0 or greater").optional().nullable(),
});

export const updateSupplierProductSchema = z
  .object({
    supplier_product_name: z.string().max(255, "supplier_product_name must be 255 characters or fewer").optional().nullable(),
    supplier_sku: z.string().max(100, "supplier_sku must be 100 characters or fewer").optional().nullable(),
    cost_price: z.number().nonnegative("cost_price must be 0 or greater").optional().nullable(),
    lead_time_days: z.number().int("lead_time_days must be an integer").nonnegative("lead_time_days must be 0 or greater").optional().nullable(),
  })
  .refine((data) =>
    data.supplier_product_name !== undefined
    || data.supplier_sku !== undefined
    || data.cost_price !== undefined
    || data.lead_time_days !== undefined, {
    message: "At least one updatable field must be provided",
  });
