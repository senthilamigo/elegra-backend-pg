create table public.orders (
  id uuid not null default extensions.uuid_generate_v4 (),
  user_id uuid not null,
  amount numeric(12, 2) not null,
  order_date timestamp with time zone null default now(),
  status public.order_status_enum null default 'pending'::order_status_enum,
  shipping_address_id uuid null,
  billing_address_id uuid null,
  payment_id uuid null,
  shipment_id uuid null,
  constraint orders_pkey primary key (id),
  constraint orders_billing_address_id_fkey foreign KEY (billing_address_id) references address (id),
  constraint orders_payment_id_fkey foreign KEY (payment_id) references payment (id),
  constraint orders_shipment_id_fkey foreign KEY (shipment_id) references shipment (id),
  constraint orders_shipping_address_id_fkey foreign KEY (shipping_address_id) references address (id),
  constraint orders_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;
