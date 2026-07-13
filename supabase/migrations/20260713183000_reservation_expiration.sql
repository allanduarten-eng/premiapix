create or replace function public.expire_pending_orders(
  p_raffle_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired_count integer := 0;
begin
  with expired_orders as (
    select distinct rn.order_id
    from public.raffle_numbers rn
    join public.orders o on o.id = rn.order_id
    where rn.status = 'reserved'
      and rn.reserved_until < now()
      and rn.order_id is not null
      and o.status = 'pending'
      and (p_raffle_id is null or rn.raffle_id = p_raffle_id)
  ),
  updated_orders as (
    update public.orders
    set status = 'expired'
    where id in (select order_id from expired_orders)
    returning id
  ),
  released_numbers as (
    update public.raffle_numbers
    set
      status = 'available',
      user_id = null,
      order_id = null,
      reserved_until = null,
      updated_at = now()
    where order_id in (select id from updated_orders)
      and status = 'reserved'
    returning 1
  )
  select count(*) into v_expired_count
  from updated_orders;

  return v_expired_count;
end;
$$;

drop function if exists public.create_guest_pending_order(
  uuid,
  integer[],
  text,
  text,
  text,
  text
);

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

  perform public.expire_pending_orders(p_raffle_id);

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

  update public.orders
  set status = 'expired'
  where raffle_id = p_raffle_id
    and status = 'pending'
    and created_at < now() - interval '10 minutes';

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
    reserved_until = now() + interval '10 minutes',
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

grant execute on function public.expire_pending_orders(uuid) to service_role;
grant execute on function public.create_guest_pending_order(
  uuid,
  integer[],
  text,
  text,
  text,
  text
) to service_role;
