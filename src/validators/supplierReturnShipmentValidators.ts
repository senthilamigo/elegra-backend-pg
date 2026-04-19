/**
 * File: src/validators/supplierReturnShipmentValidators.ts
 * Path: src/validators/supplierReturnShipmentValidators.ts
 *
 * Zod request validation schemas for supplier return shipment endpoints.
 *
 * Endpoints validated:
 *   - POST /api/supplier-return-shipments   — createSupplierReturnShipmentSchema
 *   - GET  /api/supplier-return-shipments   — no body (query params only)
 *   - GET  /api/supplier-return-shipments/:id — no body
 *
 * Validation goals:
 *   - Ensure return_id is a valid UUID referencing an existing supplier_return.
 *   - Ensure at least one item is present in the items array.
 *   - Ensure each item references a valid inventory_batch_id UUID.
 *   - Ensure quantities are positive integers.
 *   - Enforce no duplicate inventory_batch_id values within a single request
 *     (duplicate check is performed at the controller level after schema runs,
 *     consistent with how supplierReturnController.ts handles it).
 *   - Accept optional shipment metadata fields with appropriate type constraints.
 *   - shipping_cost defaults to 0 when not supplied.
 *
 * Design note:
 *   The schema models the full transactional POST body in a single flat object
 *   rather than a nested sub-object. This differs from the approach taken by
 *   recordReplacementShipmentSchema (which nests a `shipment` key) because
 *   these endpoints have a dedicated route per operation and do not need a
 *   dispatcher pattern to differentiate two code paths on the same path+method.
 */

import { z } from "zod";

// ─────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────

const uuidSchema = z.string().uuid("Must be a valid UUID");

/**
 * Valid status values for a supplier_return_shipments record.
 * Matches the application-level enum used in the controller and type file.
 */
export const supplierReturnShipmentStatusEnum = z.enum(["in_transit", "delivered"], {
  errorMap: () => ({
    message: "status must be 'in_transit' or 'delivered'",
  }),
});

// ─────────────────────────────────────────────
// Line item sub-schema
// ─────────────────────────────────────────────

/**
 * Validates a single return shipment line item.
 * Each item maps one inventory batch to a quantity being physically returned.
 */
const returnShipmentItemSchema = z.object({
  /**
   * UUID of the inventory_batches row whose stock is being returned.
   * The controller validates that this batch:
   *   (a) exists,
   *   (b) belongs to the same supplier as the linked supplier_return,
   *   (c) has sufficient remaining_quantity.
   */
  inventory_batch_id: uuidSchema,

  /**
   * Number of units from this batch being included in the return shipment.
   * Must be a positive integer — zero-quantity lines are rejected.
   */
  quantity: z
    .number()
    .int("quantity must be an integer")
    .positive("quantity must be greater than 0"),
});

// ─────────────────────────────────────────────
// POST /api/supplier-return-shipments
// ─────────────────────────────────────────────

/**
 * Full transactional body for creating a return shipment.
 *
 * The controller executes the following within a compensating-rollback
 * transaction pattern (matching the approach used across supplier* controllers):
 *   1. INSERT supplier_return_shipments
 *   2. INSERT supplier_return_shipment_items (one per item)
 *   3. Calculate total quantity
 *   4. INSERT return_shipment_cost_allocations (proportional cost distribution)
 *
 * Required fields:
 *   - return_id — existing supplier_returns record this shipment fulfils
 *   - items     — one or more line items (inventory batch + quantity)
 *
 * Optional fields (all nullable, sensible defaults where applicable):
 *   - courier_name, tracking_number, shipment_date, delivery_date
 *   - shipping_cost (defaults to 0)
 *   - status        (defaults to 'in_transit')
 */
export const createSupplierReturnShipmentSchema = z.object({
  /**
   * UUID of the supplier_returns record this shipment belongs to.
   * The controller validates existence and seller-level access.
   */
  return_id: uuidSchema,

  /**
   * Name of the courier/carrier (e.g., "FedEx", "Blue Dart").
   * Optional — may not be known at the time of creation.
   */
  courier_name: z
    .string()
    .trim()
    .max(100, "courier_name must be 100 characters or fewer")
    .optional()
    .nullable(),

  /**
   * Carrier-assigned tracking reference.
   * Optional — may not be assigned until the shipment is booked.
   */
  tracking_number: z
    .string()
    .trim()
    .max(100, "tracking_number must be 100 characters or fewer")
    .optional()
    .nullable(),

  /**
   * ISO 8601 datetime string for when the return goods were dispatched.
   * Optional — can be set when the shipment is created or updated later.
   */
  shipment_date: z
    .string()
    .datetime({ message: "shipment_date must be a valid ISO 8601 datetime string" })
    .optional()
    .nullable(),

  /**
   * ISO 8601 datetime string for when the supplier received the return.
   * Optional — typically filled in after delivery confirmation.
   */
  delivery_date: z
    .string()
    .datetime({ message: "delivery_date must be a valid ISO 8601 datetime string" })
    .optional()
    .nullable(),

  /**
   * Total outbound courier cost for this return shipment.
   * Defaults to 0. This value is distributed proportionally across
   * line items via return_shipment_cost_allocations.
   */
  shipping_cost: z
    .number()
    .nonnegative("shipping_cost cannot be negative")
    .default(0),

  /**
   * Lifecycle status of the return shipment.
   * Defaults to 'in_transit' — shipment just been dispatched.
   */
  status: supplierReturnShipmentStatusEnum.default("in_transit"),

  /**
   * List of inventory batches being returned in this shipment.
   * At least one item is required.
   * Duplicate inventory_batch_id values are rejected at the controller level.
   */
  items: z
    .array(returnShipmentItemSchema)
    .min(1, "At least one return shipment item is required"),
});

// ─────────────────────────────────────────────
// Inferred TypeScript types
// ─────────────────────────────────────────────

export type CreateSupplierReturnShipmentInput = z.infer<typeof createSupplierReturnShipmentSchema>;
