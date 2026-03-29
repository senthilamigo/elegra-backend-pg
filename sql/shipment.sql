create table public.shipment (
  id uuid not null default extensions.uuid_generate_v4 (),
  shipment_date timestamp with time zone null,
  address_id uuid not null,
  constraint shipment_pkey primary key (id),
  constraint shipment_address_id_fkey foreign KEY (address_id) references address (id)
) TABLESPACE pg_default;
