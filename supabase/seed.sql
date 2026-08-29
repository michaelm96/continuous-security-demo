-- Deterministic local-only identities and tenant fixtures.
-- Passwords are documented in the delivery guide and must never be reused.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'admin.alpha@example.test',     extensions.crypt('LocalOnly-Admin1!',     extensions.gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'manager.alpha@example.test',   extensions.crypt('LocalOnly-Manager1!',   extensions.gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'authenticated', 'authenticated', 'user-a.alpha@example.test',    extensions.crypt('LocalOnly-UserA1!',     extensions.gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'authenticated', 'authenticated', 'user-b.alpha@example.test',    extensions.crypt('LocalOnly-UserB1!',     extensions.gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'authenticated', 'authenticated', 'suspended.alpha@example.test', extensions.crypt('LocalOnly-Suspended1!', extensions.gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'authenticated', 'authenticated', 'admin.beta@example.test',      extensions.crypt('LocalOnly-Admin2!',     extensions.gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do update set
  instance_id = excluded.instance_id,
  aud = excluded.aud,
  role = excluded.role,
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  confirmation_token = excluded.confirmation_token,
  recovery_token = excluded.recovery_token,
  email_change_token_new = excluded.email_change_token_new,
  email_change = excluded.email_change,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = now();

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'email', 'admin.alpha@example.test',     'email_verified', true), 'email', now(), now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', jsonb_build_object('sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'email', 'manager.alpha@example.test',   'email_verified', true), 'email', now(), now(), now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', jsonb_build_object('sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'email', 'user-a.alpha@example.test',    'email_verified', true), 'email', now(), now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', jsonb_build_object('sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'email', 'user-b.alpha@example.test',    'email_verified', true), 'email', now(), now(), now()),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', jsonb_build_object('sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'email', 'suspended.alpha@example.test', 'email_verified', true), 'email', now(), now(), now()),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'ffffffff-ffff-4fff-8fff-ffffffffffff', jsonb_build_object('sub', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'email', 'admin.beta@example.test',      'email_verified', true), 'email', now(), now(), now())
on conflict (provider_id, provider) do update set
  user_id = excluded.user_id,
  identity_data = excluded.identity_data,
  last_sign_in_at = excluded.last_sign_in_at,
  updated_at = now();

insert into public.profiles (user_id, display_name)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alpha Admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Alpha Manager'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Alpha User A'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Alpha User B'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Alpha Suspended'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Beta Admin')
on conflict (user_id) do update set
  display_name = excluded.display_name,
  updated_at = now();

insert into public.organizations (id, name)
values
  ('11111111-1111-4111-8111-111111111111', 'Alpha'),
  ('22222222-2222-4222-8222-222222222222', 'Beta')
on conflict (id) do update set
  name = excluded.name,
  updated_at = now();

insert into public.memberships (organization_id, user_id, role, status)
values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'organization_admin', 'active'),
  ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'manager', 'active'),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'user', 'active'),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'user', 'active'),
  ('11111111-1111-4111-8111-111111111111', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'user', 'suspended'),
  ('22222222-2222-4222-8222-222222222222', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'organization_admin', 'active')
on conflict (organization_id, user_id) do update set
  role = excluded.role,
  status = excluded.status,
  updated_at = now();

insert into public.invoices (
  id,
  organization_id,
  owner_id,
  customer_id,
  description,
  amount_minor,
  currency,
  status
)
values
  ('10000001-aaaa-4aaa-8aaa-000000000001', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'cust-a-001', 'Alpha user A draft', 1000, 'USD', 'draft'),
  ('10000002-bbbb-4bbb-8bbb-000000000002', '11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cust-b-001', 'Alpha user B issued', 2500, 'USD', 'issued'),
  ('20000001-ffff-4fff-8fff-000000000001', '22222222-2222-4222-8222-222222222222', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'cust-f-001', 'Beta admin issued', 7500, 'EUR', 'issued')
on conflict (id) do update set
  organization_id = excluded.organization_id,
  owner_id = excluded.owner_id,
  customer_id = excluded.customer_id,
  description = excluded.description,
  amount_minor = excluded.amount_minor,
  currency = excluded.currency,
  status = excluded.status,
  updated_at = now();

insert into public.refunds (
  id,
  invoice_id,
  organization_id,
  created_by,
  amount_minor,
  currency,
  reason,
  idempotency_key
)
values
  ('30000001-aaaa-4aaa-8aaa-000000000001', '10000002-bbbb-4bbb-8bbb-000000000002', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 100, 'USD', 'partial refund of user B issued invoice', 'seed-30000001-aaaa-4aaa-8aaa-000000000001'),
  ('30000002-bbbb-4bbb-8bbb-000000000002', '10000002-bbbb-4bbb-8bbb-000000000002', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 200, 'USD', 'cancelled refund request', 'seed-30000002-bbbb-4bbb-8bbb-000000000002')
on conflict (invoice_id, idempotency_key) do update set
  organization_id = excluded.organization_id,
  created_by = excluded.created_by,
  amount_minor = excluded.amount_minor,
  currency = excluded.currency,
  reason = excluded.reason;
