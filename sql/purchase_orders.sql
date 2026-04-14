CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id UUID NOT NULL
        REFERENCES sellers(id),
    supplier_id UUID NOT NULL
        REFERENCES suppliers(id),
    status VARCHAR(50) DEFAULT 'pending', -- pending, shipped, received
    order_date TIMESTAMPTZ DEFAULT now(),
    expected_delivery_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);
