-- HealHub RLS policies
-- Apply this in Supabase SQL editor after the base schema.

alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.crm_notes enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.customer_patients enable row level security;
alter table public.customer_payment_methods enable row level security;
alter table public.order_delivery_events enable row level security;
alter table public.order_conversations enable row level security;
alter table public.order_messages enable row level security;
alter table public.order_refund_requests enable row level security;
alter table public.owner_todos enable row level security;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
as $$
  select id from public.users where auth_user_id = auth.uid()
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users
    where auth_user_id = auth.uid()
      and role = 'owner'
  )
$$;

-- USERS
create policy "users select self or owner"
on public.users
for select
using (
  auth.uid() = auth_user_id
  or public.is_owner()
);

create policy "users insert self signup"
on public.users
for insert
with check (
  auth.uid() = auth_user_id
  and role = 'customer'
);

create policy "users update self or owner"
on public.users
for update
using (
  auth.uid() = auth_user_id
  or public.is_owner()
)
with check (
  auth.uid() = auth_user_id
  or public.is_owner()
);

-- PRODUCTS
create policy "products public read active"
on public.products
for select
using (is_active = true or public.is_owner());

create policy "products owner insert"
on public.products
for insert
with check (public.is_owner());

create policy "products owner update"
on public.products
for update
using (public.is_owner())
with check (public.is_owner());

create policy "products owner delete"
on public.products
for delete
using (public.is_owner());

-- ORDERS
create policy "orders owner read all"
on public.orders
for select
using (
  public.is_owner()
  or customer_id = public.current_app_user_id()
);

create policy "orders authenticated create own or guest"
on public.orders
for insert
with check (
  auth.uid() is not null
  and (
    customer_id is null
    or customer_id = public.current_app_user_id()
  )
  and (
    patient_id is null
    or exists (
      select 1
      from public.customer_patients p
      where p.id = orders.patient_id
        and p.customer_id = public.current_app_user_id()
    )
  )
);

create policy "orders owner update"
on public.orders
for update
using (public.is_owner())
with check (public.is_owner());

drop policy if exists "orders customer cancel own" on public.orders;
create policy "orders customer cancel own"
on public.orders
for update
using (
  customer_id = public.current_app_user_id()
  and delivery_status = 'pending'
)
with check (
  customer_id = public.current_app_user_id()
  and status = 'cancelled'
  and delivery_status = 'cancelled'
  and cancel_reason is not null
);

create policy "orders owner delete"
on public.orders
for delete
using (public.is_owner());

-- ORDER ITEMS
create policy "order_items owner or order customer read"
on public.order_items
for select
using (
  public.is_owner()
  or exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.customer_id = public.current_app_user_id()
  )
);

create policy "order_items insert for owned order"
on public.order_items
for insert
with check (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and (
        public.is_owner()
        or o.customer_id is null
        or o.customer_id = public.current_app_user_id()
      )
  )
);

-- DELIVERY EVENTS (demo)
create policy "delivery events owner read"
on public.order_delivery_events
for select
using (public.is_owner());

create policy "delivery events owner insert"
on public.order_delivery_events
for insert
with check (public.is_owner());

create policy "delivery events customer read own"
on public.order_delivery_events
for select
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_delivery_events.order_id
      and o.customer_id = public.current_app_user_id()
  )
);

-- ORDER CHAT
drop policy if exists "order conversations owner read" on public.order_conversations;
drop policy if exists "order conversations customer read own" on public.order_conversations;
drop policy if exists "order conversations customer insert own" on public.order_conversations;
drop policy if exists "order conversations owner update" on public.order_conversations;
drop policy if exists "order conversations customer update own" on public.order_conversations;

create policy "order conversations owner read"
on public.order_conversations
for select
using (public.is_owner());

create policy "order conversations customer read own"
on public.order_conversations
for select
using (customer_id = public.current_app_user_id());

create policy "order conversations customer insert own"
on public.order_conversations
for insert
with check (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
  and exists (
    select 1 from public.orders o
    where o.id = order_conversations.order_id
      and o.customer_id = public.current_app_user_id()
  )
);

create policy "order conversations owner update"
on public.order_conversations
for update
using (public.is_owner())
with check (public.is_owner());

create policy "order conversations customer update own"
on public.order_conversations
for update
using (customer_id = public.current_app_user_id())
with check (customer_id = public.current_app_user_id());

drop policy if exists "order messages owner read" on public.order_messages;
drop policy if exists "order messages customer read own" on public.order_messages;
drop policy if exists "order messages owner insert" on public.order_messages;
drop policy if exists "order messages customer insert own" on public.order_messages;

create policy "order messages owner read"
on public.order_messages
for select
using (public.is_owner());

create policy "order messages customer read own"
on public.order_messages
for select
using (
  exists (
    select 1
    from public.order_conversations c
    where c.id = order_messages.conversation_id
      and c.customer_id = public.current_app_user_id()
  )
);

create policy "order messages owner insert"
on public.order_messages
for insert
with check (
  public.is_owner()
  and sender_role = 'owner'
);

create policy "order messages customer insert own"
on public.order_messages
for insert
with check (
  auth.uid() is not null
  and sender_role = 'customer'
  and sender_user_id = public.current_app_user_id()
  and exists (
    select 1
    from public.order_conversations c
    where c.id = order_messages.conversation_id
      and c.customer_id = public.current_app_user_id()
  )
);

-- REFUND REQUESTS
drop policy if exists "refund requests owner read" on public.order_refund_requests;
drop policy if exists "refund requests customer read own" on public.order_refund_requests;
drop policy if exists "refund requests customer insert own" on public.order_refund_requests;
drop policy if exists "refund requests owner update" on public.order_refund_requests;

create policy "refund requests owner read"
on public.order_refund_requests
for select
using (public.is_owner());

create policy "refund requests customer read own"
on public.order_refund_requests
for select
using (customer_id = public.current_app_user_id());

create policy "refund requests customer insert own"
on public.order_refund_requests
for insert
with check (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
  and exists (
    select 1
    from public.orders o
    where o.id = order_refund_requests.order_id
      and o.customer_id = public.current_app_user_id()
      and o.delivery_status = 'delivered'
  )
);

create policy "refund requests owner update"
on public.order_refund_requests
for update
using (public.is_owner())
with check (public.is_owner());

create policy "order_items owner update"
on public.order_items
for update
using (public.is_owner())
with check (public.is_owner());

create policy "order_items owner delete"
on public.order_items
for delete
using (public.is_owner());

-- CRM NOTES
create policy "crm notes owner read"
on public.crm_notes
for select
using (public.is_owner());

create policy "crm notes owner write"
on public.crm_notes
for all
using (public.is_owner())
with check (public.is_owner());

-- CUSTOMER ADDRESSES
create policy "customer addresses read self"
on public.customer_addresses
for select
using (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
);

-- Owners need addresses for fulfillment when the order row has no snapshot (legacy orders).
drop policy if exists "customer addresses owner read for fulfillment" on public.customer_addresses;
create policy "customer addresses owner read for fulfillment"
on public.customer_addresses
for select
using (public.is_owner());

create policy "customer addresses insert self"
on public.customer_addresses
for insert
with check (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
);

create policy "customer addresses update self"
on public.customer_addresses
for update
using (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
)
with check (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
);

create policy "customer addresses delete self"
on public.customer_addresses
for delete
using (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
);

-- CUSTOMER PATIENTS
create policy "customer patients read self"
on public.customer_patients
for select
using (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
);

create policy "customer patients insert self"
on public.customer_patients
for insert
with check (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
);

create policy "customer patients update self"
on public.customer_patients
for update
using (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
)
with check (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
);

create policy "customer patients delete self"
on public.customer_patients
for delete
using (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
);

-- CUSTOMER PAYMENT METHODS
create policy "customer payment methods read self"
on public.customer_payment_methods
for select
using (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
);

create policy "customer payment methods insert self"
on public.customer_payment_methods
for insert
with check (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
);

create policy "customer payment methods update self"
on public.customer_payment_methods
for update
using (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
)
with check (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
);

create policy "customer payment methods delete self"
on public.customer_payment_methods
for delete
using (
  auth.uid() is not null
  and customer_id = public.current_app_user_id()
);

-- OWNER TODOS (shop owner only; scoped to own users.id row)
create policy "owner todos select own"
on public.owner_todos
for select
using (
  public.is_owner()
  and owner_user_id = public.current_app_user_id()
);

create policy "owner todos insert own"
on public.owner_todos
for insert
with check (
  public.is_owner()
  and owner_user_id = public.current_app_user_id()
);

create policy "owner todos update own"
on public.owner_todos
for update
using (
  public.is_owner()
  and owner_user_id = public.current_app_user_id()
)
with check (
  public.is_owner()
  and owner_user_id = public.current_app_user_id()
);

create policy "owner todos delete own"
on public.owner_todos
for delete
using (
  public.is_owner()
  and owner_user_id = public.current_app_user_id()
);
