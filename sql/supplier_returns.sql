CREATE TABLE supplier_returns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL
        REFERENCES suppliers(id),
    seller_id UUID NOT NULL
        REFERENCES sellers(id),
    reason VARCHAR(100), -- damaged, unsold
    status VARCHAR(50), -- initiated, shipped, completed
    created_at TIMESTAMPTZ DEFAULT now()
);
