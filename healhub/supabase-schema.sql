-- HealHub core schema (canonical model)
--
-- Canonical order model:
-- - public.orders.status is the single order status field
-- - public.order_items stores product rows per order
-- - do not rely on legacy columns like orders.order_status, orders.product_id, or orders.quantity


create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text unique not null,
  full_name text,
  role text not null check (role in ('owner', 'customer')) default 'customer',
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id bigint generated always as identity primary key,
  name text not null,
  category text,
  description text,
  image_url text,
  price numeric(12,2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  low_stock_threshold integer not null default 10 check (low_stock_threshold >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  customer_id uuid references public.users(id) on delete set null,
  patient_id bigint references public.customer_patients(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled')),
  payment_method text,
  cancelled_at timestamptz,
  cancel_reason text,
  delivery_status text not null default 'pending' check (delivery_status in ('pending','packed','out_for_delivery','in_transit','delivered','exception','cancelled')),
  courier_provider text,
  tracking_id text,
  tracking_url text,
  shipment_id text,
  packed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  delivery_last_event_at timestamptz,
  delivery_last_event_raw jsonb,
  delivery_name text,
  delivery_phone text,
  delivery_address jsonb,
  total_price numeric(12,2) not null default 0 check (total_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id bigint references public.products(id) on delete set null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null generated always as (quantity * unit_price) stored
);

create index if not exists idx_products_stock on public.products(stock);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_orders_delivery_status on public.orders(delivery_status, updated_at desc);
create index if not exists idx_orders_tracking_id on public.orders(tracking_id);

create table if not exists public.order_delivery_events (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  provider text not null,
  event_time timestamptz not null,
  status text not null,
  message text,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_delivery_events_order_time on public.order_delivery_events(order_id, event_time desc);

-- Order chat (customer <-> owner)
create table if not exists public.order_conversations (
  id bigint generated always as identity primary key,
  order_id bigint not null unique references public.orders(id) on delete cascade,
  customer_id uuid references public.users(id) on delete set null,
  last_message_at timestamptz,
  last_sender_role text check (last_sender_role in ('customer','owner')),
  owner_last_read_at timestamptz,
  customer_last_read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_conversations_customer on public.order_conversations(customer_id, last_message_at desc);
create index if not exists idx_order_conversations_order on public.order_conversations(order_id);

create table if not exists public.order_messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.order_conversations(id) on delete cascade,
  order_id bigint not null references public.orders(id) on delete cascade,
  sender_role text not null check (sender_role in ('customer','owner')),
  sender_user_id uuid references public.users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_messages_conversation on public.order_messages(conversation_id, created_at asc);
create index if not exists idx_order_messages_order on public.order_messages(order_id, created_at asc);

-- Refund requests (demo)
create table if not exists public.order_refund_requests (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason text not null,
  note text,
  requested_amount numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  resolution_note text
);

create index if not exists idx_refunds_order on public.order_refund_requests(order_id, created_at desc);
create index if not exists idx_refunds_customer on public.order_refund_requests(customer_id, created_at desc);
create index if not exists idx_refunds_status on public.order_refund_requests(status, updated_at desc);

-- Customer saved delivery addresses (TikTok Shop / Shopee style).
-- Multiple addresses per customer, with a single default.
--
-- Migration note:
-- If you already created the old single-row table (customer_id as PK),
-- you can migrate by running something like:
--
--   alter table public.customer_addresses rename to customer_addresses_single;
--   -- then run the create table below
--   insert into public.customer_addresses (customer_id, label, full_name, phone, address_line1, address_line2, is_default)
--   select customer_id, 'Default', full_name, phone, address_line1, address_line2, true
--   from public.customer_addresses_single;
--
create table if not exists public.customer_addresses (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.users(id) on delete cascade,
  label text not null default 'Home',
  full_name text,
  phone text,
  address_line1 text not null,
  address_line2 text,
  is_default boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_addresses_customer_id on public.customer_addresses(customer_id, created_at desc);
create unique index if not exists uniq_customer_addresses_default_per_customer
  on public.customer_addresses(customer_id)
  where is_default = true;

-- Customer patient profiles (for CRM + safe recommendations).
create table if not exists public.customer_patients (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.users(id) on delete cascade,
  full_name text not null,
  age integer,
  gender text,
  allergy text,
  is_default boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_patients_customer_id on public.customer_patients(customer_id, created_at desc);
create unique index if not exists uniq_customer_patients_default_per_customer
  on public.customer_patients(customer_id)
  where is_default = true;

-- Customer payment methods (store only non-sensitive metadata; NEVER store CVV).
create table if not exists public.customer_payment_methods (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.users(id) on delete cascade,
  provider text not null default 'visa',
  brand text,
  last4 text not null,
  exp_month integer,
  exp_year integer,
  cardholder_name text,
  is_default boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_payment_methods_customer_id
  on public.customer_payment_methods(customer_id, created_at desc);

create unique index if not exists uniq_customer_payment_default_per_customer
  on public.customer_payment_methods(customer_id)
  where is_default = true;

create table if not exists public.crm_notes (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.users(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_notes_customer on public.crm_notes(customer_id, created_at desc);

-- Optional helper view for dashboard monthly sales.
-- Keep this aligned with the app's revenue rule: count only
-- paid, packed, shipped, and delivered orders as revenue.
create or replace view public.monthly_sales as
select
  to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
  coalesce(sum(total_price), 0)::numeric(12,2) as revenue
from public.orders
where status in ('paid', 'packed', 'shipped', 'delivered')
group by 1
order by 1;

-- Safe stock adjust RPC for frontend usage.
-- This avoids RLS/no-row-update issues when customers place/cancel orders.
create or replace function public.adjust_product_stock(p_product_id bigint, p_delta integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock integer;
begin
  select stock into v_stock from public.products where id = p_product_id for update;
  if v_stock is null then
    raise exception 'Product % not found', p_product_id;
  end if;

  if v_stock + p_delta < 0 then
    raise exception 'Insufficient stock for product %', p_product_id;
  end if;

  update public.products
  set stock = v_stock + p_delta,
      updated_at = now()
  where id = p_product_id;
end;
$$;

grant execute on function public.adjust_product_stock(bigint, integer) to anon, authenticated;

-- Owner task list (persisted per shop owner)
create table if not exists public.owner_todos (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  notes text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done')),
  source text not null default 'manual' check (source in ('manual', 'suggested')),
  linked_type text,
  linked_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_owner_todos_owner_status on public.owner_todos(owner_user_id, status, created_at desc);

-- One open task per logical link (e.g. same product restock reminder)
create unique index if not exists uniq_owner_todos_open_link
  on public.owner_todos(owner_user_id, linked_type, linked_id)
  where status = 'open' and linked_type is not null and linked_id is not null;
