alter table public.orders
  add column if not exists buyer_name text,
  add column if not exists buyer_whatsapp text,
  add column if not exists buyer_contact text;

alter table public.raffles
  add column if not exists winning_number integer,
  add column if not exists winner_order_id uuid references public.orders(id) on delete set null,
  add column if not exists drawn_at timestamptz;

drop function if exists public.create_guest_pending_order(uuid, integer[], text);

create or replace function public.create_guest_pending_order(
  p_raffle_id uuid,
  p_numbers integer[],
  p_buyer_email text default null,
  p_buyer_name text default null,
  p_buyer_whatsapp text default null,
  p_buyer_contact text default null
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

  insert into public.orders (
    id,
    user_id,
    raffle_id,
    total,
    status,
    buyer_email,
    buyer_name,
    buyer_whatsapp,
    buyer_contact
  )
  values (
    v_order_id,
    null,
    p_raffle_id,
    v_total,
    'pending',
    nullif(trim(p_buyer_email), ''),
    nullif(trim(p_buyer_name), ''),
    nullif(trim(p_buyer_whatsapp), ''),
    nullif(trim(p_buyer_contact), '')
  );

  update public.raffle_numbers
  set
    status = 'reserved',
    user_id = null,
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

grant execute on function public.create_guest_pending_order(
  uuid,
  integer[],
  text,
  text,
  text,
  text
) to service_role;
