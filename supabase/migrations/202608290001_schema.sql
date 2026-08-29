-- Extensions
create extension if not exists pgcrypto;
create extension if not exists citext;

-- profiles: 1:1 with auth.users
create table public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- organizations
create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- memberships: user <-> organization with a role and active flag
create type public.membership_role as enum ('user', 'manager', 'organization_admin');
create type public.membership_status as enum ('active', 'suspended');

create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(user_id) on delete cascade,
  role            public.membership_role not null,
  status          public.membership_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index on public.memberships (user_id);
create index on public.memberships (organization_id);

-- invoices
create type public.invoice_status as enum ('draft', 'issued', 'paid', 'cancelled');

create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  owner_id        uuid not null default auth.uid() references public.profiles(user_id) on delete restrict,
  customer_id     text not null check (char_length(customer_id) between 1 and 128),
  description     text not null check (char_length(description) between 1 and 1024),
  amount_minor    bigint not null check (amount_minor between 1 and 9007199254740991),
  currency        char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status          public.invoice_status not null default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.invoices (organization_id);
create index on public.invoices (owner_id);

-- refunds
create table public.refunds (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  created_by      uuid not null references public.profiles(user_id) on delete restrict,
  amount_minor    bigint not null check (amount_minor > 0),
  currency        char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reason          text not null check (char_length(reason) between 1 and 512),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  created_at      timestamptz not null default now(),
  unique (invoice_id, idempotency_key)
);
create index on public.refunds (organization_id);

-- audit_events
create table public.audit_events (
  id              uuid primary key default gen_random_uuid(),
  actor_id        uuid references public.profiles(user_id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  action          text not null,
  target_type     text not null,
  target_id       text,
  result          text not null check (result in ('success', 'rejected', 'failure')),
  correlation_id  uuid not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index on public.audit_events (organization_id, created_at desc);
create index on public.audit_events (correlation_id);