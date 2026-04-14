CREATE TABLE supplier_return_shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    return_id UUID NOT NULL
        REFERENCES supplier_returns(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL
        REFERENCES suppliers(id),
    courier_name VARCHAR(100),
    tracking_number VARCHAR(100),
    shipment_date TIMESTAMPTZ,
    delivery_date TIMESTAMPTZ,
    shipping_cost NUMERIC(12,2), -- TOTAL outbound courier cost
    status VARCHAR(50), -- in_transit, delivered
    created_at TIMESTAMPTZ DEFAULT now()
);
