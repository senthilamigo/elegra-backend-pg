create table public.user_role (
  id uuid not null,
  first_name text null,
  last_name text null,
  role_name text null,
  created_at timestamp with time zone null default now(),
  status character varying(50) null,
  is_seller_partner boolean null default false,
  seller_id uuid null,
  tagged_seller_partner_id uuid null,
  constraint user_role_pkey primary key (id),
  constraint user_role_id_fkey foreign KEY (id) references auth.users (id)
) TABLESPACE pg_default;
