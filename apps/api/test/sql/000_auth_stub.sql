-- 1) Roles mirroring Supabase
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nosuperuser nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nosuperuser nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nosuperuser nologin noinherit bypassrls;
  end if;
end
$$;

-- 2) auth schema + stub functions (Supabase compatibility layer)
create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role()
returns text
language sql stable
as $$
  select coalesce(current_setting('request.jwt.claim.role', true), 'anon')
$$;

create or replace function auth.jwt()
returns jsonb
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

-- Minimal auth.users stub so the profiles FK target resolves.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);
grant usage on schema auth to anon, authenticated, service_role;