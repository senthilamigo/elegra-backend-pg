CREATE TABLE supplier_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL
        REFERENCES suppliers(id) ON DELETE CASCADE,
    product_id UUID NOT NULL
        REFERENCES products(id) ON DELETE CASCADE,
    cost_price NUMERIC(12,2),
    lead_time_days INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (supplier_id, product_id)
);
