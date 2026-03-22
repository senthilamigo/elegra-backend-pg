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
 */

export interface Shipment {
  id:            string;        // UUID PRIMARY KEY
  shipment_date: string | null; // TIMESTAMPTZ — nullable until dispatched
  address_id:    string;        // UUID FK → address(id)
}

/**
 * Shipment enriched with joined address details for client display.
 */
export interface ShipmentWithAddress extends Shipment {
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
