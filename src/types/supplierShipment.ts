/**
 * File: src/types/supplierShipment.ts
 * Path: src/types/supplierShipment.ts
 *
 * TypeScript interfaces for supplier shipment creation.
 *
 * Tables represented:
 *   - supplier_shipments
 *   - supplier_shipment_items
 *   - inventory_batches
 *   - shipment_cost_allocations
 */

export type SupplierShipmentStatus = "in_transit" | "delivered";

export interface SupplierShipment {
  id: string;
  supplier_id: string;
  purchase_order_id: string | null;
  courier_name: string | null;
  tracking_number: string | null;
  shipment_date: string | null;
  delivery_date: string | null;
  shipping_cost: number | null;
  status: SupplierShipmentStatus | null;
  created_at: string;
}

export interface SupplierShipmentItem {
  id: string;
  shipment_id: string;
  product_variant_id: string;
  quantity: number;
}

export interface InventoryBatch {
  id: string;
  product_variant_id: string;
  supplier_id: string | null;
  shipment_id: string | null;
  quantity: number;
  remaining_quantity: number;
  unit_cost: number | null;
  landed_cost: number | null;
  created_at: string;
}

export interface ShipmentCostAllocation {
  id: string;
  shipment_id: string;
  inventory_batch_id: string;
  allocated_cost: number | null;
}
