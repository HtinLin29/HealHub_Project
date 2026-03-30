-- ============================================================================
-- SALE_NEW.CSV IMPORT — run in Supabase SQL Editor in this order:
--
--  ① Run everything in "BLOCK A" below.
--  ② Table Editor → sale_new_staging → Import → sale_new.csv (same columns as header).
--  ③ Run everything in "BLOCK B" below.
--
--  cancel  → order: cancelled
--  refund  → order: delivered + row in order_refund_requests (pending)
--  paid    → order: paid, delivery: pending
-- ============================================================================


-- ============================ BLOCK A — staging table ============================
drop table if exists public.sale_new_staging;

create table public.sale_new_staging (
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

-- STOP HERE. Import sale_new.csv into sale_new_staging, then run BLOCK B.


-- ============================ BLOCK B — load real tables ============================

-- 1) Customers
insert into public.users (id, email, full_name, role)
select distinct
  trim(customer_id)::uuid,
  trim(email),
  trim(customer_name),
  'customer'
from public.sale_new_staging
where trim(customer_id) <> ''
  and trim(email) <> ''
on conflict (id) do nothing;

-- 2) Patients (keeps CSV patient_id)
with parsed as (
  select
    trim(customer_id)::uuid as customer_id,
    trim(patient_id)::bigint as patient_id,
    trim(patient_name) as full_name,
    nullif(nullif(lower(trim(gender)), ''), 'null') as gender,
    nullif(nullif(trim(age), ''), 'null')::int as age,
    nullif(nullif(lower(trim(allergy)), ''), 'null') as allergy,
    case when lower(trim(is_default)) in ('1','true','yes') then true else false end as def_flag
  from public.sale_new_staging
  where trim(customer_id) <> '' and trim(patient_id) <> ''
),
dedup as (
  select distinct on (patient_id, customer_id) *
  from parsed
  order by patient_id, customer_id, def_flag desc
),
ranked as (
  select
    *,
    row_number() over (partition by customer_id order by def_flag desc, patient_id desc) as rn,
    max(case when def_flag then 1 else 0 end) over (partition by customer_id) as any_def
  from dedup
)
insert into public.customer_patients (
  id, customer_id, full_name, age, gender, allergy, is_default
)
overriding system value
select patient_id, customer_id, full_name, age, gender, allergy, (any_def = 1 and rn = 1)
from ranked
on conflict (id) do nothing;

-- 3) Orders (keeps CSV order_id)
with src as (
  select
    trim(order_id)::bigint as id,
    trim(patient_id)::bigint as patient_id,
    trim(customer_id)::uuid as customer_id,
    trim(replace(patient_name, '_', ' ')) as delivery_name,
    nullif(trim(address), '') as addr,
    lower(trim(status)) as st,
    coalesce(nullif(trim(total_price), '')::numeric(12,2), 0) as total_price,
    to_timestamp(trim(date) || ' ' || trim("time"), 'DD.MM.YYYY HH24:MI:SS') as ts
  from public.sale_new_staging
  where trim(order_id) <> ''
),
ord as (
  select distinct on (id) *
  from src
  order by id
)
insert into public.orders (
  id, customer_id, patient_id,
  status, delivery_status,
  delivery_name, delivery_address,
  total_price,
  cancelled_at, cancel_reason,
  delivered_at,
  created_at, updated_at
)
overriding system value
select
  id,
  customer_id,
  patient_id,
  case when st = 'cancel' then 'cancelled' when st = 'refund' then 'delivered' else 'paid' end,
  case when st = 'cancel' then 'cancelled' when st = 'refund' then 'delivered' else 'pending' end,
  delivery_name,
  case when addr is null then null else jsonb_build_object('line1', addr) end,
  coalesce(total_price, 0),
  case when st = 'cancel' then ts end,
  case when st = 'cancel' then 'Imported: cancel' end,
  case when st = 'refund' then ts end,
  ts,
  ts
from ord
on conflict (id) do nothing;

-- 4) Order line items (run once — twice = duplicate lines)
insert into public.order_items (order_id, product_id, quantity, unit_price)
select
  trim(order_id)::bigint,
  trim(product_id)::bigint,
  greatest(1, trim(quantity)::int),
  coalesce(trim(unit_price)::numeric(12,2), 0)
from public.sale_new_staging
where trim(order_id) <> ''
  and trim(product_id) <> ''
  and trim(quantity) <> '';

-- 5) Refund requests (CSV status = refund)
insert into public.order_refund_requests (order_id, customer_id, status, reason, requested_amount, created_at)
select distinct on (trim(s.order_id)::bigint)
  trim(s.order_id)::bigint,
  trim(s.customer_id)::uuid,
  'pending',
  'Imported: refund',
  coalesce(nullif(trim(s.total_price), '')::numeric(12,2), 0),
  to_timestamp(trim(s.date) || ' ' || trim(s."time"), 'DD.MM.YYYY HH24:MI:SS')
from public.sale_new_staging s
where lower(trim(s.status)) = 'refund'
  and not exists (
    select 1 from public.order_refund_requests r
    where r.order_id = trim(s.order_id)::bigint
  )
order by trim(s.order_id)::bigint;

-- 6) Fix IDs for new rows later
select setval(pg_get_serial_sequence('public.orders', 'id'), (select coalesce(max(id),1) from public.orders));
select setval(pg_get_serial_sequence('public.order_items', 'id'), (select coalesce(max(id),1) from public.order_items));
select setval(pg_get_serial_sequence('public.customer_patients', 'id'), (select coalesce(max(id),1) from public.customer_patients));

-- Optional: drop table public.sale_new_staging;
