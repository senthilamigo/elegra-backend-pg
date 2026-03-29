create table public.product_variants (
  id uuid not null default extensions.uuid_generate_v4 (),
  created_at timestamp with time zone not null default now(),
  product_id uuid not null,
  sku text null,
  color text null,
  size text null,
  material text null,
  attributes jsonb null,
  base_price real null,
  is_active boolean null default true,
  image_url_primary text null,
  images_urls text[] null,
  status text null,
  stock integer null,
  discount_type text null,
  discount_value real null,
  constraint product_variants_pkey primary key (id),
  constraint product_variants_product_id_fkey foreign KEY (product_id) references products (id)
) TABLESPACE pg_default;

create index IF not exists idx_product_variants_product on public.product_variants using btree (product_id) TABLESPACE pg_default;
