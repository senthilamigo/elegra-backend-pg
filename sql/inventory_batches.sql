CREATE TABLE inventory_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_variant_id UUID NOT NULL
        REFERENCES product_variants(id),
    supplier_id UUID
        REFERENCES suppliers(id),
    shipment_id UUID
        REFERENCES supplier_shipments(id),
    quantity INTEGER NOT NULL,
    remaining_quantity INTEGER NOT NULL,
    unit_cost NUMERIC(12,2),
    landed_cost NUMERIC(12,2), -- includes courier allocation
    created_at TIMESTAMPTZ DEFAULT now()
);
