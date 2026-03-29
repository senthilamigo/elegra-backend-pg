create table public.seller_profiles (
  id uuid not null default extensions.uuid_generate_v4 (),
  business_name character varying(255) not null,
  contact_name character varying(255) null,
  email character varying(255) null,
  phone character varying(20) null,
  description text null,
  is_verified boolean null default false,
  status character varying(50) null default 'active'::character varying,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint sellers_profkey primary key (id),
  constraint unique_seller_name unique (business_name)
) TABLESPACE pg_default;
