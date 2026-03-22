/**
 * File: src/types/shipment.ts
 * Path: ecommerce-admin/src/types/shipment.ts
 *
 * TypeScript interfaces mirroring the shipment table.
 *
 * shipment table columns (as specified):
 *   id             UUID PRIMARY KEY
 *   shipment_date  TIMESTAMPTZ
 *   address_id     UUID REFERENCES address(id)
 *
 * The relationship to orders is stored on the orders side:
 *   orders.shipment_id UUID REFERENCES shipment(id)
 *
 * When creating a shipment (POST /api/shipments), the controller accepts
 * order_id in the request body and updates orders.shipment_id after insert.
 * order_id is NOT a column on the shipment table itself.
 *
 * NOTE: The SHIPMENT_SELECT query also fetches order_id via a reverse lookup
 * so the fetchShipment helper can enforce ownership. This is a runtime
 * join result field, not a physical column on the shipment table.
 */

export interface Shipment {
  id:            string;        // UUID PRIMARY KEY
  shipment_date: string | null; // TIMESTAMPTZ — nullable until dispatched
  address_id:    string;        // UUID FK → address(id)
}

/**
 * Shipment enriched with joined address details and the resolved order_id.
 * order_id comes from the SHIPMENT_SELECT join context (not a DB column on shipment)
 * and is used for ownership checks.
 */
export interface ShipmentWithAddress extends Shipment {
  order_id: string | null;  // resolved via orders.shipment_id join — used for ownership checks
  address: {
    id:             string;
    street_address: string;
    city:           string;
    state:          string;
    pin_code:       string;
    country:        string;
    land_mark:      string | null;
    address_type:   string;
  } | null;
}
