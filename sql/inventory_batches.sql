create table public.inventory_batches (
  id uuid not null default extensions.uuid_generate_v4 (),
  product_variant_id uuid not null,
  supplier_id uuid null,
  shipment_id uuid null,
  quantity integer not null,
  remaining_quantity integer not null,
  unit_cost numeric(12, 2) null,
  landed_cost numeric(12, 2) null,
  created_at timestamp with time zone null default now(),
  tax_amount numeric(12, 2) null,
  constraint inventory_batches_pkey primary key (id),
  constraint inventory_batches_product_variant_id_fkey foreign KEY (product_variant_id) references product_variants (id),
  constraint inventory_batches_shipment_id_fkey foreign KEY (shipment_id) references supplier_shipments (id),
  constraint inventory_batches_supplier_id_fkey foreign KEY (supplier_id) references suppliers (id)
) TABLESPACE pg_default;
