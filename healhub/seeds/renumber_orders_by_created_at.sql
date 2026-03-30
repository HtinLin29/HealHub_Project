-- Renumber public.orders.id to 1,2,3,... in created_at order (then tie-break id).
-- Also updates order_id on all child tables.
--
-- Your DB already had low ids (1,2,3,...) AND imported orders (67,68,...) so a
-- direct remap collides. This script uses two phases:
--   ① Bump every order id (and FKs) by +BUMP into empty high range
--   ② Remap high ids → 1..N by created_at
--
-- Run in Supabase SQL Editor as postgres. BACK UP first.

begin;

-- Phase ① — move all order ids out of the 1..N range
create temp table _order_bump on commit drop as
select (coalesce((select max(id) from public.orders), 0) + 1000000)::bigint as v;

set local session_replication_role = replica;

update public.order_items set order_id = order_id + (select v from _order_bump);
update public.order_delivery_events set order_id = order_id + (select v from _order_bump);
update public.order_refund_requests set order_id = order_id + (select v from _order_bump);
update public.order_messages set order_id = order_id + (select v from _order_bump);
update public.order_conversations set order_id = order_id + (select v from _order_bump);
update public.orders set id = id + (select v from _order_bump);

set local session_replication_role = default;

-- Phase ② — now safe: new_id 1..N cannot clash with current (all bumped high)
create temp table order_id_remap on commit drop as
select
  id as old_id,
  row_number() over (order by created_at asc, id asc)::bigint as new_id
from public.orders;

set local session_replication_role = replica;

update public.order_items oi
set order_id = m.new_id
from order_id_remap m
where oi.order_id = m.old_id;

update public.order_delivery_events e
set order_id = m.new_id
from order_id_remap m
where e.order_id = m.old_id;

update public.order_refund_requests r
set order_id = m.new_id
from order_id_remap m
where r.order_id = m.old_id;

update public.order_messages msg
set order_id = m.new_id
from order_id_remap m
where msg.order_id = m.old_id;

update public.order_conversations c
set order_id = m.new_id
from order_id_remap m
where c.order_id = m.old_id;

update public.orders o
set id = m.new_id
from order_id_remap m
where o.id = m.old_id;

set local session_replication_role = default;

select setval(
  pg_get_serial_sequence('public.orders', 'id'),
  (select coalesce(max(id), 1) from public.orders)
);

commit;
