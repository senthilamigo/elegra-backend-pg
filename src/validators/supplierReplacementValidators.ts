/**
 * File: src/validators/supplierReplacementValidators.ts
 * Path: src/validators/supplierReplacementValidators.ts
 *
 * Zod request validation schemas for supplier replacement endpoints.
 *
 * Endpoints validated:
 *   - POST /api/supplier-replacements   (Record Replacement — creates the return
 *     shipment + cost allocations in one atomic operation)
 *   - POST /api/supplier-replacements   (Create replacement record only)
 *   - GET  /api/supplier-replacements   (list — no body to validate)
 *
 * Design notes:
 *   - recordReplacementShipmentSchema  — the "full" creation path that inserts
 *     supplier_return_shipments, supplier_return_shipment_items,
 *     return_shipment_cost_allocations, and links them via supplier_replacements.
 *   - createSupplierReplacementSchema  — the lightweight path that only records
 *     the supplier_replacements row (optionally linking an existing shipment).
 *   - Both schemas share the same route path; the caller signals intent by
 *     including or omitting the `shipment` sub-object.
 *   - The route layer differentiates the two operations: when `shipment` is
 *     present the controller executes the full transaction; otherwise it
 *     creates the replacement record only.
 */

import { z } from "zod";

// ─────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────

const uuidSchema = z.string().uuid("Must be a valid UUID");

/**
 * Valid status values for supplier_replacements.
 * Mirrors the application-level enum enforced by the controller.
 */
export const replacementStatusEnum = z.enum(["pending", "in_transit", "completed"], {
  errorMap: () => ({
    message: "status must be 'pending', 'in_transit', or 'completed'",
  }),
});

/**
 * Valid status values for supplier_return_shipments.
 * Mirrors the same enum used in supplierReturnController.ts.
 */
export const returnShipmentStatusEnum = z.enum(["in_transit", "delivered"], {
  errorMap: () => ({
    message: "status must be 'in_transit' or 'delivered'",
  }),
});

// ─────────────────────────────────────────────
// Schema: one line-item inside the replacement shipment
// ─────────────────────────────────────────────

/**
 * Each item references an inventory_batch and declares how many units
 * are being included in this replacement shipment.
 */
const replacementShipmentItemSchema = z.object({
  inventory_batch_id: uuidSchema,

  /**
   * Number of units being replaced for this batch.
   * Must be a positive integer — zero-quantity lines are rejected.
   */
  quantity: z
    .number()
    .int("quantity must be an integer")
    .positive("quantity must be greater than 0"),
});

// ─────────────────────────────────────────────
// Schema: the embedded shipment sub-object
// ─────────────────────────────────────────────

/**
 * Describes the physical supplier_return_shipment that carries the
 * replacement goods. Used inside recordReplacementShipmentSchema.
 *
 * shipping_cost defaults to 0 so callers can omit it when the cost is
 * not yet known; it can be recomputed later via the costs endpoints.
 */
const replacementShipmentSchema = z.object({
  /** Forwarded to supplier_return_shipments.courier_name */
  courier_name: z.string().max(100).optional().nullable(),

  /** Forwarded to supplier_return_shipments.tracking_number */
  tracking_number: z.string().max(100).optional().nullable(),

  /** ISO 8601 datetime string for when the shipment was dispatched */
  shipment_date: z
    .string()
    .datetime({ message: "shipment_date must be a valid ISO 8601 datetime string" })
    .optional()
    .nullable(),

  /** ISO 8601 datetime string for when the shipment is expected to arrive */
  delivery_date: z
    .string()
    .datetime({ message: "delivery_date must be a valid ISO 8601 datetime string" })
    .optional()
    .nullable(),

  /**
   * Total courier cost for this replacement shipment leg.
   * Defaults to 0. This cost is distributed across the line items via
   * return_shipment_cost_allocations.
   */
  shipping_cost: z
    .number()
    .nonnegative("shipping_cost cannot be negative")
    .default(0),

  /** Lifecycle status of the shipment */
  status: returnShipmentStatusEnum.default("in_transit"),

  /**
   * Line items — must contain at least one entry.
   * Duplicate inventory_batch_id values within a single request are
   * rejected at the controller level after this schema runs.
   */
  items: z
    .array(replacementShipmentItemSchema)
    .min(1, "At least one shipment item is required"),
});

// ─────────────────────────────────────────────
// POST /api/supplier-replacements (Record Replacement)
// ─────────────────────────────────────────────

/**
 * Full transaction body:
 *   1. Inserts supplier_return_shipments + items
 *   2. Allocates shipping cost
 *   3. Creates / updates supplier_replacements linking the two
 *
 * Required fields:
 *   - return_id  — the existing supplier_return this replacement covers
 *   - shipment   — the physical shipment details (see replacementShipmentSchema)
 *
 * Optional:
 *   - status     — initial status for the supplier_replacements record
 *     (defaults to 'in_transit' when a shipment is being recorded)
 */
export const recordReplacementShipmentSchema = z.object({
  /**
   * UUID of the supplier_returns record being fulfilled.
   * The controller validates that this return exists and that the
   * caller has permission to access it.
   */
  return_id: uuidSchema,

  /**
   * Optional initial status for the supplier_replacements record.
   * When omitted, the controller defaults to 'in_transit' because a
   * shipment is being recorded simultaneously.
   */
  status: replacementStatusEnum.optional(),

  /**
   * Physical shipment carrying the replacement goods from the supplier.
   */
  shipment: replacementShipmentSchema,
});

// ─────────────────────────────────────────────
// POST /api/supplier-replacements (Create replacement only)
// ─────────────────────────────────────────────

/**
 * Lightweight creation path: records a supplier_replacements row without
 * immediately attaching a shipment.
 *
 * Used when the replacement has been agreed with the supplier but the
 * physical shipment has not yet been dispatched.
 *
 * Required fields:
 *   - return_id  — the existing supplier_return this replacement covers
 *
 * Optional:
 *   - shipment_id — UUID of an already-existing supplier_return_shipments
 *     row if you want to link to a pre-existing shipment record
 *   - status      — defaults to 'pending'
 */
export const createSupplierReplacementSchema = z.object({
  /** UUID of the supplier_returns record being fulfilled */
  return_id: uuidSchema,

  /**
   * Optional FK to an existing supplier_return_shipments record.
   * When supplied the row is linked immediately; omit to leave unlinked.
   */
  shipment_id: uuidSchema.optional().nullable(),

  /** Initial status — defaults to 'pending' when no shipment is attached */
  status: replacementStatusEnum.default("pending"),
});

// ─────────────────────────────────────────────
// Inferred TypeScript types
// ─────────────────────────────────────────────

export type RecordReplacementShipmentInput = z.infer<typeof recordReplacementShipmentSchema>;
export type CreateSupplierReplacementInput = z.infer<typeof createSupplierReplacementSchema>;
