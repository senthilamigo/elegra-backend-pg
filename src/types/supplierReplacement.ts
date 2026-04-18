/**
 * File: src/types/supplierReplacement.ts
 * Path: src/types/supplierReplacement.ts
 *
 * TypeScript interfaces for the supplier replacement workflow.
 *
 * A replacement is initiated against an existing supplier_returns record.
 * The workflow creates:
 *   1. A supplier_replacements record linking the return to an inbound
 *      supplier_return_shipments shipment.
 *   2. A supplier_return_shipments row describing the physical shipment
 *      carrying the replacement goods back from the supplier.
 *   3. supplier_return_shipment_items rows — one per inventory batch being
 *      replaced.
 *   4. return_shipment_cost_allocations rows that distribute the outbound
 *      shipping cost proportionally across the replacement items.
 *
 * Tables covered:
 *   - supplier_replacements
 *   - supplier_return_shipments
 *   - supplier_return_shipment_items
 *   - return_shipment_cost_allocations
 */

// ─────────────────────────────────────────────
// Replacement status enum
// ─────────────────────────────────────────────

/**
 * Lifecycle states for a supplier_replacements record.
 *   pending    — replacement requested, shipment not yet dispatched
 *   in_transit — replacement shipment is on its way
 *   completed  — replacement goods received and stocked
 */
export type SupplierReplacementStatus = "pending" | "in_transit" | "completed";

// ─────────────────────────────────────────────
// supplier_replacements row
// ─────────────────────────────────────────────

/**
 * Mirrors every column in the supplier_replacements table.
 *
 * Columns:
 *   id          UUID PRIMARY KEY
 *   return_id   UUID REFERENCES supplier_returns(id)
 *   shipment_id UUID REFERENCES supplier_return_shipments(id)  — nullable until
 *               the replacement shipment is recorded
 *   status      VARCHAR(50)   — 'pending' | 'in_transit' | 'completed'
 *   created_at  TIMESTAMPTZ
 */
export interface SupplierReplacement {
  id:          string;
  return_id:   string;       // FK → supplier_returns.id
  shipment_id: string | null; // FK → supplier_return_shipments.id; null until shipment recorded
  status:      SupplierReplacementStatus | null;
  created_at:  string;
}

// ─────────────────────────────────────────────
// supplier_return_shipments row
// ─────────────────────────────────────────────

/**
 * Mirrors the supplier_return_shipments table.
 * This table tracks physical shipments that carry replacement goods from
 * the supplier back to the seller.
 *
 * Columns:
 *   id               UUID PRIMARY KEY
 *   return_id        UUID REFERENCES supplier_returns(id)
 *   supplier_id      UUID REFERENCES suppliers(id)
 *   courier_name     VARCHAR(100)
 *   tracking_number  VARCHAR(100)
 *   shipment_date    TIMESTAMPTZ  — when the shipment was dispatched
 *   delivery_date    TIMESTAMPTZ  — when the shipment arrived
 *   shipping_cost    NUMERIC(12,2) — total outbound courier cost for this leg
 *   status           VARCHAR(50)   — 'in_transit' | 'delivered'
 *   created_at       TIMESTAMPTZ
 */
export interface SupplierReturnShipment {
  id:              string;
  return_id:       string;       // FK → supplier_returns.id
  supplier_id:     string;       // FK → suppliers.id
  courier_name:    string | null;
  tracking_number: string | null;
  shipment_date:   string | null;
  delivery_date:   string | null;
  shipping_cost:   number | null;
  status:          string | null;  // 'in_transit' | 'delivered'
  created_at:      string;
}

// ─────────────────────────────────────────────
// supplier_return_shipment_items row
// ─────────────────────────────────────────────

/**
 * Mirrors the supplier_return_shipment_items table.
 * Each row represents one inventory_batch being returned / replaced within
 * a single supplier_return_shipments record.
 *
 * Columns:
 *   id                  UUID PRIMARY KEY
 *   shipment_id         UUID REFERENCES supplier_return_shipments(id)
 *   inventory_batch_id  UUID REFERENCES inventory_batches(id)
 *   quantity            INTEGER
 */
export interface SupplierReturnShipmentItem {
  id:                 string;
  shipment_id:        string;  // FK → supplier_return_shipments.id
  inventory_batch_id: string;  // FK → inventory_batches.id
  quantity:           number;
}

// ─────────────────────────────────────────────
// return_shipment_cost_allocations row
// ─────────────────────────────────────────────

/**
 * Mirrors the return_shipment_cost_allocations table.
 * Distributes the total shipping_cost of a return shipment proportionally
 * across the inventory batches carried in that shipment.
 *
 * Columns:
 *   id                  UUID PRIMARY KEY
 *   shipment_id         UUID REFERENCES supplier_return_shipments(id)
 *   inventory_batch_id  UUID REFERENCES inventory_batches(id)
 *   allocated_cost      NUMERIC(12,2)
 */
export interface ReturnShipmentCostAllocation {
  id:                 string;
  shipment_id:        string;       // FK → supplier_return_shipments.id
  inventory_batch_id: string;       // FK → inventory_batches.id
  allocated_cost:     number | null;
}
