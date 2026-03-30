-- Run once in Supabase SQL editor if owners cannot see customer addresses on fulfillment.
-- (Adds SELECT for role=owner on public.customer_addresses.)

drop policy if exists "customer addresses owner read for fulfillment" on public.customer_addresses;

create policy "customer addresses owner read for fulfillment"
on public.customer_addresses
for select
using (public.is_owner());
