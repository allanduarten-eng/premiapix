revoke all on public.admins from anon;
revoke all on public.admins from authenticated;
grant select on public.admins to authenticated;

revoke all on public.orders from anon;
revoke all on public.orders from authenticated;
grant select on public.orders to authenticated;

revoke all on public.raffles from anon;
revoke all on public.raffles from authenticated;
grant select on public.raffles to anon, authenticated;

revoke all on public.raffle_numbers from anon;
revoke all on public.raffle_numbers from authenticated;
grant select (id, raffle_id, number, status, reserved_until)
  on public.raffle_numbers to anon, authenticated;

grant usage on schema public to anon, authenticated;
