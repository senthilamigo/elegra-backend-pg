CREATE TABLE supplier_return_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    return_id UUID NOT NULL
        REFERENCES supplier_returns(id) ON DELETE CASCADE,
    inventory_batch_id UUID NOT NULL
        REFERENCES inventory_batches(id),
    quantity INTEGER NOT NULL
);
