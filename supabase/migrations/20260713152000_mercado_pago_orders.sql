alter table public.orders
  add column if not exists mp_order_id text;

create index if not exists orders_mp_order_id_idx
  on public.orders (mp_order_id);
