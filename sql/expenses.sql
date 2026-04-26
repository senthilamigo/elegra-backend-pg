CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id UUID NOT NULL
        REFERENCES sellers(id),
    title VARCHAR(255),
    description TEXT,
    amount NUMERIC(12,2) NOT NULL,
    expense_type VARCHAR(50), 
    -- travel, stall, logistics, misc
    expense_date DATE NOT NULL,
    created_by UUID 
        REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);