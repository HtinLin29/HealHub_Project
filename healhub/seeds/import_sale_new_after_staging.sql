-- =============================================================================
-- Import sale_new.csv into HealHub (after CSV is loaded into staging)
-- =============================================================================
-- Prerequisite: In Supabase Dashboard → Table Editor, create table
-- public.sale_new_staging (all TEXT columns) and import sale_new.csv.
--
-- Column list (header must match):
-- order_id,patient_id,customer_id,patient_name,customer_name,gender,age,
-- allergy,is_default,email,address,product_name,product_id,unit_price,
-- quantity,total_price,status,date,time
--
-- Rules (your choices):
--   cancel  → orders.status = cancelled, delivery_status = cancelled
--   refund  → orders.status = delivered + delivery_status = delivered
--             + one row in order_refund_requests (pending) until refund UX ships
--   paid    → orders.status = paid, delivery_status = pending
--
-- Run each STEP in order inside Supabase SQL Editor as postgres.
-- If import fails on product_id, add missing products first or fix IDs.
-- =============================================================================

-- STEP 1 — staging table (skip if you already created and imported)
create table if not exists public.sale_new_staging (
  order_id text,
  patient_id text,
  customer_id text,
  patient_name text,
  customer_name text,
  gender text,
  age text,
  allergy text,
  is_default text,
  email text,
  address text,
  product_name text,
  product_id text,
  unit_price text,
  quantity text,
  total_price text,
  status text,
  date text,
  "time" text
);

-- After STEP 1: Dashboard → sale_new_staging → Import → sale_new.csv

-- STEP 2 — customers (public.users)
insert into public.users (id, email, full_name, role)
select distinct
  nullif(trim(customer_id), '')::uuid,
  nullif(trim(email), ''),
  nullif(trim(customer_name), ''),
  'customer'::text
from public.sale_new_staging
where nullif(trim(customer_id), '') is not null
  and nullif(trim(email), '') is not null
on conflict (id) do nothing;

-- STEP 3 — patients (preserve CSV patient_id; one default patient per customer)
with parsed as (
  select
    nullif(trim(customer_id), '')::uuid as customer_id,
    nullif(trim(patient_id), '')::bigint as patient_id,
    nullif(trim(patient_name), '') as full_name,
    nullif(nullif(lower(trim(gender)), ''), 'null') as gender,
    nullif(nullif(trim(age), ''), 'null')::int as age,
    nullif(nullif(lower(trim(allergy)), ''), 'null') as allergy,
    case
      when lower(trim(is_default)) in ('1', 'true', 't', 'yes', 'y') then true
      else false
    end as is_default_in
  from public.sale_new_staging
  where nullif(trim(customer_id), '') is not null
    and nullif(trim(patient_id), '') is not null
),
dedup as (
  select distinct on (patient_id, customer_id)
    *
  from parsed
  order by patient_id, customer_id, is_default_in desc
),
ranked as (
  select
    *,
    row_number() over (partition by customer_id order by is_default_in desc, patient_id desc) as rn,
    max(case when is_default_in then 1 else 0 end) over (partition by customer_id) as has_any_default
  from dedup
)
insert into public.customer_patients (
  id, customer_id, full_name, age, gender, allergy, is_default
)
overriding system value
select
  patient_id,
  customer_id,
  full_name,
  age,
  gender,
  allergy,
  (has_any_default = 1 and rn = 1) as is_default
from ranked
on conflict (id) do nothing;

-- STEP 4 — orders (preserve CSV order_id; cancel/refund/paid mapping)
with src as (
  select
    nullif(trim(s.order_id), '')::bigint as id,
    nullif(trim(s.patient_id), '')::bigint as patient_id,
    nullif(trim(s.customer_id), '')::uuid as customer_id,
    trim(replace(nullif(trim(s.patient_name), ''), '_', ' ')) as delivery_name,
    nullif(trim(s.address), '') as addr_line,
    lower(trim(s.status)) as st,
    nullif(trim(s.total_price), '')::numeric(12, 2) as total_price,
    to_timestamp(
      trim(s.date) || ' ' || trim(s."time"),
      'DD.MM.YYYY HH24:MI:SS'
    ) as created_ts
  from public.sale_new_staging s
  where nullif(trim(s.order_id), '') is not null
),
ord as (
  select distinct on (id)
    id,
    patient_id,
    customer_id,
    delivery_name,
    addr_line,
    st,
    total_price,
    created_ts
  from src
  order by id, patient_id
)
insert into public.orders (
  id,
  customer_id,
  patient_id,
  status,
  delivery_status,
  delivery_name,
  delivery_address,
  total_price,
  cancelled_at,
  cancel_reason,
  delivered_at,
  packed_at,
  shipped_at,
  created_at,
  updated_at
)
overriding system value
select
  o.id,
  o.customer_id,
  o.patient_id,
  case
    when o.st = 'cancel' then 'cancelled'
    when o.st = 'refund' then 'delivered'
    else 'paid'
  end,
  case
    when o.st = 'cancel' then 'cancelled'
    when o.st = 'refund' then 'delivered'
    else 'pending'
  end,
  o.delivery_name,
  case
    when o.addr_line is null then null
    else jsonb_build_object('line1', o.addr_line)
  end,
  coalesce(o.total_price, 0),
  case when o.st = 'cancel' then o.created_ts else null end,
  case when o.st = 'cancel' then 'Imported: cancel' else null end,
  case when o.st = 'refund' then o.created_ts else null end,
  null::timestamptz,
  null::timestamptz,
  o.created_ts,
  o.created_ts
from ord o
on conflict (id) do nothing;

-- STEP 5 — order line items (one row per CSV line; line_total is generated)
insert into public.order_items (order_id, product_id, quantity, unit_price)
select
  nullif(trim(s.order_id), '')::bigint,
  nullif(trim(s.product_id), '')::bigint,
  greatest(1, nullif(trim(s.quantity), '')::int),
  coalesce(nullif(trim(s.unit_price), '')::numeric(12, 2), 0)
from public.sale_new_staging s
where nullif(trim(s.order_id), '') is not null
  and nullif(trim(s.product_id), '') is not null
  and nullif(trim(s.quantity), '') is not null;

-- Run STEP 5 only once per import (re-running creates duplicate line items).

-- STEP 6 — refund rows → pending refund requests (until first-class refund status exists)
insert into public.order_refund_requests (order_id, customer_id, status, reason, requested_amount, created_at)
select distinct on (s.order_id::bigint)
  s.order_id::bigint,
  s.customer_id::uuid,
  'pending',
  'Imported from sale_new.csv (refund)',
  nullif(trim(s.total_price), '')::numeric(12, 2),
  to_timestamp(trim(s.date) || ' ' || trim(s."time"), 'DD.MM.YYYY HH24:MI:SS')
from public.sale_new_staging s
where lower(trim(s.status)) = 'refund'
  and nullif(trim(s.order_id), '') is not null
  and nullif(trim(s.customer_id), '') is not null
  and not exists (
    select 1
    from public.order_refund_requests r
    where r.order_id = nullif(trim(s.order_id), '')::bigint
  )
order by s.order_id::bigint, s.patient_id::bigint nulls last;

-- Re-run safe: skips orders that already have a refund request row.

-- STEP 7 — fix sequences so the app can create new rows after manual ids
select setval(
  pg_get_serial_sequence('public.orders', 'id'),
  (select coalesce(max(id), 1) from public.orders)
);
select setval(
  pg_get_serial_sequence('public.order_items', 'id'),
  (select coalesce(max(id), 1) from public.order_items)
);
select setval(
  pg_get_serial_sequence('public.customer_patients', 'id'),
  (select coalesce(max(id), 1) from public.customer_patients)
);

-- STEP 8 — optional: remove staging when satisfied
-- drop table public.sale_new_staging;
