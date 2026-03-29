create table public.product_reviews (
  id uuid not null default extensions.uuid_generate_v4 (),
  user_id uuid not null,
  product_id uuid not null,
  product_variant_id uuid null,
  rating integer not null,
  review_title character varying(255) null,
  review_text text null,
  is_verified_purchase boolean null default false,
  is_approved boolean null default true,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint product_reviews_pkey primary key (id),
  constraint product_reviews_product_id_fkey foreign KEY (product_id) references products (id) on delete CASCADE,
  constraint product_reviews_product_variant_id_fkey foreign KEY (product_variant_id) references product_variants (id) on delete set null,
  constraint product_reviews_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint product_reviews_rating_check check (
    (
      (rating >= 1)
      and (rating <= 5)
    )
  )
) TABLESPACE pg_default;
