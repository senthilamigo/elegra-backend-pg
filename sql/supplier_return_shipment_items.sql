CREATE TABLE supplier_return_shipment_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL
        REFERENCES supplier_return_shipments(id) ON DELETE CASCADE,
    inventory_batch_id UUID NOT NULL
        REFERENCES inventory_batches(id),
    quantity INTEGER NOT NULL
);
