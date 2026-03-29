create table public.payment (
  id uuid not null default extensions.uuid_generate_v4 (),
  type public.payment_type_enum not null,
  amount numeric(12, 2) not null,
  payment_date timestamp with time zone null default now(),
  order_id uuid null,
  transaction_id character varying(255) null,
  constraint payment_pkey primary key (id),
  constraint fk_payment_order foreign KEY (order_id) references orders (id) on delete set null
) TABLESPACE pg_default;
