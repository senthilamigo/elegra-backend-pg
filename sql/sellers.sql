create table public.sellers (
  id uuid not null default extensions.uuid_generate_v4 (),
  user_id uuid not null,
  status character varying(50) null default 'active'::character varying,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  seller_profile_id uuid null,
  constraint sellers_pkey primary key (id),
  constraint unique_user_seller unique (user_id),
  constraint sellers_seller_profile_id_fkey foreign KEY (seller_profile_id) references seller_profiles (id),
  constraint sellers_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;
