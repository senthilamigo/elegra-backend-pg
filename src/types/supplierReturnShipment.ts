/**
 * File: src/types/supplierReturnShipment.ts
 * Path: src/types/supplierReturnShipment.ts
 *
 * TypeScript interfaces for the supplier return shipment workflow.
 *
 * A supplier return shipment tracks the physical shipment of goods being
 * returned from the seller back to the supplier. This is distinct from:
 *   - supplier_shipments      — inbound shipments FROM supplier TO seller
 *   - supplier_replacements   — replacements sent back BY supplier TO seller
 *
 * Tables covered by these types:
 *   - supplier_return_shipments        — the return shipment header
 *   - supplier_return_shipment_items   — line items (one per inventory batch)
 *   - return_shipment_cost_allocations — proportional shipping cost per batch
 *
 * Relationship chain:
 *   supplier_returns
 *     └── supplier_return_shipments   (via return_id)
 *           └── supplier_return_shipment_items  (via shipment_id)
 *           └── return_shipment_cost_allocations (via shipment_id + batch)
 *
 * Status lifecycle for supplier_return_shipments:
 *   in_transit → delivered
 */

// ─────────────────────────────────────────────
// Status enum
// ─────────────────────────────────────────────

/**
 * Lifecycle states for a supplier_return_shipments record.
 *   in_transit — goods have been dispatched to the supplier
 *   delivered  — supplier has confirmed receipt of the return
 */
export type SupplierReturnShipmentStatus = "in_transit" | "delivered";

// ─────────────────────────────────────────────
// supplier_return_shipments row
// ─────────────────────────────────────────────

/**
 * Mirrors every column in the supplier_return_shipments table.
 *
 * Columns:
 *   id               UUID PRIMARY KEY
 *   return_id        UUID REFERENCES supplier_returns(id) ON DELETE CASCADE
 *   supplier_id      UUID REFERENCES suppliers(id)
 *   courier_name     VARCHAR(100)   — optional carrier name
 *   tracking_number  VARCHAR(100)   — optional tracking reference
 *   shipment_date    TIMESTAMPTZ    — when goods were dispatched (nullable until known)
 *   delivery_date    TIMESTAMPTZ    — when supplier received the goods (nullable)
 *   shipping_cost    NUMERIC(12,2)  — total courier cost for this return leg
 *   status           VARCHAR(50)    — 'in_transit' | 'delivered'
 *   created_at       TIMESTAMPTZ
 */
export interface SupplierReturnShipment {
  id:              string;
  return_id:       string;        // FK → supplier_returns.id
  supplier_id:     string;        // FK → suppliers.id
  courier_name:    string | null;
  tracking_number: string | null;
  shipment_date:   string | null; // ISO timestamp
  delivery_date:   string | null; // ISO timestamp
  shipping_cost:   number | null; // NUMERIC(12,2)
  status:          SupplierReturnShipmentStatus | null;
  created_at:      string;
}

// ─────────────────────────────────────────────
// supplier_return_shipment_items row
// ─────────────────────────────────────────────

/**
 * Mirrors every column in the supplier_return_shipment_items table.
 * Each row represents one inventory batch being physically returned in
 * a single supplier_return_shipments record.
 *
 * Columns:
 *   id                  UUID PRIMARY KEY
 *   shipment_id         UUID REFERENCES supplier_return_shipments(id) ON DELETE CASCADE
 *   inventory_batch_id  UUID REFERENCES inventory_batches(id)
 *   quantity            INTEGER — units of that batch being returned
 */
export interface SupplierReturnShipmentItem {
  id:                 string;
  shipment_id:        string; // FK → supplier_return_shipments.id
  inventory_batch_id: string; // FK → inventory_batches.id
  quantity:           number;
}

// ─────────────────────────────────────────────
// return_shipment_cost_allocations row
// ─────────────────────────────────────────────

/**
 * Mirrors every column in the return_shipment_cost_allocations table.
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
  allocated_cost:     number | null; // NUMERIC(12,2)
}

// ─────────────────────────────────────────────
// Enriched response types (joins flattened for API responses)
// ─────────────────────────────────────────────

/**
 * SupplierReturnShipment enriched with joined context from:
 *   - supplier_returns  (reason, status, seller_id)
 *   - suppliers         (name, status)
 * Used as the shape returned by list/get endpoints.
 */
export interface SupplierReturnShipmentWithContext extends SupplierReturnShipment {
  supplier_returns?: {
    id:          string;
    supplier_id: string;
    seller_id:   string;
    reason:      string | null;
    status:      string | null;
  } | null;
  suppliers?: {
    id:     string;
    name:   string;
    status: string | null;
  } | null;
}
