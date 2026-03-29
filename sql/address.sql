create table public.address (
  id uuid not null default extensions.uuid_generate_v4 (),
  user_id uuid not null,
  street_address text not null,
  city character varying(100) not null,
  state character varying(100) null,
  pin_code character varying(20) null,
  country character varying(100) not null,
  land_mark text not null,
  address_type public.address_type_enum not null,
  created_at timestamp with time zone null default now(),
  constraint address_pkey primary key (id),
  constraint address_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;
