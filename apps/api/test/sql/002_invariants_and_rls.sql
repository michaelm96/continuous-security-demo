-- =========================================================================
-- Part A: Invoice state transition trigger
-- =========================================================================
create or replace function public.enforce_invoice_state_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (
    (old.status = 'draft' and new.status in ('issued', 'cancelled')) or
    (old.status = 'issued' and new.status in ('paid', 'cancelled')) or
    old.status = new.status
  ) then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_invoice_state on public.invoices;
create trigger trg_enforce_invoice_state
  before update of status on public.invoices
  for each row execute function public.enforce_invoice_state_transition();

-- =========================================================================
-- Part B: Concurrency-safe last-admin membership trigger
-- =========================================================================
create or replace function public.enforce_last_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_other_active_admins integer;
begin
  if old.role = 'organization_admin'
     and old.status = 'active'
     and (new.role <> 'organization_admin' or new.status <> 'active') then
    perform 1
      from public.organizations
      where id = old.organization_id
      for update;

    select count(*) into v_other_active_admins
      from public.memberships
      where organization_id = old.organization_id
        and user_id <> old.user_id
        and role = 'organization_admin'
        and status = 'active';

    if v_other_active_admins = 0 then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_last_admin on public.memberships;
create trigger trg_enforce_last_admin
  before update of role, status on public.memberships
  for each row execute function public.enforce_last_admin();

-- =========================================================================
-- Part C: Forced RLS + helpers + column grants + policies + health_check
-- =========================================================================

-- 1) Forced RLS on every domain table
alter table public.profiles      enable row level security;
alter table public.profiles      force  row level security;
alter table public.organizations enable row level security;
alter table public.organizations force  row level security;
alter table public.memberships   enable row level security;
alter table public.memberships   force  row level security;
alter table public.invoices      enable row level security;
alter table public.invoices      force  row level security;
alter table public.refunds       enable row level security;
alter table public.refunds       force  row level security;
alter table public.audit_events  enable row level security;
alter table public.audit_events  force  row level security;

-- 2) Narrow helpers used by RLS predicates (no recursive policy lookups)
create or replace function public.active_membership_role(p_organization_id uuid)
returns public.membership_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
    from public.memberships m
   where m.organization_id = p_organization_id
     and m.user_id = auth.uid()
     and m.status = 'active'
   limit 1
$$;
revoke all on function public.active_membership_role(uuid) from public;
grant execute on function public.active_membership_role(uuid) to authenticated;

create or replace function public.shares_active_organization(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.memberships m1
      join public.memberships m2
        on m2.organization_id = m1.organization_id
     where m1.user_id = auth.uid()
       and m1.status = 'active'
       and m2.user_id = p_user_id
       and m2.status = 'active'
  )
$$;
revoke all on function public.shares_active_organization(uuid) from public;
grant execute on function public.shares_active_organization(uuid) to authenticated;

-- 3) Revoke all table privileges from anon, authenticated; then grant exactly
revoke all on public.profiles      from anon, authenticated;
revoke all on public.organizations from anon, authenticated;
revoke all on public.memberships   from anon, authenticated;
revoke all on public.invoices      from anon, authenticated;
revoke all on public.refunds       from anon, authenticated;
revoke all on public.audit_events  from anon, authenticated;

grant select on public.profiles, public.organizations, public.memberships,
  public.invoices, public.refunds to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant update (role, status)   on public.memberships to authenticated;
grant insert (organization_id, customer_id, description, amount_minor, currency)
  on public.invoices to authenticated;
grant update (status) on public.invoices to authenticated;

-- 4) RLS policies — exact inventory below. No DELETE policy. No INSERT/UPDATE/DELETE
--    policies for `refunds` or `audit_events` for `authenticated`. Every policy
--    drops first to make the migration idempotent on `supabase reset`.
drop policy if exists profiles_select_visible       on public.profiles;
drop policy if exists profiles_update_self         on public.profiles;
drop policy if exists organizations_select_member  on public.organizations;
drop policy if exists memberships_select_self      on public.memberships;
drop policy if exists memberships_select_tenant    on public.memberships;
drop policy if exists memberships_update_admin     on public.memberships;
drop policy if exists invoices_select_visible      on public.invoices;
drop policy if exists invoices_insert_manager      on public.invoices;
drop policy if exists invoices_update_manager      on public.invoices;
drop policy if exists refunds_select_visible       on public.refunds;

create policy profiles_select_visible on public.profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.shares_active_organization(user_id)
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using       (user_id = auth.uid())
  with check  (user_id = auth.uid());

create policy organizations_select_member on public.organizations
  for select to authenticated
  using (public.active_membership_role(id) is not null);

create policy memberships_select_self on public.memberships
  for select to authenticated
  using (user_id = auth.uid());

create policy memberships_select_tenant on public.memberships
  for select to authenticated
  using (public.active_membership_role(organization_id) is not null);

create policy memberships_update_admin on public.memberships
  for update to authenticated
  using      (public.active_membership_role(organization_id) = 'organization_admin')
  with check (true);

create policy invoices_select_visible on public.invoices
  for select to authenticated
  using (
    (public.active_membership_role(organization_id) in ('manager','organization_admin'))
    or (public.active_membership_role(organization_id) = 'user' and owner_id = auth.uid())
  );

create policy invoices_insert_manager on public.invoices
  for insert to authenticated
  with check (
    public.active_membership_role(organization_id) in ('manager','organization_admin')
    and owner_id = auth.uid()
  );

create policy invoices_update_manager on public.invoices
  for update to authenticated
  using      (public.active_membership_role(organization_id) in ('manager','organization_admin'))
  with check (public.active_membership_role(organization_id) in ('manager','organization_admin'));

create policy refunds_select_visible on public.refunds
  for select to authenticated
  using (
    exists (
      select 1
        from public.invoices i
       where i.id = refunds.invoice_id
         and (
           (public.active_membership_role(i.organization_id) in ('manager','organization_admin'))
           or (public.active_membership_role(i.organization_id) = 'user' and i.owner_id = auth.uid())
         )
    )
  );

-- 5) Anonymous readiness capability — table-independent, anon-only
create or replace function public.health_check()
returns boolean
language sql
stable
security invoker
set search_path = ''
as 'select true';

revoke all on function public.health_check() from public, authenticated;
grant execute on function public.health_check() to anon;