/**
 * File: src/validators/supplierShipmentValidators.ts
 * Path: src/validators/supplierShipmentValidators.ts
 *
 * Zod schemas for supplier shipment endpoints.
 *
 * Endpoint covered:
 *   - POST /api/supplier-shipments
 *
 * Workflow validated by this schema:
 *   1) Create supplier_shipments row
 *   2) Create supplier_shipment_items rows
 *   3) Create inventory_batches rows from received quantities and PO unit costs
 *   4) Allocate shipping cost across inventory batches
 */

import { z } from "zod";

const uuidSchema = z.string().uuid("Must be a valid UUID");

export const createSupplierShipmentSchema = z.object({
  purchase_order_id: uuidSchema,
  courier_name: z.string().max(100).optional().nullable(),
  tracking_number: z.string().max(100).optional().nullable(),
  shipment_date: z.string().datetime().optional().nullable(),
  delivery_date: z.string().datetime().optional().nullable(),
  shipping_cost: z.number().nonnegative("shipping_cost cannot be negative").default(0),
  status: z
    .enum(["in_transit", "delivered"], {
      errorMap: () => ({ message: "status must be 'in_transit' or 'delivered'" }),
    })
    .default("in_transit"),
  items: z
    .array(
      z.object({
        product_variant_id: uuidSchema,
        quantity: z.number().int().positive("quantity must be greater than 0"),
      })
    )
    .min(1, "At least one shipment item is required"),
});

export type CreateSupplierShipmentInput = z.infer<typeof createSupplierShipmentSchema>;
