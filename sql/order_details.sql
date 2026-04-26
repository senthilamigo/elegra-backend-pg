create table public.order_details (
  id uuid not null default extensions.uuid_generate_v4 (),
  order_id uuid not null,
  product_id uuid not null,
  quantity integer not null,
  unit_price numeric(12, 2) not null,
  inventory_batch_id uuid null,
  selling_price numeric(12, 2) null,
  constraint order_details_pkey primary key (id),
  constraint fk_order_details_product_variant foreign KEY (product_id) references product_variants (id) on delete RESTRICT,
  constraint order_details_inventory_batch_id_fkey foreign KEY (inventory_batch_id) references inventory_batches (id),
  constraint order_details_order_id_fkey foreign KEY (order_id) references orders (id) on delete CASCADE
) TABLESPACE pg_default;
