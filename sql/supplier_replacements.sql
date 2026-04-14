CREATE TABLE supplier_replacements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    return_id UUID NOT NULL
        REFERENCES supplier_returns(id),
    shipment_id UUID
        REFERENCES supplier_shipments(id),
    status VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT now()
);
