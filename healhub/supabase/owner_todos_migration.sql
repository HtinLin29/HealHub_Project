-- Run this in Supabase SQL Editor if your project already has the base schema
-- and you only need to add owner todos + policies.

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

create unique index if not exists uniq_owner_todos_open_link
  on public.owner_todos(owner_user_id, linked_type, linked_id)
  where status = 'open' and linked_type is not null and linked_id is not null;

alter table public.owner_todos enable row level security;

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
