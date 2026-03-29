create table public.products (
  id uuid not null default extensions.uuid_generate_v4 (),
  created_at timestamp with time zone not null default now(),
  name text not null,
  description text null,
  category_id bigint null,
  gender text null,
  is_active boolean null,
  product_code text not null,
  seller_id uuid null,
  constraint products_pkey primary key (id),
  constraint products_product_code_key unique (product_code),
  constraint products_category_id_fkey foreign KEY (category_id) references category (id),
  constraint products_seller_id_fkey foreign KEY (seller_id) references sellers (id)
) TABLESPACE pg_default;

create index IF not exists idx_products_active on public.products using btree (is_active) TABLESPACE pg_default;
