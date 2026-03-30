-- Create a new customer profile row (users_only; no Supabase Auth login).
-- Run this in Supabase Dashboard → SQL Editor.
--
-- It generates a unique-ish Gmail using the current timestamp.
-- Copy the returned `id` (uuid) — you will reuse it as `customer_id` for `public.customer_patients`.

insert into public.users (auth_user_id, email, full_name, role)
values (
  null,
  'healhub.customer.' || to_char(now(), 'YYYYMMDDHH24MISS') || '@gmail.com',
  'Noah Chaiyasit',
  'customer'
)
returning id, email, full_name, role, created_at;

