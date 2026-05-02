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
 *       cost_price, lead_time_days, supplier_product_name, and supplier_sku.
 *
 *   - updateSupplierProductSchema
 *       Validates PUT /api/supplier-products/:id request body.
 *       Allows updates to cost_price, lead_time_days, supplier_product_name,
 *       and supplier_sku. Enforces that at least one field is present.
 *
 * Schema changes (April 2026):
 *   Added supplier_product_name (VARCHAR 255, optional, nullable) and
 *   supplier_sku (VARCHAR 100, optional, nullable) to both schemas, matching
 *   the new columns added to the supplier_products table.
 */
import { z } from "zod";

// ─────────────────────────────────────────────
// POST /api/supplier-products
// ─────────────────────────────────────────────
export const createSupplierProductSchema = z.object({
  /** UUID of the supplier being mapped — must already exist in suppliers table */
  supplier_id: z.string().uuid("supplier_id must be a valid UUID"),

  /** UUID of the product being mapped — must already exist in products table */
  product_id: z.string().uuid("product_id must be a valid UUID"),

  /** Supplier's agreed unit cost for this product (optional at creation) */
  cost_price: z
    .number()
    .nonnegative("cost_price must be 0 or greater")
    .optional()
    .nullable(),

  /** Typical lead time in days from order to delivery (optional at creation) */
  lead_time_days: z
    .number()
    .int("lead_time_days must be an integer")
    .nonnegative("lead_time_days must be 0 or greater")
    .optional()
    .nullable(),

  /**
   * The supplier's own name or label for this product.
   * Useful when the supplier refers to it differently from the platform's
   * products.name. Max 255 chars to match the VARCHAR(255) column.
   */
  supplier_product_name: z
    .string()
    .trim()
    .max(255, "supplier_product_name must be 255 characters or fewer")
    .optional()
    .nullable(),

  /**
   * The supplier's internal stock-keeping unit reference for this product.
   * Max 100 chars to match the VARCHAR(100) column.
   */
  supplier_sku: z
    .string()
    .trim()
    .max(100, "supplier_sku must be 100 characters or fewer")
    .optional()
    .nullable(),
});

// ─────────────────────────────────────────────
// PUT /api/supplier-products/:id
// ─────────────────────────────────────────────
export const updateSupplierProductSchema = z
  .object({
    /** Updated unit cost from this supplier */
    cost_price: z
      .number()
      .nonnegative("cost_price must be 0 or greater")
      .optional()
      .nullable(),

    /** Updated lead time in days */
    lead_time_days: z
      .number()
      .int("lead_time_days must be an integer")
      .nonnegative("lead_time_days must be 0 or greater")
      .optional()
      .nullable(),

    /**
     * Updated supplier-side product name. Send null to clear the value.
     * Max 255 chars to match the VARCHAR(255) column.
     */
    supplier_product_name: z
      .string()
      .trim()
      .max(255, "supplier_product_name must be 255 characters or fewer")
      .optional()
      .nullable(),

    /**
     * Updated supplier SKU. Send null to clear the value.
     * Max 100 chars to match the VARCHAR(100) column.
     */
    supplier_sku: z
      .string()
      .trim()
      .max(100, "supplier_sku must be 100 characters or fewer")
      .optional()
      .nullable(),
  })
  .refine(
    (data) =>
      data.cost_price !== undefined ||
      data.lead_time_days !== undefined ||
      data.supplier_product_name !== undefined ||
      data.supplier_sku !== undefined,
    {
      message:
        "At least one of cost_price, lead_time_days, supplier_product_name, or supplier_sku must be provided",
    }
  );

// ─────────────────────────────────────────────
// Inferred TypeScript types
// ─────────────────────────────────────────────
export type CreateSupplierProductInput = z.infer<typeof createSupplierProductSchema>;
export type UpdateSupplierProductInput = z.infer<typeof updateSupplierProductSchema>;
