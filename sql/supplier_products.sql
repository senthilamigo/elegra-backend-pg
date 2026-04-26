create table public.supplier_products (
  id uuid not null default extensions.uuid_generate_v4 (),
  supplier_id uuid not null,
  product_id uuid not null,
  cost_price numeric(12, 2) null,
  lead_time_days integer null,
  created_at timestamp with time zone null default now(),
  supplier_product_name character varying(255) null,
  supplier_sku character varying(100) null,
  constraint supplier_products_pkey primary key (id),
  constraint supplier_products_supplier_id_product_id_key unique (supplier_id, product_id),
  constraint supplier_products_product_id_fkey foreign KEY (product_id) references products (id) on delete CASCADE,
  constraint supplier_products_supplier_id_fkey foreign KEY (supplier_id) references suppliers (id) on delete CASCADE
) TABLESPACE pg_default;
