create table public.wishlist (
  id uuid not null default extensions.uuid_generate_v4 (),
  user_id uuid not null,
  product_id uuid not null,
  created_at timestamp with time zone null default now(),
  deleted_at timestamp with time zone null,
  constraint wishlist_pkey primary key (id),
  constraint fk_wishlist_product_variant foreign KEY (product_id) references product_variants (id) on delete CASCADE,
  constraint wishlist_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;
