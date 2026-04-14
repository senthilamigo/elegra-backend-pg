CREATE TABLE return_shipment_cost_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL
        REFERENCES supplier_return_shipments(id),
    inventory_batch_id UUID NOT NULL
        REFERENCES inventory_batches(id),
    allocated_cost NUMERIC(12,2)
);
