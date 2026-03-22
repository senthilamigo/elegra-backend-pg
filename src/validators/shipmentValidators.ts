/**
 * File: src/validators/shipmentValidators.ts
 * Path: ecommerce-admin/src/validators/shipmentValidators.ts
 *
 * Zod schemas for shipment request bodies.
 *
 * Shipment table columns:
 *   id, order_id, shipment_date, address_id
 */

import { z } from "zod";

const uuidSchema = z.string().uuid("Must be a valid UUID");

// ─────────────────────────────────────────────
// POST /api/shipments — create shipment
// ─────────────────────────────────────────────

/**
 * shipment_date is optional at creation — a shipment may be scheduled
 * before the exact dispatch time is known.
 */
export const createShipmentSchema = z.object({
  order_id:      uuidSchema,
  address_id:    uuidSchema,
  shipment_date: z
    .string()
    .datetime({ message: "shipment_date must be a valid ISO 8601 datetime string" })
    .optional()
    .nullable(),
});

// ─────────────────────────────────────────────
// PATCH /api/shipments/:id — update shipment
// ─────────────────────────────────────────────

/**
 * Both fields are optional; at least one must be provided.
 * Allows updating the dispatch date and/or delivery address independently.
 */
export const updateShipmentSchema = z
  .object({
    shipment_date: z
      .string()
      .datetime({ message: "shipment_date must be a valid ISO 8601 datetime string" })
      .optional()
      .nullable(),
    address_id: uuidSchema.optional(),
  })
  .refine(
    (d) => d.shipment_date !== undefined || d.address_id !== undefined,
    { message: "At least one field (shipment_date, address_id) must be provided" }
  );

// ─────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>;
