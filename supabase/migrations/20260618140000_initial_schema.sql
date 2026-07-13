create extension if not exists pgcrypto;

do $$
begin
  create type public.raffle_status as enum ('draft', 'open', 'closed', 'drawn');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.number_status as enum ('available', 'reserved', 'paid', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.order_status as enum ('pending', 'paid', 'cancelled', 'expired');
exception when duplicate_object then null;
end $$;

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.raffles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  prize_title text not null,
  image_url text,
  price_per_number numeric(10, 2) not null check (price_per_number > 0),
  total_numbers integer not null check (total_numbers between 10 and 10000),
  status public.raffle_status not null default 'draft',
  draw_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  raffle_id uuid not null references public.raffles(id) on delete cascade,
  total numeric(10, 2) not null check (total >= 0),
  status public.order_status not null default 'pending',
  mp_payment_id text,
  pix_qr_code text,
  pix_qr_code_base64 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.raffle_numbers (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid not null references public.raffles(id) on delete cascade,
  number integer not null check (number > 0),
  status public.number_status not null default 'available',
  user_id uuid references auth.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  reserved_until timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (raffle_id, number)
);

create index if not exists raffle_numbers_raffle_status_idx
  on public.raffle_numbers (raffle_id, status);

create index if not exists orders_user_idx
  on public.orders (user_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_raffles_updated_at on public.raffles;
create trigger touch_raffles_updated_at
before update on public.raffles
for each row execute function public.touch_updated_at();

drop trigger if exists touch_orders_updated_at on public.orders;
create trigger touch_orders_updated_at
before update on public.orders
for each row execute function public.touch_updated_at();

create or replace function public.generate_raffle_numbers()
returns trigger
language plpgsql
as $$
begin
  insert into public.raffle_numbers (raffle_id, number)
  select new.id, series.number
  from generate_series(1, new.total_numbers) as series(number)
  on conflict (raffle_id, number) do nothing;

  return new;
end;
$$;

drop trigger if exists generate_raffle_numbers_after_insert on public.raffles;
create trigger generate_raffle_numbers_after_insert
after insert on public.raffles
for each row execute function public.generate_raffle_numbers();

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admins
    where user_id = auth.uid()
  );
$$;

create or replace function public.create_pending_order(
  p_raffle_id uuid,
  p_numbers integer[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_price numeric(10, 2);
  v_total numeric(10, 2);
  v_selected_count integer;
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  if p_numbers is null then
    raise exception 'invalid_numbers';
  end if;

  select price_per_number
    into v_price
  from public.raffles
  where id = p_raffle_id
    and status = 'open';

  if v_price is null then
    raise exception 'raffle_unavailable';
  end if;

  select count(distinct n)
    into v_selected_count
  from unnest(p_numbers) as n;

  if v_selected_count = 0
    or v_selected_count <> coalesce(array_length(p_numbers, 1), 0)
    or v_selected_count > 100
  then
    raise exception 'invalid_numbers';
  end if;

  update public.raffle_numbers
  set
    status = 'available',
    user_id = null,
    order_id = null,
    reserved_until = null,
    updated_at = now()
  where raffle_id = p_raffle_id
    and status = 'reserved'
    and reserved_until < now();

  update public.orders
  set status = 'expired'
  where raffle_id = p_raffle_id
    and status = 'pending'
    and created_at < now() - interval '15 minutes';

  v_total := v_price * v_selected_count;

  insert into public.orders (id, user_id, raffle_id, total, status)
  values (v_order_id, auth.uid(), p_raffle_id, v_total, 'pending');

  update public.raffle_numbers
  set
    status = 'reserved',
    user_id = auth.uid(),
    order_id = v_order_id,
    reserved_until = now() + interval '15 minutes',
    updated_at = now()
  where raffle_id = p_raffle_id
    and number = any(p_numbers)
    and status = 'available';

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> v_selected_count then
    raise exception 'numbers_unavailable';
  end if;

  return v_order_id;
end;
$$;

alter table public.admins enable row level security;
alter table public.raffles enable row level security;
alter table public.orders enable row level security;
alter table public.raffle_numbers enable row level security;

drop policy if exists "admins can read own admin row" on public.admins;
create policy "admins can read own admin row"
on public.admins
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "public can read visible raffles" on public.raffles;
create policy "public can read visible raffles"
on public.raffles
for select
to anon, authenticated
using (
  status in ('open', 'closed', 'drawn')
  or public.is_current_user_admin()
);

drop policy if exists "admins can insert raffles" on public.raffles;
create policy "admins can insert raffles"
on public.raffles
for insert
to authenticated
with check (public.is_current_user_admin());

drop policy if exists "admins can update raffles" on public.raffles;
create policy "admins can update raffles"
on public.raffles
for update
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admins can delete raffles" on public.raffles;
create policy "admins can delete raffles"
on public.raffles
for delete
to authenticated
using (public.is_current_user_admin());

drop policy if exists "users can read own orders" on public.orders;
create policy "users can read own orders"
on public.orders
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_admin()
);

drop policy if exists "public can read visible raffle numbers" on public.raffle_numbers;
create policy "public can read visible raffle numbers"
on public.raffle_numbers
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.raffles r
    where r.id = raffle_id
      and r.status in ('open', 'closed', 'drawn')
  )
  or user_id = auth.uid()
  or public.is_current_user_admin()
);

drop policy if exists "admins can manage raffle numbers" on public.raffle_numbers;
create policy "admins can manage raffle numbers"
on public.raffle_numbers
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

grant usage on schema public to anon, authenticated;
grant select on public.raffles to anon, authenticated;
revoke select on public.raffle_numbers from anon, authenticated;
grant select (id, raffle_id, number, status, reserved_until)
  on public.raffle_numbers to anon, authenticated;
grant select on public.orders to authenticated;
grant select on public.admins to authenticated;
grant execute on function public.is_current_user_admin() to authenticated;
grant execute on function public.create_pending_order(uuid, integer[]) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'raffle_numbers'
  ) then
    execute 'alter publication supabase_realtime add table public.raffle_numbers';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
end $$;
