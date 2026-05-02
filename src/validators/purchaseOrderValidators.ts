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
 * Schema changes (May 2026):
 *   Added tax fields (cgst_percent, sgst_percent, igst_percent,
 *   cgst_amount, sgst_amount, igst_amount) and discount fields
 *   (discount_type, discount_value, discount_amount) on each line item.
 *   The API accepts the percent/type/value inputs; the controller
 *   computes the derived amounts and effective_unit_cost before persisting.
 */

import { z } from "zod";

const uuidSchema = z.string().uuid("Must be a valid UUID");

// ---------------------------------------------------------------------------
// Status enum
// ---------------------------------------------------------------------------

export const purchaseOrderStatusSchema = z.enum(["pending", "shipped", "received"], {
  errorMap: () => ({ message: "status must be 'pending', 'shipped', or 'received'" }),
});

// ---------------------------------------------------------------------------
// Line-item sub-schema
//
// Callers supply the raw tax percentages and discount inputs.
// The controller derives:
//   taxable_value    = quantity × unit_cost
//   cgst_amount      = taxable_value × cgst_percent / 100
//   sgst_amount      = taxable_value × sgst_percent / 100
//   igst_amount      = taxable_value × igst_percent / 100
//   discount_amount  = (discount_type === 'percentage')
//                        ? unit_cost × quantity × (discount_value / 100)
//                        : discount_value   (flat)
//   effective_unit_cost = (total_cost - discount_amount + tax_amount) / quantity
//
// All tax/discount fields are optional; they default to null (zero effect).
// ---------------------------------------------------------------------------

const purchaseOrderItemSchema = z.object({
  /** UUID of the product_variants row being ordered */
  product_variant_id: uuidSchema,

  /** Number of units ordered — must be a positive integer */
  quantity: z
    .number()
    .int("quantity must be an integer")
    .positive("quantity must be greater than 0"),

  /**
   * Per-unit procurement cost agreed with the supplier.
   * Optional at creation; can be updated later if not yet confirmed.
   */
  unit_cost: z
    .number()
    .nonnegative("unit_cost cannot be negative")
    .optional()
    .nullable(),

  // ── Tax rates (percentage) ──────────────────────────────────────────────

  /**
   * Central GST rate as a percentage (e.g. 9 = 9%).
   * NUMERIC(5,2) in the DB — at most 3 integer + 2 decimal digits.
   */
  cgst_percent: z
    .number()
    .min(0, "cgst_percent cannot be negative")
    .max(100, "cgst_percent cannot exceed 100")
    .optional()
    .nullable(),

  /**
   * State GST rate as a percentage (e.g. 9 = 9%).
   * NUMERIC(5,2) in the DB.
   */
  sgst_percent: z
    .number()
    .min(0, "sgst_percent cannot be negative")
    .max(100, "sgst_percent cannot exceed 100")
    .optional()
    .nullable(),

  /**
   * Integrated GST rate as a percentage (e.g. 18 = 18%).
   * Typically used for inter-state supply instead of CGST + SGST.
   * NUMERIC(5,2) in the DB.
   */
  igst_percent: z
    .number()
    .min(0, "igst_percent cannot be negative")
    .max(100, "igst_percent cannot exceed 100")
    .optional()
    .nullable(),

  // ── Discount ────────────────────────────────────────────────────────────

  /**
   * Discount method applied to this line item.
   *   'percentage' — discount_value is a percentage of the line total
   *   'flat'       — discount_value is an absolute amount in INR
   */
  discount_type: z
    .enum(["percentage", "flat"], {
      errorMap: () => ({ message: "discount_type must be 'percentage' or 'flat'" }),
    })
    .optional()
    .nullable(),

  /**
   * Numeric value for the discount — interpreted according to discount_type.
   * For 'percentage': value in 0–100 range.
   * For 'flat': absolute INR amount (>= 0).
   */
  discount_value: z
    .number()
    .nonnegative("discount_value cannot be negative")
    .optional()
    .nullable(),
})
// Cross-field validation: discount_type and discount_value must both be
// present or both absent. A type without a value (or vice versa) is invalid.
.refine(
  (d) => {
    const hasType  = d.discount_type  != null;
    const hasValue = d.discount_value != null;
    return hasType === hasValue;
  },
  {
    message: "discount_type and discount_value must both be provided together, or both omitted",
    path: ["discount_type"],
  }
)
// For 'percentage' discounts the value must be ≤ 100
.refine(
  (d) => !(d.discount_type === "percentage" && (d.discount_value ?? 0) > 100),
  {
    message: "discount_value cannot exceed 100 when discount_type is 'percentage'",
    path: ["discount_value"],
  }
);

// ---------------------------------------------------------------------------
// POST /api/purchase-orders
// ---------------------------------------------------------------------------

export const createPurchaseOrderSchema = z.object({
  /** UUID of the supplier fulfilling this order */
  supplier_id: uuidSchema,

  /**
   * UUID of the seller placing the order.
   * Required for admin callers who need to specify which seller's PO this is.
   * Ignored for non-admin sellers (resolved from the JWT instead).
   */
  seller_id: uuidSchema.optional(),

  /** ISO 8601 datetime for the expected delivery — optional at creation */
  expected_delivery_date: z.string().datetime().optional().nullable(),

  /** Line items — at least one product variant must be ordered */
  items: z
    .array(purchaseOrderItemSchema)
    .min(1, "At least one purchase order item is required"),
});

// ---------------------------------------------------------------------------
// PUT /api/purchase-orders/:id/status
// ---------------------------------------------------------------------------

export const updatePurchaseOrderStatusSchema = z.object({
  status: purchaseOrderStatusSchema,
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type PurchaseOrderItemInput        = z.infer<typeof purchaseOrderItemSchema>;
export type CreatePurchaseOrderInput      = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderStatusInput = z.infer<typeof updatePurchaseOrderStatusSchema>;
