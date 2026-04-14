CREATE TABLE purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_order_id UUID NOT NULL
        REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_variant_id UUID NOT NULL
        REFERENCES product_variants(id),
    quantity INTEGER NOT NULL,
    unit_cost NUMERIC(12,2),
    received_quantity INTEGER DEFAULT 0
);
