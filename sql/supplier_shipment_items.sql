CREATE TABLE supplier_shipment_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL
        REFERENCES supplier_shipments(id) ON DELETE CASCADE,
    product_variant_id UUID NOT NULL
        REFERENCES product_variants(id),
    quantity INTEGER NOT NULL
);
