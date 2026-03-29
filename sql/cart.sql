create table public.cart (
  id uuid not null default extensions.uuid_generate_v4 (),
  user_id uuid not null,
  product_id uuid not null,
  quantity integer not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint cart_pkey primary key (id),
  constraint cart_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint fk_cart_product_variant foreign KEY (product_id) references product_variants (id) on delete CASCADE
) TABLESPACE pg_default;
