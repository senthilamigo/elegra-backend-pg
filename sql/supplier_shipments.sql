CREATE TABLE supplier_shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL
        REFERENCES suppliers(id),
    purchase_order_id UUID
        REFERENCES purchase_orders(id),
    courier_name VARCHAR(100),
    tracking_number VARCHAR(100),
    shipment_date TIMESTAMPTZ,
    delivery_date TIMESTAMPTZ,
    shipping_cost NUMERIC(12,2),
    status VARCHAR(50), -- in_transit, delivered
    created_at TIMESTAMPTZ DEFAULT now()
);
