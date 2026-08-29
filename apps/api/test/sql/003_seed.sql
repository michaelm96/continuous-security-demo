-- ============================================================================
-- TASK 3 SEED — deterministic local identities + tenant fixtures.
-- Idempotent: every insert uses `on conflict (id) do update` so db:seed
-- can be re-run safely. UUIDs match apps/api/test/helpers/seed-identities.ts
-- byte-for-byte (see SEED_IDS).
-- ============================================================================

-- pgcrypto for crypt(); citext not required here. The schema migration
-- 001_tenant_schema.sql already runs `create extension if not exists pgcrypto`,
-- but we re-assert it for safety (idempotent).
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- auth.users: expand the minimal stub from 000_auth_stub.sql with the
-- columns the seed needs. id, created_at already exist.
-- ---------------------------------------------------------------------------
alter table auth.users
  add column if not exists email                     text,
  add column if not exists encrypted_password       text,
  add column if not exists email_confirmed_at       timestamptz,
  add column if not exists raw_app_meta_data        jsonb,
  add column if not exists raw_user_meta_data       jsonb,
  add column if not exists aud                       text,
  add column if not exists "role"                   text,
  add column if not exists updated_at               timestamptz not null default now();

create unique index if not exists auth_users_email_key on auth.users (lower(email));

-- ---------------------------------------------------------------------------
-- auth.identities: minimal Supabase-compatible shape so later tasks can
-- refer to (provider, provider_id) for OIDC flows without a migration.
-- ---------------------------------------------------------------------------
create table if not exists auth.identities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  provider        text not null,
  provider_id     text not null,
  identity_data   jsonb not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (provider, provider_id)
);
create index if not exists auth_identities_user_id_idx on auth.identities (user_id);

grant usage on schema auth to anon, authenticated, service_role;
grant select, insert, update, delete on auth.identities to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper macro for password hashing (avoids repeating crypt() six times).
-- Uses gen_salt('bf') per brief; bf = bcrypt cost 6 (default).
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 6 auth.users (SEED_IDS)
-- ============================================================================
insert into auth.users
  (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin.alpha@example.test',
     crypt('LocalOnly-Admin1!', gen_salt('bf')),     now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     'authenticated', 'authenticated'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'manager.alpha@example.test',
     crypt('LocalOnly-Manager1!', gen_salt('bf')),   now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     'authenticated', 'authenticated'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'user-a.alpha@example.test',
     crypt('LocalOnly-UserA1!', gen_salt('bf')),     now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     'authenticated', 'authenticated'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'user-b.alpha@example.test',
     crypt('LocalOnly-UserB1!', gen_salt('bf')),     now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     'authenticated', 'authenticated'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'suspended.alpha@example.test',
     crypt('LocalOnly-Suspended1!', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     'authenticated', 'authenticated'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'admin.beta@example.test',
     crypt('LocalOnly-Admin2!', gen_salt('bf')),     now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     'authenticated', 'authenticated')
on conflict (id) do update set
  email               = excluded.email,
  encrypted_password  = excluded.encrypted_password,
  email_confirmed_at  = excluded.email_confirmed_at,
  raw_app_meta_data   = excluded.raw_app_meta_data,
  raw_user_meta_data  = excluded.raw_user_meta_data,
  aud                 = excluded.aud,
  "role"              = excluded."role",
  updated_at          = now();

-- ============================================================================
-- 6 auth.identities — one per user, provider='email', provider_id=email.
-- identity_data carries the OIDC-style claims (sub, email, email_verified).
-- ============================================================================
insert into auth.identities
  (user_id, provider, provider_id, identity_data)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'email', 'admin.alpha@example.test',
    jsonb_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'email', 'admin.alpha@example.test',     'email_verified', true)),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'email', 'manager.alpha@example.test',
    jsonb_build_object('sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'email', 'manager.alpha@example.test',   'email_verified', true)),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'email', 'user-a.alpha@example.test',
    jsonb_build_object('sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'email', 'user-a.alpha@example.test',    'email_verified', true)),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'email', 'user-b.alpha@example.test',
    jsonb_build_object('sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'email', 'user-b.alpha@example.test',    'email_verified', true)),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'email', 'suspended.alpha@example.test',
    jsonb_build_object('sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'email', 'suspended.alpha@example.test', 'email_verified', true)),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'email', 'admin.beta@example.test',
    jsonb_build_object('sub', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'email', 'admin.beta@example.test',      'email_verified', true))
on conflict (provider, provider_id) do update set
  identity_data = excluded.identity_data,
  user_id       = excluded.user_id,
  updated_at    = now();

-- ============================================================================
-- public.profiles — every auth.user needs a profile (FK from memberships).
-- ============================================================================
insert into public.profiles (user_id, display_name)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alpha Admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Alpha Manager'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Alpha User A'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Alpha User B'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Alpha Suspended'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Beta Admin')
on conflict (user_id) do update set display_name = excluded.display_name;

-- ============================================================================
-- 2 organizations — Alpha (active) and Beta (active).
-- ============================================================================
insert into public.organizations (id, name)
values
  ('11111111-1111-4111-8111-111111111111', 'Alpha'),
  ('22222222-2222-4222-8222-222222222222', 'Beta')
on conflict (id) do update set
  name      = excluded.name,
  updated_at = now();

-- ============================================================================
-- 6 memberships — one per identity, mapping to the right org + role + status.
-- ============================================================================
insert into public.memberships
  (organization_id, user_id, role, status)
values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'organization_admin', 'active'),
  ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'manager',            'active'),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'user',               'active'),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'user',               'active'),
  ('11111111-1111-4111-8111-111111111111', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'user',               'suspended'),
  ('22222222-2222-4222-8222-222222222222', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'organization_admin', 'active')
on conflict (organization_id, user_id) do update set
  role       = excluded.role,
  status     = excluded.status,
  updated_at = now();

-- ============================================================================
-- 3 invoices — Alpha draft (User A), Alpha issued (User B), Beta issued (Beta Admin).
-- owner_id defaults via auth.uid() in real inserts, but here we're running as
-- superuser so we set it explicitly to avoid auth.uid() returning NULL.
-- ============================================================================
insert into public.invoices
  (id, organization_id, owner_id, customer_id, description, amount_minor, currency, status)
values
  ('10000001-aaaa-4aaa-8aaa-000000000001',
    '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'cust-a-001', 'Alpha user A draft', 1000, 'USD', 'draft'),
  ('10000002-bbbb-4bbb-8bbb-000000000002',
    '11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'cust-b-001', 'Alpha user B issued', 2500, 'USD', 'issued'),
  ('20000001-ffff-4fff-8fff-000000000001',
    '22222222-2222-4222-8222-222222222222', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'cust-f-001', 'Beta admin issued', 7500, 'EUR', 'issued')
on conflict (id) do update set
  organization_id = excluded.organization_id,
  owner_id        = excluded.owner_id,
  customer_id     = excluded.customer_id,
  description     = excluded.description,
  amount_minor    = excluded.amount_minor,
  currency        = excluded.currency,
  status          = excluded.status,
  updated_at      = now();

-- ============================================================================
-- 2 refund fixtures — paid and cancelled. amount_minor positive; reason and
-- idempotency_key both >=1 char. status matches invoice.status per the brief.
-- ============================================================================
insert into public.refunds
  (id, invoice_id, organization_id, created_by, amount_minor, currency, reason, idempotency_key)
values
  ('30000001-aaaa-4aaa-8aaa-000000000001',
    '10000002-bbbb-4bbb-8bbb-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    100, 'USD', 'partial refund of user B issued invoice',
    'seed-30000001-aaaa-4aaa-8aaa-000000000001'),
  ('30000002-bbbb-4bbb-8bbb-000000000002',
    '10000002-bbbb-4bbb-8bbb-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    200, 'USD', 'cancelled refund request',
    'seed-30000002-bbbb-4bbb-8bbb-000000000002')
on conflict (invoice_id, idempotency_key) do update set
  amount_minor    = excluded.amount_minor,
  currency        = excluded.currency,
  reason          = excluded.reason,
  organization_id = excluded.organization_id,
  created_by      = excluded.created_by;
