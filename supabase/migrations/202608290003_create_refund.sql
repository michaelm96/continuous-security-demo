-- ============================================================================
-- Task 9 — Atomic, idempotent refund RPC (Spec §6.2 + §6.3)
--
-- Creates:
--   * `public_refund_definer` — NOLOGIN NOINHERIT NOBYPASSRLS Postgres role
--     reachable only via the SECURITY DEFINER function below. Not a member
--     of `service_role` (no transitive privilege path).
--   * `public.create_refund(uuid, bigint, char(3), text, text, uuid)` —
--     SECURITY DEFINER PL/pgSQL function that locks the invoice row,
--     re-derives tenant + role from the locked row (defence in depth),
--     enforces stable idempotency, and writes the refund + success audit
--     in one transaction.
--   * Seven grants (Spec §6.2 step 3 + 3a) — narrow, the minimum the
--     function needs to operate under the definer role.
--   * Six forced-RLS policies (Spec §6.2 step 5) — narrowly scoped to
--     `public_refund_definer`; ordinary authenticated policies/grants on
--     these tables are unchanged.
--
-- The function uses `set search_path = ''` (empty search_path) with fully
-- qualified object references, derives the actor from `auth.uid()` only
-- (never from request-supplied identifiers), and REVOKEs EXECUTE from
-- `public` while GRANTing EXECUTE only to `authenticated`. The function
-- is hardened against search-path injection, schema-resolution drift, and
-- direct-connection escalation (the role has no login capability).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Definer role — idempotent create.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'public_refund_definer') then
    create role public_refund_definer nologin noinherit nobypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Drop and recreate the function with the exact Spec §6.3 body. Drop is
--    idempotent; the next `create function` carries the security-definer
--    attributes, the empty `search_path`, and all the runtime guards.
-- ---------------------------------------------------------------------------
drop function if exists public.create_refund(uuid, bigint, char(3), text, text, uuid);

create function public.create_refund(
  p_invoice_id      uuid,
  p_amount_minor    bigint,
  p_currency        char(3),
  p_reason          text,
  p_idempotency_key text,
  p_request_id      uuid
) returns public.refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id        uuid := auth.uid();
  v_invoice         public.invoices%rowtype;
  v_existing        public.refunds%rowtype;
  v_caller_role     public.membership_role;
  v_caller_status   public.membership_status;
  v_sum             bigint;
  v_refund          public.refunds%rowtype;
begin
  if v_actor_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Lock the invoice row to serialize concurrent refund attempts.
  -- Tenant is derived from the invoice row, not from any request-supplied value.
  select * into v_invoice
    from public.invoices
   where id = p_invoice_id
   for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Caller authorization inside the database (defense in depth).
  -- Tenant is derived from v_invoice.organization_id, never from a request argument.
  select role, status
    into v_caller_role, v_caller_status
    from public.memberships
   where organization_id = v_invoice.organization_id
     and user_id = v_actor_id;
  -- Cross-tenant existence hiding: when no membership row exists for the
  -- invoice's organization, the caller cannot distinguish "foreign tenant"
  -- from "no such resource". Indistinguishable not_found.
  if v_caller_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Same-org, known caller with inactive status or insufficient role:
  -- authenticated and present, so respond forbidden (not hidden).
  if v_caller_status <> 'active'
    or v_caller_role not in ('manager', 'organization_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Stable idempotency: evaluated BEFORE mutable invoice-state validation
  -- so that a retry of a previously persisted payload returns the original
  -- even if the invoice has since changed state. Same persisted payload
  -- (same idempotency_key AND same normalized amount_minor/currency/reason)
  -- returns the existing v_existing row directly. The function takes the
  -- early-return path without inserting a new refund row, without appending
  -- a new success audit, and without mutating any other table. The original
  -- success audit row's correlation_id (set when the refund was first created)
  -- is preserved unchanged, so the audit history remains correlatable with
  -- the original creation request rather than with the replay request. The
  -- replay's own request/correlation UUID is observable only in the access
  -- log (one line per request) and is NOT written to audit_events for the
  -- successful-replay path. Same key with a different payload raises
  -- idempotency_conflict (HTTP 409) and rolls back the transaction; the
  -- handler then persists a NEW rejected-attempt audit row through the
  -- isolated AuditService, correlated to the NEW requestId, so the
  -- rejection is correlatable with the request that produced it. Newly
  -- seen keys then undergo state, amount, currency, and cap validation
  -- below.
  select * into v_existing
    from public.refunds
   where invoice_id = p_invoice_id
     and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.amount_minor = p_amount_minor
       and v_existing.currency = p_currency
       and v_existing.reason = p_reason then
      return v_existing;
    else
      raise exception 'idempotency_conflict' using errcode = '40P05';
    end if;
  end if;

  if v_invoice.status not in ('issued', 'paid') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  if p_amount_minor <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  if p_currency <> v_invoice.currency then
    raise exception 'currency_mismatch' using errcode = 'P0001';
  end if;

  -- Cumulative cap. The SELECT ... FOR UPDATE on the invoice row above
  -- serializes concurrent attempts: the second caller waits, re-reads
  -- v_sum under the lock, and is rejected with over_refund if it would
  -- exceed the cap. Concurrent requests cannot over-refund.
  select coalesce(sum(amount_minor), 0) into v_sum
    from public.refunds
   where invoice_id = p_invoice_id;
  if p_amount_minor > v_invoice.amount_minor - v_sum then
    raise exception 'over_refund' using errcode = 'P0001';
  end if;

  insert into public.refunds (
    invoice_id, organization_id, created_by,
    amount_minor, currency, reason, idempotency_key
  ) values (
    p_invoice_id, v_invoice.organization_id, v_actor_id,
    p_amount_minor, p_currency, p_reason, p_idempotency_key
  )
  returning * into v_refund;

  -- Append the SUCCESS audit event in the same transaction as the refund insert
  -- so the refund and its success audit are atomic. correlation_id is the API
  -- request/correlation UUID passed in as p_request_id so the audit row is
  -- correlatable with the originating API request. No bearer tokens or
  -- sensitive bodies are stored in metadata.
  insert into public.audit_events (
    actor_id, organization_id, action, target_type, target_id,
    result, correlation_id, metadata
  ) values (
    v_actor_id, v_invoice.organization_id, 'refund.created',
    'refund', v_refund.id::text, 'success',
    p_request_id,
    jsonb_build_object(
      'invoiceId', v_refund.invoice_id,
      'amountMinor', v_refund.amount_minor,
      'currency', v_refund.currency
    )
  );

  return v_refund;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants to the definer role — exactly the seven privileges the function
--    exercises (Spec §6.2 step 3 + 3a). No broader grants; the definer's
--    exposure to `auth` is limited to `auth.uid()` and the schema-resolve
--    privilege. The column-restricted UPDATE on `invoices.id` admits the
--    `SELECT ... FOR UPDATE` row lock — the function performs no real
--    invoice mutation.
-- ---------------------------------------------------------------------------
grant select on public.invoices    to public_refund_definer;
grant update (id) on public.invoices to public_refund_definer;
grant select on public.memberships  to public_refund_definer;
grant select, insert on public.refunds to public_refund_definer;
grant insert on public.audit_events to public_refund_definer;
grant usage on schema auth         to public_refund_definer;
grant execute on function auth.uid() to public_refund_definer;

-- ---------------------------------------------------------------------------
-- 4. Transfer function ownership to the definer role (required for the
--    SECURITY DEFINER execution path to actually run with `public_refund_definer`
--    privileges). The definer role owns no other object.
-- ---------------------------------------------------------------------------
alter function public.create_refund(uuid, bigint, char(3), text, text, uuid)
  owner to public_refund_definer;

-- ---------------------------------------------------------------------------
-- 5. REVOKE PUBLIC execute; GRANT EXECUTE to `authenticated` only. Without
--    this, every role inherits EXECUTE via the implicit PUBLIC grant.
-- ---------------------------------------------------------------------------
revoke all on function public.create_refund(uuid, bigint, char(3), text, text, uuid)
  from public;
grant execute on function public.create_refund(uuid, bigint, char(3), text, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Six forced-RLS policies targeted to `public_refund_definer`. The role
--    has no BYPASSRLS, so FORCE ROW LEVEL SECURITY on every domain table
--    applies to it; these narrowly scoped policies are the ONLY path that
--    lets the function touch the four tables it needs. Ordinary
--    authenticated policies/grants on these tables are unchanged.
--
--    Policy audit scope (Spec §6.2 step 5):
--      - SELECT on invoices          : read the locked invoice row
--      - UPDATE on invoices (col id) : admit the SELECT ... FOR UPDATE lock
--      - SELECT on memberships       : read (org, user) membership row
--      - SELECT on refunds           : idempotency + cumulative-cap sum
--      - INSERT on refunds           : persist the validated refund row
--      - INSERT on audit_events      : success audit only
--                                     (`action='refund.created' AND result='success'`)
--    Each policy is dropped first to make the migration idempotent on
--    `supabase reset`.
-- ---------------------------------------------------------------------------
drop policy if exists refund_definer_select_invoices        on public.invoices;
drop policy if exists refund_definer_update_invoices_lock   on public.invoices;
drop policy if exists refund_definer_select_memberships     on public.memberships;
drop policy if exists refund_definer_select_refunds         on public.refunds;
drop policy if exists refund_definer_insert_refunds         on public.refunds;
drop policy if exists refund_definer_insert_audit_success   on public.audit_events;

create policy refund_definer_select_invoices
  on public.invoices for select to public_refund_definer
  using (true);  -- the function reads only the row it has locked by id

create policy refund_definer_update_invoices_lock
  on public.invoices for update to public_refund_definer
  using (true)
  with check (true);  -- admits only the row lock taken by SELECT ... FOR UPDATE;
                      -- the function issues no invoice UPDATE, and the role is
                      -- NOLOGIN / NOINHERIT / NOBYPASSRLS so no other caller
                      -- can reach this policy for a real column write

create policy refund_definer_select_memberships
  on public.memberships for select to public_refund_definer
  using (true);  -- the function reads only the row matched on (organization_id, user_id)

create policy refund_definer_select_refunds
  on public.refunds for select to public_refund_definer
  using (true);  -- the function reads only the row matched on (invoice_id, idempotency_key) and the locked invoice's prior refunds

create policy refund_definer_insert_refunds
  on public.refunds for insert to public_refund_definer
  with check (true);  -- the function inserts the validated refund row under the lock

create policy refund_definer_insert_audit_success
  on public.audit_events for insert to public_refund_definer
  with check (action = 'refund.created' and result = 'success');  -- narrowly scoped

-- ============================================================================
-- End of migration. Summary of privilege surface for `public_refund_definer`:
--
--   * NOLOGIN NOINHERIT NOBYPASSRLS, not a member of `service_role`, no
--     credentials — reachable only via the create_refund function call
--     interface as `authenticated`.
--   * Owns exactly one object: `public.create_refund(...)`.
--   * Has been granted exactly the seven privileges listed in step 3,
--     including `usage on schema auth` and `execute on function auth.uid()`
--     (Spec §6.2 step 3a) so `auth.uid()` resolves and executes under the
--     definer's identity.
--   * Admitted by exactly the six forced-RLS policies listed in step 5,
--     narrowly scoped to the operations the function actually performs;
--     the audit-events INSERT policy admits only `refund.created`/`success`
--     rows.
--   * `create_refund(...)` is REVOKEd from PUBLIC and GRANTed EXECUTE only
--     to `authenticated`, with `set search_path = ''` and fully qualified
--     object references throughout the body.
-- ============================================================================
