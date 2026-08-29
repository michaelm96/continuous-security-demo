# Continuous Security Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Project 1: a locally runnable, secure-by-default multi-tenant invoice and refund application whose NestJS authorization and PostgreSQL RLS boundaries are proven by tests.

**Architecture:** A plain npm-workspaces repository contains a Next.js App Router web app and one NestJS API. Supabase Auth issues user JWTs; Nest verifies them and passes the original token to caller-scoped Supabase clients, while PostgreSQL RLS provides the second authorization layer. Refund creation is one hardened PostgreSQL transaction; the only service-role client is private to `AuditModule`.

**Tech Stack:** Node.js 26.8.1, npm 12.0.2, npm workspaces, TypeScript 7.0.2, Next.js 16.3.3 App Router, Tailwind CSS 4.3.3, NestJS 12.0.1, `@nestjs/swagger`, `jose`, `@supabase/supabase-js`, `@supabase/ssr`, PostgreSQL 15, Supabase CLI 2.116.0, Jest, Supertest.

**Version baseline (npm registry, 2026-08-29):** Use Node.js `26.8.1` and exact versions in manifests, then commit the lockfile: `npm@12.0.2`, `typescript@7.0.2`, `create-next-app@16.3.3`, `next@16.3.3`, `tailwindcss@4.3.3`, `@nestjs/cli@12.0.0`, `@nestjs/{common,core,platform-express,swagger}@12.0.1`, `react@19.2.8`, `react-dom@19.2.8`, `@supabase/supabase-js@2.112.4`, `@supabase/ssr@0.12.5`, `jose@6.2.10`, `@nestjs/config@12.0.0`, `class-validator@0.15.1`, `class-transformer@0.5.1`, `helmet@8.3.0`, `pino-http@11.0.0`, `express-rate-limit@8.6.2`, `pg@8.23.0`, `@types/pg@8.23.1`, `@swc/core@1.16.1`, and `@swc/jest@0.2.39`. Use `supabase@2.116.0` as the local CLI prerequisite. Nest CLI 12's generated `ts-jest` does not support TypeScript 7, so remove it and use the pinned SWC transformer. Do not substitute floating version tags during implementation. `@nestjs/throttler` is not listed because no published version supports NestJS 12; use `express-rate-limit` instead and wrap it in a Nest middleware or guard.

**Spec:** `docs/superpowers/specs/2026-03-09-continuous-security-demo-design.md`

## Global Constraints

- Implement only Project 1. Do not add CI, GitHub Actions, scanners, vulnerable fixtures, fuzzing, DAST, ZAP, Playwright, staging, AI review, SARIF, or a findings platform.
- Use plain npm workspaces. Do not add Nx, Turborepo, Lerna, an ORM, microservices, a message broker, or a custom policy engine.
- The browser uses Supabase only for authentication; all domain requests go through NestJS. PostgREST is not a public application endpoint.
- Verify JWT signature plus `iss`, `aud`, `exp`, and `iat`; derive role, tenant, and ownership from PostgreSQL on every request.
- `DatabaseModule` exports only `callerClient(accessToken: string): SupabaseClient`; it never reads or exports `SUPABASE_SERVICE_ROLE_KEY`.
- Only the private audit-writer provider in `apps/api/src/audit/audit.module.ts` may read `SUPABASE_SERVICE_ROLE_KEY` in runtime source.
- Every domain table uses `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`; direct caller-token tests must prove the policy boundary.
- Money is integer minor units. DTO and invoice DB bounds are `1..9007199254740991` (`Number.MAX_SAFE_INTEGER`); never use floating point, and test `9007199254740990`, `9007199254740991`, and rejection of `9007199254740992`.
- Errors use RFC 9457 Problem Details with `title`, numeric `status`, one stable `code`, and `requestId` matching `X-Request-Id`.
- Use TDD for behavior, keep one focused commit per task, and do not weaken security, validation, auditability, accessibility, or error handling to shorten the implementation.

---

## Planned File Map

### Repository root

- `package.json` — npm workspace declaration and root install/build/test/Supabase scripts.
- `package-lock.json` — one committed dependency lock for both workspaces.
- `.nvmrc` — exact Node.js `26.8.1` runtime pin.
- `tsconfig.base.json` — shared strict TypeScript defaults.
- `.gitignore` — excludes dependencies, builds, local Supabase state, and real environment files.
- `.env.example` — non-secret configuration names and local URLs.
- `README.md` — short entry point linking the approved design, plan, and delivery guide.

### Supabase

- `supabase/config.toml` — local project ports, Auth settings, migrations, and seed activation.
- `supabase/migrations/202608290001_schema.sql` — extensions, enum types, tables, indexes, grants, and base constraints from Spec §6.1.
- `supabase/migrations/202608290002_invariants_rls.sql` — invoice-transition and last-admin triggers, forced RLS, authenticated column grants, and caller policies from Spec §§6.2 and 6.4.
- `supabase/migrations/202608290003_create_refund.sql` — `public_refund_definer`, its exact grants, six targeted policies, `auth.uid()` privileges, and `public.create_refund` from Spec §6.3.
- `supabase/seed.sql` — deterministic, idempotent local users, profiles, two organizations, memberships, and invoices.

### NestJS API

- `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`, `apps/api/nest-cli.json`, `apps/api/jest.config.ts`, `apps/api/.swcrc`, `apps/api/test/jest-e2e.json` — workspace, Nest build, and TypeScript-7-compatible SWC/Jest configuration.
- `apps/api/src/main.ts` — validated startup, 100 KB limits, CORS, Helmet, throttling, request IDs, Problem Details, OpenAPI gate, logging, and shutdown.
- `apps/api/src/app.module.ts` — imports the nine approved modules only: Auth, Organizations, Invoices, Refunds, Audit, Health, Database, Config, and Common.
- `apps/api/src/config/env.ts`, `apps/api/src/config/config.module.ts`, `apps/api/src/config/env.spec.ts` — typed configuration and fail-closed startup validation.
- `apps/api/src/common/common.module.ts`, `apps/api/src/common/problem-details.ts`, `apps/api/src/common/problem-details.filter.ts`, `apps/api/src/common/request-id.middleware.ts`, `apps/api/src/common/json-depth.middleware.ts`, `apps/api/src/common/access-log.interceptor.ts` — common provider registration, stable public errors, a maximum JSON depth of 20, and redacted structured request logs.
- `apps/api/src/database/database.module.ts`, `apps/api/src/database/caller-client.ts` — anon-key caller client factory and its single exported token.
- `apps/api/src/auth/principal.ts`, `apps/api/src/auth/jwt-verifier.ts`, `apps/api/src/auth/auth.guard.ts`, `apps/api/src/auth/current-principal.decorator.ts`, `apps/api/src/auth/me.controller.ts`, `apps/api/src/auth/me.service.ts`, `apps/api/src/auth/auth.module.ts` — JWT verification, request principal, and `GET /me`.
- `apps/api/src/organizations/dto/patch-membership.dto.ts`, `apps/api/src/organizations/membership.service.ts`, `apps/api/src/organizations/organizations.controller.ts`, `apps/api/src/organizations/organizations.module.ts` — organization/member reads and last-admin-safe updates.
- `apps/api/src/invoices/dto/create-invoice.dto.ts`, `apps/api/src/invoices/dto/patch-invoice.dto.ts`, `apps/api/src/invoices/invoice-state.ts`, `apps/api/src/invoices/invoice-state.spec.ts`, `apps/api/src/invoices/invoice.service.ts`, `apps/api/src/invoices/invoice.service.spec.ts`, `apps/api/src/invoices/invoices.controller.ts`, `apps/api/src/invoices/invoices.module.ts` — invoice allowlists, ownership, reads, creation, and transitions.
- `apps/api/src/audit/audit.types.ts`, `apps/api/src/audit/audit.service.ts`, `apps/api/src/audit/audit.module.ts` — mandatory audit writes and the private service-role client.
- `apps/api/src/refunds/dto/create-refund.dto.ts`, `apps/api/src/refunds/refund.service.ts`, `apps/api/src/refunds/refund.service.spec.ts`, `apps/api/src/refunds/refunds.controller.ts`, `apps/api/src/refunds/refunds.module.ts` — RPC invocation, rejection mapping, and fail-closed rejection auditing.
- `apps/api/src/health/health.service.ts`, `apps/api/src/health/health.controller.ts`, `apps/api/src/health/health.module.ts` — database/Auth/JWKS readiness.
- `apps/api/test/helpers/seed-identities.ts`, `apps/api/test/helpers/auth.ts`, `apps/api/test/helpers/problem-details.ts` — deterministic IDs, real sign-in, and shared assertions.
- `apps/api/test/schema.rls-spec.ts` — real-Supabase schema, grant, RLS, ownership, transition, and last-admin checks.
- `apps/api/test/app.e2e-spec.ts` — HTTP auth, organization, membership, invoice, health, DTO, OpenAPI, and error-contract matrix.
- `apps/api/test/refunds.e2e-spec.ts` — refund role, state, cap, idempotency, concurrency, and audit matrix.
- `apps/api/src/architecture.spec.ts` — service-role containment source/import test executed by the unit-test configuration.

### Next.js web

- `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs` — workspace package and Next build configuration.
- `apps/web/src/proxy.ts` — Next.js 16 proxy that refreshes Supabase auth cookies and redirects unauthenticated app routes.
- `apps/web/src/lib/supabase/client.ts`, `apps/web/src/lib/supabase/server.ts` — browser/server auth clients only.
- `apps/web/src/lib/api.ts`, `apps/web/src/lib/types.ts` — bearer-token Nest API client and response types.
- `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css` — accessible document shell and Tailwind styles.
- `apps/web/src/app/(public)/login/page.tsx`, `apps/web/src/app/(public)/login/actions.ts` — seeded-identity password sign-in; no registration or recovery.
- `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/components/app-nav.tsx`, `apps/web/src/components/sign-out-button.tsx` — authenticated, role-aware navigation.
- `apps/web/src/app/(app)/dashboard/page.tsx` — caller profile and active memberships.
- `apps/web/src/app/(app)/invoices/page.tsx`, `apps/web/src/app/(app)/invoices/new/page.tsx`, `apps/web/src/app/(app)/invoices/[invoiceId]/page.tsx`, `apps/web/src/app/(app)/invoices/actions.ts`, `apps/web/src/components/invoice-form.tsx` — invoice list/create/detail/status UI and server actions.
- `apps/web/src/app/(app)/refunds/page.tsx`, `apps/web/src/app/(app)/refunds/actions.ts`, `apps/web/src/components/refund-form.tsx` — manager/admin refund UI and server action.
- `apps/web/src/app/(app)/admin/members/page.tsx`, `apps/web/src/app/(app)/admin/members/actions.ts`, `apps/web/src/components/member-form.tsx` — admin membership UI, server action, and visible last-admin errors.

### Documentation

- `docs/superpowers/specs/2026-03-09-continuous-security-demo-delivery.md` — exact install/start/reset/seed/run/test/build commands, local identities, and manual role walkthrough.

## Shared Contracts

```ts
export type MembershipRole = 'user' | 'manager' | 'organization_admin';
export type MembershipStatus = 'active' | 'suspended';
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

export interface Principal {
  userId: string;
  accessToken: string;
}

export interface Organization { id: string; name: string; }
export interface Membership { organizationId: string; userId: string; role: MembershipRole; status: MembershipStatus; }
export interface Invoice { id: string; organizationId: string; ownerId: string; customerId: string; description: string; amountMinor: number; currency: string; status: InvoiceStatus; }
export interface Refund { id: string; invoiceId: string; organizationId: string; createdBy: string; amountMinor: number; currency: string; reason: string; idempotencyKey: string; }

export const CALLER_CLIENT = Symbol('CALLER_CLIENT');
export type CallerClient = (accessToken: string) => SupabaseClient;

export interface ProblemDetails {
  title: string;
  status: number;
  code: 'validation_failed' | 'unauthenticated' | 'forbidden' | 'not_found' |
    'idempotency_conflict' | 'invalid_state' | 'last_admin' | 'over_refund' |
    'invalid_amount' | 'currency_mismatch' | 'throttled' |
    'dependency_unavailable' | 'audit_unavailable' | 'internal';
  requestId: string;
  type?: string;
  detail?: string;
  instance?: string;
}
```

### Task 1: Bootstrap the npm Workspaces and Runnable Shells

**Files:**
- Create: `package.json`, `package-lock.json`, `.nvmrc`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `README.md`
- Create via official CLIs: `apps/api/**`, `apps/web/**`
- Modify: `apps/api/package.json`, `apps/web/package.json`, `apps/api/jest.config.ts`, `apps/api/test/jest-e2e.json`, `apps/api/src/app.controller.ts`, `apps/api/src/app.controller.spec.ts`
- Create: `apps/api/.swcrc`
- Test: `apps/api/src/app.controller.spec.ts`; frontend `typecheck` and `build` scripts

**Interfaces:**
- Produces root scripts: `build`, `test`, `typecheck`, `supabase:start`, `supabase:reset`.
- Produces workspace names `@continuous-security-demo/api` and `@continuous-security-demo/web`.
- Later tasks consume strict TypeScript compilation and the generated Nest/Next entry points.

- [ ] **Step 1: Prove the empty repository has no runnable workspace**

Run from the repository root:

```bash
npm test
```

Expected: FAIL because root `package.json` does not exist.

- [ ] **Step 2: Select the exact toolchain and create the root workspace contract**

Use the repository `.nvmrc` contract to install Node, then replace Node 26.8.1's bundled npm with the required npm 12.0.2 before any generator runs:

```bash
printf '26.8.1\n' > .nvmrc
nvm install 26.8.1
nvm use 26.8.1
npm install --global npm@12.0.2
test "$(node --version)" = "v26.8.1"
test "$(npm --version)" = "12.0.2"
```

Create `package.json` with this initial content:

```json
{
  "name": "continuous-security-demo",
  "private": true,
  "packageManager": "npm@12.0.2",
  "engines": { "node": ">=26.8.1 <27", "npm": ">=12.0.2 <13" },
  "workspaces": ["apps/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test:unit -w @continuous-security-demo/api && npm run test:rls -w @continuous-security-demo/api && npm run test:e2e -w @continuous-security-demo/api",
    "supabase:start": "supabase start",
    "supabase:reset": "supabase db reset"
  }
}
```

Create `.nvmrc` containing exactly `26.8.1`. Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

Create `.gitignore` with `node_modules/`, `dist/`, `.next/`, `coverage/`, `.env`, `.env.local`, and `supabase/.temp/`. Create `.env.example` with local URLs, empty key values, `API_PORT=3001`, `WEB_ORIGIN=http://localhost:3000`, `SUPABASE_JWT_AUDIENCE=authenticated`, `SUPABASE_JWT_ISSUER=http://127.0.0.1:54321/auth/v1`, `OPENAPI_ENABLED=true`, `RATE_LIMIT_AUTHENTICATED=60`, `RATE_LIMIT_ANONYMOUS=20`, and `LOG_LEVEL=info`.

- [ ] **Step 3: Generate only the approved framework shells**

```bash
npx @nestjs/cli@12.0.0 new apps/api --package-manager npm --skip-git --strict
npx create-next-app@16.3.3 apps/web --typescript --tailwind --eslint --app --src-dir --use-npm --import-alias '@/*'
rm -f apps/api/package-lock.json apps/web/package-lock.json
npm pkg set name=@continuous-security-demo/api --workspace apps/api
npm pkg set name=@continuous-security-demo/web --workspace apps/web
npm pkg set scripts.typecheck='tsc --noEmit' --workspace apps/api
npm pkg set scripts.typecheck='tsc --noEmit' --workspace apps/web
npm pkg set scripts.test:unit='jest --runInBand --testPathIgnorePatterns=/test/' --workspace apps/api
npm pkg set scripts.test:rls='jest --runInBand --config test/jest-rls.json' --workspace apps/api
npm pkg set scripts.test:e2e='jest --runInBand --config test/jest-e2e.json' --workspace apps/api
npm install --save-exact -w @continuous-security-demo/api @nestjs/common@12.0.1 @nestjs/core@12.0.1 @nestjs/platform-express@12.0.1
npm uninstall -w @continuous-security-demo/api ts-jest
npm install --save-dev --save-exact -w @continuous-security-demo/api @nestjs/cli@12.0.0 typescript@7.0.2 @swc/core@1.16.1 @swc/jest@0.2.39
npm install --save-dev --save-exact supabase@2.116.0
npm install --save-exact -w @continuous-security-demo/web next@16.3.3 react@19.2.8 react-dom@19.2.8
npm install --save-dev --save-exact -w @continuous-security-demo/web typescript@7.0.2 tailwindcss@4.3.3
```

Expected: one root `package-lock.json`; no nested lock files; no Nx, Turborepo, ORM, CI, or scanner package.

Replace the generated `ts-jest` transforms in `apps/api/jest.config.ts` and `apps/api/test/jest-e2e.json` with `@swc/jest`; remove the generated `pathsToModuleNameMapper` import and mapping because the API has no TypeScript path aliases. Create `apps/api/.swcrc` exactly as follows so Nest legacy decorators and metadata work in every Jest project:

```json
{
  "$schema": "https://swc.rs/schema.json",
  "jsc": {
    "parser": { "syntax": "typescript", "decorators": true },
    "transform": { "legacyDecorator": true, "decoratorMetadata": true },
    "target": "es2022"
  },
  "module": { "type": "commonjs" },
  "sourceMaps": "inline"
}
```

Set each Jest transform to `"^.+\\.(t|j)s$": "@swc/jest"`. Use the same transform in the Task 2 `jest-rls.json`; `ts-jest` must not remain in any manifest or Jest config.

- [ ] **Step 4: Keep one observable shell test**

Change the generated controller to return `{ "name": "continuous-security-demo-api" }` and assert exact equality in `apps/api/src/app.controller.spec.ts`:

```ts
expect(appController.getHello()).toEqual({ name: 'continuous-security-demo-api' });
```

- [ ] **Step 5: Verify both shells**

```bash
npm run test:unit -w @continuous-security-demo/api
npm run typecheck --workspaces --if-present
npm run build --workspaces --if-present
```

Expected: the Nest unit test passes, both workspaces typecheck, and both production builds succeed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .nvmrc tsconfig.base.json .gitignore .env.example README.md apps/api apps/web
git commit -m "chore: bootstrap Project 1 workspaces"
```

### Task 2: Create the Domain Schema, Invariant Triggers, Grants, and RLS

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202608290001_schema.sql`
- Create: `supabase/migrations/202608290002_invariants_rls.sql`
- Create: `apps/api/test/schema.rls-spec.ts`, `apps/api/test/jest-rls.json`
- Modify: `apps/api/package.json`

`jest-rls.json` uses the Task 1 `@swc/jest` transform and `apps/api/.swcrc`; do not reintroduce `ts-jest`.

**Interfaces:**
- Produces tables `profiles`, `organizations`, `memberships`, `invoices`, `refunds`, `audit_events` and their enum types.
- Produces SQL exceptions `last_admin` and `invalid_state`.
- Produces caller-visible grants and RLS policies consumed by all domain services.
- Produces table-independent `public.health_check(): boolean`, executable only by `anon`, for database readiness without anonymous table access.

- [ ] **Step 1: Add a failing real-Postgres schema test**

Install the pinned PostgreSQL test client:

```bash
npm install --save-dev --save-exact -w @continuous-security-demo/api pg@8.23.0 @types/pg@8.23.1
```

Write `schema.rls-spec.ts` to connect to the local database URL returned by `npx supabase@2.116.0 status -o env`, query `pg_class`, and assert all six tables have both flags:

```ts
expect(rows).toEqual(expect.arrayContaining([
  expect.objectContaining({ relname: 'profiles', relrowsecurity: true, relforcerowsecurity: true }),
  expect.objectContaining({ relname: 'organizations', relrowsecurity: true, relforcerowsecurity: true }),
  expect.objectContaining({ relname: 'memberships', relrowsecurity: true, relforcerowsecurity: true }),
  expect.objectContaining({ relname: 'invoices', relrowsecurity: true, relforcerowsecurity: true }),
  expect.objectContaining({ relname: 'refunds', relrowsecurity: true, relforcerowsecurity: true }),
  expect.objectContaining({ relname: 'audit_events', relrowsecurity: true, relforcerowsecurity: true })
]));
```

Run:

```bash
npm run supabase:start
npm run test:rls -w @continuous-security-demo/api -- --runTestsByPath test/schema.rls-spec.ts
```

Expected: FAIL because the domain relations do not exist.

- [ ] **Step 2: Add the schema migration exactly from the approved design**

Copy the complete executable SQL block in Spec §6.1 into `202608290001_schema.sql`, preserving all names, foreign keys, indexes, enums, and checks. In particular, keep:

```sql
amount_minor bigint not null check (amount_minor between 1 and 9007199254740991),
currency char(3) not null check (currency ~ '^[A-Z]{3}$')
```

and `unique (invoice_id, idempotency_key)` on `refunds`.

- [ ] **Step 3: Add the DB-enforced state and last-admin invariants**

In `202608290002_invariants_rls.sql`, create one invoice transition trigger that permits only `draft → issued`, `issued → paid`, and `draft|issued → cancelled`. Create one membership trigger that locks the organization row, counts active admins after the proposed update, and raises `last_admin` with SQLSTATE `P0001` before a demotion or suspension would reduce the count to zero.

The transition predicate must be explicit:

```sql
if not (
  (old.status = 'draft' and new.status in ('issued', 'cancelled')) or
  (old.status = 'issued' and new.status in ('paid', 'cancelled')) or
  old.status = new.status
) then
  raise exception 'invalid_state' using errcode = 'P0001';
end if;
```

Use this concurrency-safe membership trigger body; attach it `before update of role, status on public.memberships for each row`:

```sql
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
```

- [ ] **Step 4: Add forced RLS and column grants**

Implement the caller-role contract from Spec §6.2 with no recursive policy lookups. Add only two hardened `stable security definer set search_path = ''` helpers owned by `postgres`: `public.active_membership_role(p_organization_id uuid) returns public.membership_role` (returns the current `auth.uid()` caller's role only when active) and `public.shares_active_organization(p_user_id uuid) returns boolean` (true only when caller and target have active memberships in one organization). Revoke their execution from `public`/`anon` and grant it only to `authenticated`; these narrow predicates exist because a membership policy cannot safely query `memberships` recursively.

Enable and force RLS on all six tables, revoke all table privileges from `anon, authenticated`, then grant exactly:

```sql
grant select on public.profiles, public.organizations, public.memberships,
  public.invoices, public.refunds to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant update (role, status) on public.memberships to authenticated;
grant insert (organization_id, customer_id, description, amount_minor, currency)
  on public.invoices to authenticated;
grant update (status) on public.invoices to authenticated;
```

Create this exact policy inventory (all expressions use fully qualified objects and `auth.uid()`):

| Policy | Operation | Predicate contract |
|---|---|---|
| `profiles_select_visible` | profiles SELECT | self or `shares_active_organization(user_id)` |
| `profiles_update_self` | profiles UPDATE | `user_id = auth.uid()` for USING and WITH CHECK |
| `organizations_select_member` | organizations SELECT | `active_membership_role(id) is not null` |
| `memberships_select_self` | memberships SELECT | `user_id = auth.uid()`; exposes only the caller's own row so Nest can map suspended self to 403 |
| `memberships_select_tenant` | memberships SELECT | `active_membership_role(organization_id) is not null` |
| `memberships_update_admin` | memberships UPDATE | `active_membership_role(organization_id) = 'organization_admin'` in USING; WITH CHECK true because column grants prevent tenant/user changes |
| `invoices_select_visible` | invoices SELECT | active `user` owns row, or active manager/admin belongs to row organization |
| `invoices_insert_manager` | invoices INSERT | manager/admin for `organization_id` and `owner_id = auth.uid()` |
| `invoices_update_manager` | invoices UPDATE | manager/admin for row organization in USING and WITH CHECK; column grant exposes only `status` |
| `refunds_select_visible` | refunds SELECT | an `exists` subquery finds its invoice through `invoices_select_visible` |

Do not create authenticated INSERT/UPDATE/DELETE policies or grants for `refunds` or `audit_events`, any DELETE policy, or any broader grant. Add exactly one anonymous readiness capability:

```sql
create or replace function public.health_check()
returns boolean
language sql
stable
security invoker
set search_path = ''
as 'select true';
revoke all on function public.health_check() from public, authenticated;
grant execute on function public.health_check() to anon;
```

`anon` receives no domain-table privilege. Finish with catalog assertions in `schema.rls-spec.ts` that compare the policy names, commands, roles, forced-RLS flags, column privileges, and the lone anonymous function grant to this inventory.

- [ ] **Step 5: Reset and prove the DB boundary**

Extend `schema.rls-spec.ts` to assert: all six RLS flags; an anon client can call `health_check()` but cannot select any domain table; a suspended token can select only its own membership row and own profile, with no organization/invoice/refund or other-profile rows; direct authenticated refund/audit inserts fail; invoice authority-column writes fail; invalid amount/currency/length fail; `paid → cancelled` and `issued → draft` fail; final-admin demotion and suspension fail.

```bash
npm run supabase:reset
npm run test:rls -w @continuous-security-demo/api -- --runTestsByPath test/schema.rls-spec.ts
```

Expected: PASS with tests talking to the real local Postgres instance.

- [ ] **Step 6: Commit**

```bash
git add supabase apps/api/test apps/api/package.json package-lock.json
git commit -m "feat: enforce tenant schema and RLS"
```

### Task 3: Add Deterministic Local Identities and Test Authentication Helpers

**Files:**
- Create: `supabase/seed.sql`
- Create: `apps/api/test/helpers/seed-identities.ts`
- Create: `apps/api/test/helpers/auth.ts`
- Modify: `apps/api/test/schema.rls-spec.ts`, `apps/api/package.json`, `package-lock.json`

**Interfaces:**
- Produces `SEED_IDENTITIES` with keys `alphaAdmin`, `alphaManager`, `alphaUserA`, `alphaUserB`, `alphaSuspended`, `betaAdmin`.
- Produces `signIn(identity: SeedIdentity): Promise<string>` returning a real Supabase access token.
- Produces stable organization and invoice UUIDs for RLS/e2e tests.

- [ ] **Step 1: Write the failing sign-in/visibility test**

Install the exact Supabase client before importing it in this task:

```bash
npm install --save-exact -w @continuous-security-demo/api @supabase/supabase-js@2.112.4
```

```ts
const token = await signIn(SEED_IDENTITIES.alphaUserA);
expect(token.split('.')).toHaveLength(3);
expect(await visibleInvoiceIds(token)).toEqual([SEED_IDS.alphaUserAInvoice]);
```

Run after `npm run supabase:reset`. Expected: FAIL because the user and fixtures are absent.

- [ ] **Step 2: Define stable fixtures**

Use fixed UUIDs in `seed-identities.ts` and matching rows in `seed.sql`. Seed these exact local-only accounts:

| Key | Email | Password | Organization | Role/status |
|---|---|---|---|---|
| `alphaAdmin` | `admin.alpha@example.test` | `LocalOnly-Admin1!` | Alpha | `organization_admin/active` |
| `alphaManager` | `manager.alpha@example.test` | `LocalOnly-Manager1!` | Alpha | `manager/active` |
| `alphaUserA` | `user-a.alpha@example.test` | `LocalOnly-UserA1!` | Alpha | `user/active` |
| `alphaUserB` | `user-b.alpha@example.test` | `LocalOnly-UserB1!` | Alpha | `user/active` |
| `alphaSuspended` | `suspended.alpha@example.test` | `LocalOnly-Suspended1!` | Alpha | `user/suspended` |
| `betaAdmin` | `admin.beta@example.test` | `LocalOnly-Admin2!` | Beta | `organization_admin/active` |

Insert `auth.users` and `auth.identities` rows with `crypt(password, gen_salt('bf'))`, confirmed email timestamps, and email provider metadata. Use `insert ... on conflict (id) do update` for identities and domain fixtures so a second seed execution preserves the fixed IDs and row counts.

- [ ] **Step 3: Seed ownership and tenant cases**

Seed an Alpha draft invoice owned by User A, an Alpha issued invoice owned by User B, Alpha issued/paid/cancelled refund fixtures, and one Beta invoice. Use valid three-letter currency and integer minor units. Do not seed an audit event containing a bearer token, header, full body, or raw refund reason.

- [ ] **Step 4: Implement real sign-in**

```ts
export async function signIn(identity: SeedIdentity): Promise<string> {
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await client.auth.signInWithPassword(identity);
  if (error || !data.session) throw error ?? new Error('seed_sign_in_failed');
  return data.session.access_token;
}
```

- [ ] **Step 5: Verify determinism and caller visibility**

```bash
npm run supabase:reset
npm run test:rls -w @continuous-security-demo/api
npm run supabase:reset
npm run test:rls -w @continuous-security-demo/api
```

Expected: both runs pass with identical IDs and counts; User A sees own invoice only, manager sees all Alpha invoices, and no Alpha caller sees Beta rows.

- [ ] **Step 6: Commit**

```bash
git add supabase/seed.sql apps/api/test apps/api/package.json package-lock.json
git commit -m "test: seed deterministic tenant identities"
```

### Task 4: Build the Fail-Closed API Edge, Problem Details, OpenAPI, and Health

**Files:**
- Create: `apps/api/src/config/env.ts`, `apps/api/src/config/config.module.ts`, `apps/api/src/config/env.spec.ts`
- Create: `apps/api/src/common/common.module.ts`, `apps/api/src/common/problem-details.ts`, `apps/api/src/common/problem-details.filter.ts`, `apps/api/src/common/request-id.middleware.ts`, `apps/api/src/common/json-depth.middleware.ts`, `apps/api/src/common/access-log.interceptor.ts`
- Create: `apps/api/src/health/health.service.ts`, `apps/api/src/health/health.controller.ts`, `apps/api/src/health/health.module.ts`
- Modify: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/package.json`, `package-lock.json`
- Test: `apps/api/src/config/env.spec.ts`, `apps/api/test/app.e2e-spec.ts`

**Interfaces:**
- Produces `loadEnv(source: NodeJS.ProcessEnv): Env`.
- Produces `CommonModule`, `ProblemDetailsFilter`, `RequestIdMiddleware`, `JsonDepthMiddleware`, and `HealthService.check(): Promise<void>`.
- Produces `GET /health`, conditional `GET /docs`, and conditional `GET /docs-json`.

- [ ] **Step 1: Write failing config and edge-contract tests**

Test that missing required keys throw a typed error naming keys only; production defaults `OPENAPI_ENABLED` to false; non-production defaults it to true; explicit booleans override the default. Add HTTP tests asserting matching request IDs, 404 Problem Details when OpenAPI is disabled, 200 OpenAPI JSON when enabled, and 503 `dependency_unavailable` when any health probe fails.

Run:

```bash
npm run test:unit -w @continuous-security-demo/api -- --runTestsByPath src/config/env.spec.ts
npm run test:e2e -w @continuous-security-demo/api -- --runTestsByPath test/app.e2e-spec.ts
```

Expected: FAIL because config, filter, and health types do not exist.

- [ ] **Step 2: Implement typed startup validation**

Define `Env` with all names from Spec §3.4. `loadEnv` must reject missing URL/key/audience/issuer/origin values, invalid port/rates/log level, and malformed booleans. Its error exposes only invalid key names. Wrap bootstrap so failure emits exactly one JSON line containing `code: "configuration_invalid"` and `invalidKeys`, then calls `process.exit(1)`; never include values and never retry in-process.

- [ ] **Step 3: Implement the API edge once in `main.ts`**

Install only the approved runtime packages:

```bash
npm install --save-exact -w @continuous-security-demo/api @nestjs/config@12.0.0 @nestjs/swagger@12.0.1 class-transformer@0.5.1 class-validator@0.15.1 helmet@8.3.0 pino-http@11.0.0 express-rate-limit@8.6.2
```

Then configure:

```ts
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(new JsonDepthMiddleware(20).use);
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
app.enableCors({ origin: [env.WEB_ORIGIN], credentials: false, methods: ['GET', 'POST', 'PATCH'], allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'] });
app.useGlobalFilters(app.get(ProblemDetailsFilter));
app.enableShutdownHooks();
```

Mount Swagger only when `env.OPENAPI_ENABLED` is true. Register all common providers through `CommonModule`. Configure two per-IP rate-limit policies using `express-rate-limit`: 60 requests per minute for authenticated routes and 20 requests per minute for anonymous routes and authentication failures. Wrap it as a Nest middleware; test both limits. Reject parsed JSON deeper than 20 object/array levels as `400/validation_failed`. Configure pino redaction for `req.headers.authorization`, key fields, bearer tokens, request bodies, and refund reasons.

- [ ] **Step 4: Implement stable Problem Details**

Implement this complete code/status map from Spec §10.1: `400/validation_failed`, `400/invalid_amount`, `400/currency_mismatch`, `401/unauthenticated`, `403/forbidden`, `404/not_found`, `409/idempotency_conflict`, `409/invalid_state`, `409/last_admin`, `409/over_refund`, `429/throttled`, `500/internal`, `503/dependency_unavailable`, and `503/audit_unavailable`. DTO/unknown-field/malformed-JSON/oversized-body failures use only `validation_failed`; `invalid_amount` and `currency_mismatch` are DB/RPC defense-in-depth mappings. Always emit exactly one code and use the request UUID for both response body and `X-Request-Id`; omit stacks and internal messages in production.

- [ ] **Step 5: Implement readiness probes**

`HealthService.check()` must independently reach the database through an anon-key Supabase `rpc('health_check')` probe (the table-independent function from Task 2; no service-role key and no row data), `${SUPABASE_URL}/auth/v1/health`, and `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. Give each probe a 2-second `AbortSignal.timeout(2000)`/statement timeout and combine them with `Promise.all`; do not retry inside the request. `HealthController` returns `{ status: 'ok' }` only when all three succeed; any timeout or failure throws one dependency-unavailable error for the global filter.

- [ ] **Step 6: Verify edge behavior**

```bash
npm run test:unit -w @continuous-security-demo/api
npm run test:e2e -w @continuous-security-demo/api
npm run build -w @continuous-security-demo/api
```

Expected: config/Problem Details/OpenAPI/health tests pass and the API builds without emitting secrets.

- [ ] **Step 7: Commit**

```bash
git add apps/api package.json package-lock.json
git commit -m "feat: add fail-closed API edge"
```

### Task 5: Verify JWTs and Preserve the Caller-Scoped Database Boundary

**Files:**
- Create: `apps/api/src/database/caller-client.ts`, `apps/api/src/database/database.module.ts`
- Create: `apps/api/src/auth/principal.ts`, `apps/api/src/auth/jwt-verifier.ts`, `apps/api/src/auth/auth.guard.ts`, `apps/api/src/auth/current-principal.decorator.ts`, `apps/api/src/auth/me.service.ts`, `apps/api/src/auth/me.controller.ts`, `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/audit/audit.types.ts`, `apps/api/src/audit/audit.service.ts`, `apps/api/src/audit/audit.module.ts`
- Create: `apps/api/test/helpers/problem-details.ts`, `apps/api/src/architecture.spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/test/app.e2e-spec.ts`, `apps/api/package.json`, `package-lock.json`

**Interfaces:**
- Produces `JwtVerifier.verify(accessToken: string): Promise<{ userId: string }>`.
- Produces request `principal: Principal` and `@CurrentPrincipal() principal: Principal`.
- Produces `CALLER_CLIENT: unique symbol` bound to `callerClient(accessToken: string): SupabaseClient`.
- Produces `AuditInput = { actorId: string | null; organizationId: string | null; action: string; targetType: string; targetId: string | null; result: 'success' | 'rejected' | 'failure'; correlationId: string; metadata: Record<string, string | number | boolean | null> }`.
- Produces `AuditService.record(event: AuditInput): Promise<void>` backed by an unexported service-role provider.
- Produces `GET /me` returning only the caller profile and active memberships.

- [ ] **Step 1: Write failing auth and architecture tests**

Cover missing, malformed, expired, bad-signature, wrong-issuer, wrong-audience, and future-`iat` tokens as `401/unauthenticated`. Assert `GET /me` returns only self. In `apps/api/src/architecture.spec.ts`, enumerate `DatabaseModule` exports and grep `apps/api/src`; fail unless the service-role literal appears only in `audit/audit.module.ts`. Because this file is under `src`, the existing `test:unit` command must execute it.

- [ ] **Step 2: Implement the two database credential boundaries**

Install the exact caller/auth dependencies:

```bash
npm install --save-exact -w @continuous-security-demo/api jose@6.2.10
```

```ts
export type CallerClient = (accessToken: string) => SupabaseClient;
export const CALLER_CLIENT = Symbol('CALLER_CLIENT');

export function createCallerClient(env: Env): CallerClient {
  return (accessToken) => createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
```

Export only `CALLER_CLIENT` from `DatabaseModule`; bind it to `createCallerClient(env)`. Do not add an admin-client provider. Separately, create `AuditModule` with one unexported symbol/provider that constructs `createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })`; inject it into `AuditService`, and export only `AuditService`. `AuditService.record(event: AuditInput): Promise<void>` inserts the allowlisted event fields and throws `audit_unavailable` on failure.

- [ ] **Step 3: Implement JWT verification**

Create one `createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`))`. Call `jwtVerify` with exact `issuer` and `audience`; reject non-string `sub`, future `iat`, and every verification error as unauthenticated. Do not read role or organization claims.

- [ ] **Step 4: Implement guard, principal decorator, and `/me`**

Parse exactly one `Bearer` token, verify it, and attach `{ userId, accessToken }` to the request. Audit every authentication failure through `AuditService.record` with `actorId: null`, `organizationId: null`, safe error code only, and the request correlation UUID; a required audit failure becomes `503/audit_unavailable`. `MeService` uses `callerClient(accessToken)` to select `profiles` by `user_id` and active `memberships` by `user_id`; it never queries another profile or accepts a user ID parameter.

- [ ] **Step 5: Verify original-token RLS behavior**

```bash
npm run test:e2e -w @continuous-security-demo/api -- --runTestsByPath test/app.e2e-spec.ts
npm run test:unit -w @continuous-security-demo/api -- --runTestsByPath src/architecture.spec.ts
```

Expected: all token failures return 401 Problem Details, `/me` is self-only, caller-token RLS is active, and the architecture test finds no exported or domain-accessible service-role client; the sole private construction remains in `audit/audit.module.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/database apps/api/src/audit apps/api/src/auth apps/api/src/architecture.spec.ts apps/api/test apps/api/src/app.module.ts package-lock.json
git commit -m "feat: preserve caller identity through RLS"
```

### Task 6: Add Organization Membership Reads and Last-Admin-Safe Updates

**Files:**
- Create: `apps/api/src/organizations/dto/patch-membership.dto.ts`
- Create: `apps/api/src/organizations/membership.service.ts`, `apps/api/src/organizations/organizations.controller.ts`, `apps/api/src/organizations/organizations.module.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/test/app.e2e-spec.ts`, `apps/api/test/schema.rls-spec.ts`

**Interfaces:**
- Produces `MembershipService.loadActiveMembership(principal: Principal, organizationId: string): Promise<Membership>`.
- Produces `MembershipService.updateMember(principal: Principal, organizationId: string, userId: string, patch: PatchMembershipDto): Promise<Membership>`.
- Produces `GET /organizations`, `GET /organizations/:organizationId/members`, and `PATCH /organizations/:organizationId/members/:userId`.

- [ ] **Step 1: Write the failing authorization matrix**

Add tests for active-member organization lists, same-org member lists, cross-tenant 404, user-role PATCH 403, admin update 200, final-admin self-demotion 409, final-admin self-suspension 409, two concurrent demotions when exactly two admins remain (at most one succeeds), and suspended caller 403. Assert `{}` is `400/validation_failed` and a synthetic `{ "atLeastOne": true }` field is rejected as unknown. Assert every error is valid Problem Details.

- [ ] **Step 2: Add the strict patch DTO**

```ts
export class PatchMembershipDto {
  @IsOptional() @IsIn(['user', 'manager', 'organization_admin']) role?: MembershipRole;
  @IsOptional() @IsIn(['active', 'suspended']) status?: MembershipStatus;
}
```

The global whitelist rejects actor, organization, authority, and synthetic sentinel fields. At the start of `updateMember`, explicitly reject `patch.role === undefined && patch.status === undefined` as `400/validation_failed`; do not add a decorated sentinel property that would become whitelisted client input.

- [ ] **Step 3: Implement the common decision order**

Authenticate, then use the caller client to select the caller's own membership for the URL organization. `memberships_select_self` makes that one row visible even when suspended: no row returns 404, a suspended own row returns 403, and an active row proceeds to the role check and target lookup. Missing/wrong-tenant targets return 404; active same-tenant callers lacking role return 403. Never use the service-role client for this distinction.

- [ ] **Step 4: Enforce last-admin in both application and database layers**

Before updating an active `organization_admin` to a non-admin role or suspended status, use the caller-scoped client to count active admins in that organization and reject a visible final-admin attempt as `409/last_admin`. This application check provides the first enforcement layer but is not trusted for concurrency. Issue the update through the caller-scoped client so the migration trigger locks and re-checks atomically; map its `last_admin` exception to the same `409/last_admin`. Record successful changes and forbidden/last-admin rejections through the real `AuditService` created in Task 5; if a required rejection audit fails, return `503/audit_unavailable`.

- [ ] **Step 5: Verify API and direct SQL paths**

```bash
npm run test:e2e -w @continuous-security-demo/api -- --runTestsByPath test/app.e2e-spec.ts
npm run test:rls -w @continuous-security-demo/api -- --runTestsByPath test/schema.rls-spec.ts
```

Expected: the application-level final-admin case, a concurrent two-admin demotion race, and direct SQL final-admin attempts all pass with the specified status/code values; every success/rejection has one correlated audit row.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/organizations apps/api/src/app.module.ts apps/api/test
git commit -m "feat: enforce organization membership rules"
```

### Task 7: Add Invoice Ownership, Allowlists, and State Transitions

**Files:**
- Create: `apps/api/src/invoices/dto/create-invoice.dto.ts`, `apps/api/src/invoices/dto/patch-invoice.dto.ts`
- Create: `apps/api/src/invoices/invoice-state.ts`, `apps/api/src/invoices/invoice-state.spec.ts`, `apps/api/src/invoices/invoice.service.spec.ts`
- Create: `apps/api/src/invoices/invoice.service.ts`, `apps/api/src/invoices/invoices.controller.ts`, `apps/api/src/invoices/invoices.module.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/test/app.e2e-spec.ts`, `apps/api/test/schema.rls-spec.ts`

**Interfaces:**
- Produces `canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean`.
- Produces `InvoiceService.list(principal: Principal, organizationId: string): Promise<Invoice[]>`.
- Produces `InvoiceService.create(principal: Principal, organizationId: string, dto: CreateInvoiceDto, requestId: string): Promise<Invoice>`.
- Produces `InvoiceService.get(principal: Principal, organizationId: string, invoiceId: string): Promise<Invoice>`.
- Produces `InvoiceService.updateStatus(principal: Principal, organizationId: string, invoiceId: string, dto: PatchInvoiceDto, requestId: string): Promise<Invoice>`.
- Produces direct resource responses on `GET /organizations/:organizationId/invoices`, `POST /organizations/:organizationId/invoices`, `GET /organizations/:organizationId/invoices/:invoiceId`, and `PATCH /organizations/:organizationId/invoices/:invoiceId`; only POST returns `201`, while list/get/update return `200`.

- [ ] **Step 1: Write failing state-machine and HTTP tests**

```ts
expect(canTransitionInvoice('draft', 'issued')).toBe(true);
expect(canTransitionInvoice('issued', 'paid')).toBe(true);
expect(canTransitionInvoice('draft', 'cancelled')).toBe(true);
expect(canTransitionInvoice('issued', 'cancelled')).toBe(true);
expect(canTransitionInvoice('paid', 'cancelled')).toBe(false);
expect(canTransitionInvoice('issued', 'draft')).toBe(false);
```

Add pure unit cases for currency acceptance (`USD`) and rejection (`usd`, `US`, `USDD`), plus amount acceptance at `1`, `9007199254740990`, and `9007199254740991`, and rejection at `0`, non-integers, and `9007199254740992`. Add HTTP cases for User A own invoice 200, User A same-tenant User B invoice 404, manager same-org invoice 200, cross-tenant 404, user create 403, manager create 201, and authority-field mass assignment 400. In `invoice.service.spec.ts`, mock `MembershipService` and `CALLER_CLIENT`; assert an inactive/insufficient membership rejects before the invoice query/insert mock is called, proving the Nest layer does not delegate its decision to RLS.

- [ ] **Step 2: Implement exact DTO allowlists**

Use `@Length(1, 128)`, `@Length(1, 1024)`, `@IsInt()`, `@Min(1)`, `@Max(9007199254740991)`, and `@Matches(/^[A-Z]{3}$/)` for creation. `PatchInvoiceDto` contains only `status` with `issued|paid|cancelled`.

- [ ] **Step 3: Implement minimal transition logic and service methods**

```ts
const ALLOWED: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  draft: ['issued', 'cancelled'],
  issued: ['paid', 'cancelled'],
  paid: [],
  cancelled: []
};
export const canTransitionInvoice = (from: InvoiceStatus, to: InvoiceStatus) => ALLOWED[from].includes(to);
```

Inject `MembershipService` and call `loadActiveMembership(principal, organizationId)` before every invoice operation. List/get require any active role; create/update require `manager|organization_admin` and return 403 before calling the invoice client for an insufficient role. Use URL `organizationId`; omit `owner_id` and `status` from inserts so PostgreSQL derives them. Fetch detail/update by both invoice ID and URL organization; map zero visible rows to 404, then independently enforce that an active `user` owns the returned row and a manager/admin belongs to its organization. RLS still restricts the same caller query as the second layer.

- [ ] **Step 4: Write mandatory invoice audits through the Task 5 interface**

Call the real `AuditService.record` from Task 5 after successful create/transition and on high-risk forbidden/state rejection. Mock that same concrete provider only inside focused unit tests; do not create another audit abstraction.

- [ ] **Step 5: Verify both enforcement layers**

```bash
npm run test:unit -w @continuous-security-demo/api -- --runTestsByPath src/invoices/invoice-state.spec.ts src/invoices/invoice.service.spec.ts
npm run test:e2e -w @continuous-security-demo/api -- --runTestsByPath test/app.e2e-spec.ts
npm run test:rls -w @continuous-security-demo/api -- --runTestsByPath test/schema.rls-spec.ts
```

Expected: state unit tests pass; API and direct caller-token ownership/grant/trigger tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/invoices apps/api/src/app.module.ts apps/api/test
git commit -m "feat: enforce invoice ownership and state"
```

### Task 8: Complete Mandatory Audit Persistence and Domain Wiring

**Files:**
- Modify: `apps/api/src/audit/audit.types.ts`, `apps/api/src/audit/audit.service.ts`, `apps/api/src/audit/audit.module.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/auth/auth.guard.ts`, `apps/api/src/common/problem-details.filter.ts`, `apps/api/src/organizations/membership.service.ts`, `apps/api/src/invoices/invoice.service.ts`
- Test: `apps/api/src/architecture.spec.ts`, `apps/api/test/app.e2e-spec.ts`

**Interfaces:**
- Consumes the exact `AuditService.record(event: AuditInput): Promise<void>` contract from Task 5.
- Completes membership, invoice, authentication, and DTO rejection wiring.
- Preserves the boundary that exports `AuditService` but never the service-role client or provider token.

- [ ] **Step 1: Write failing containment and fail-closed tests**

Assert the literal `SUPABASE_SERVICE_ROLE_KEY` and service-role `createClient` call occur only in `audit.module.ts`; `DatabaseModule` exports only the caller factory; domain modules import no elevated token. Add an HTTP test where required rejection-audit insertion fails and assert `503/audit_unavailable` plus one redacted fallback log.

- [ ] **Step 2: Prove and preserve the private service-role provider**

Use the provider created in Task 5; do not construct another elevated client. The architecture test must prove the provider symbol is not exported, `AuditModule` exports only `AuditService`, the literal `SUPABASE_SERVICE_ROLE_KEY` occurs in no other runtime source, and no domain module imports the private token. Keep this construction unchanged:

```ts
createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
```

- [ ] **Step 3: Implement safe event persistence**

Insert only the `AuditInput` fields into `audit_events`. Callers must pass a request UUID as `correlationId`. Refund metadata records `reasonLength` and a short SHA-256 prefix, never raw reason. Reject tokens, headers, full bodies, keys, and secrets by type and callsite.

- [ ] **Step 4: Wire mandatory success and rejection events**

Record membership and invoice successes after their writes. Record forbidden/last-admin/state business rejections in their owning services before returning. Inject `AuditService` into `AuthGuard` so every missing/malformed/expired/bad-signature/wrong-issuer/wrong-audience/future-`iat` rejection records `result: 'failure'` with `actorId: null`. Have `ProblemDetailsFilter` audit DTO validation failures on high-risk routes using only request ID, route template, safe identifiers, and validation code; it must not re-audit domain errors already recorded by their service. Never pass the bearer token, headers, or body. If a required rejection audit fails, replace the original response with `503/audit_unavailable` and emit only `{ requestId, code: 'audit_unavailable', message: 'required audit persistence failed' }`.

- [ ] **Step 5: Verify isolation and behavior**

```bash
npm run test:unit -w @continuous-security-demo/api -- --runTestsByPath src/architecture.spec.ts
npm run test:e2e -w @continuous-security-demo/api -- --runTestsByPath test/app.e2e-spec.ts
```

Expected: containment, safe metadata, success/rejection audit, and fail-closed tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/audit apps/api/src/organizations apps/api/src/invoices apps/api/src/app.module.ts apps/api/test
git commit -m "feat: isolate mandatory audit writes"
```

### Task 9: Add the Atomic Refund Function and Refund API

**Files:**
- Create: `supabase/migrations/202608290003_create_refund.sql`
- Create: `apps/api/src/refunds/dto/create-refund.dto.ts`, `apps/api/src/refunds/refund.service.ts`, `apps/api/src/refunds/refund.service.spec.ts`, `apps/api/src/refunds/refunds.controller.ts`, `apps/api/src/refunds/refunds.module.ts`
- Create: `apps/api/test/refunds.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/test/schema.rls-spec.ts`

**Interfaces:**
- Produces SQL `public.create_refund(uuid, bigint, char, text, text, uuid)` returning one persisted refund.
- Produces `RefundService.create(principal: Principal, organizationId: string, invoiceId: string, dto: CreateRefundDto, requestId: string): Promise<Refund>`.
- Produces `POST /organizations/:organizationId/invoices/:invoiceId/refunds`.

- [ ] **Step 1: Write the complete failing refund matrix**

Cover manager issued/paid success, user 403, cross-tenant 404, amount acceptance at `1`, `9007199254740990`, and `9007199254740991`, amount rejection at `0`, fractions, and `9007199254740992`, currency acceptance for `USD`, currency rejection for `usd`, `US`, and `USDD`, draft/cancelled 409, over-cap 409, same-key/same-payload replay, same-key/different-payload conflict, two concurrent requests whose sum exceeds the cap, success audit uniqueness, rejected audit correlation, and audit-unavailable fail-closed behavior.

- [ ] **Step 2: Create the exact hardened definer role and privilege inventory**

Copy Spec §6.2 steps 1–5 and §6.3 into `202608290003_create_refund.sql`. Preserve `NOLOGIN NOINHERIT NOBYPASSRLS`, non-membership in `service_role`, these exact grants, and no broader grants:

```sql
grant select on public.invoices to public_refund_definer;
grant update (id) on public.invoices to public_refund_definer;
grant select on public.memberships to public_refund_definer;
grant select, insert on public.refunds to public_refund_definer;
grant insert on public.audit_events to public_refund_definer;
grant usage on schema auth to public_refund_definer;
grant execute on function auth.uid() to public_refund_definer;
```

Create exactly the six named forced-RLS policies `refund_definer_select_invoices`, `refund_definer_update_invoices_lock`, `refund_definer_select_memberships`, `refund_definer_select_refunds`, `refund_definer_insert_refunds`, and `refund_definer_insert_audit_success`. The audit policy admits only `action = 'refund.created' and result = 'success'`.

- [ ] **Step 3: Implement the transaction in the approved order**

The function order must match Spec §6.3 exactly: derive `v_actor := auth.uid()` and reject null; lock the visible invoice with `SELECT ... FOR UPDATE`; hide missing/foreign invoices as `not_found`; derive tenant from that row; verify active manager/admin membership; only then find `(invoice_id,idempotency_key)` under the invoice lock, returning the existing row when normalized amount/currency/reason match or raising `idempotency_conflict` when they differ. For a new key, validate `issued|paid` state, amount, and currency; sum prior refunds; compare without overflow using `p_amount_minor > v_invoice.amount_minor - v_sum`; insert the refund and one `refund.created/success` audit with `correlation_id = p_request_id`; return the row. Add a test proving a caller cannot retrieve a foreign refund even with its idempotency key, plus concurrent same-key tests proving exactly one row and one success audit.

End with:

```sql
revoke all on function public.create_refund(uuid, bigint, char, text, text, uuid) from public;
grant execute on function public.create_refund(uuid, bigint, char, text, text, uuid) to authenticated;
```

- [ ] **Step 4: Implement DTO, RPC call, and rejection mapping**

The DTO uses the exact invoice amount maximum, currency regex, reason length `1..512`, and idempotency-key length `1..128`. Inject `MembershipService`; before invoking the RPC, call `loadActiveMembership(principal, organizationId)` and require `manager|organization_admin`, returning 404 for no URL-organization membership and 403 for suspended/insufficient role. Add `refund.service.spec.ts` with mocked membership and caller client and assert denied application-layer cases never invoke `.rpc()`. Then call RPC through `callerClient(principal.accessToken)`, pass `requestId`, and let the function independently re-derive tenant/role from the locked invoice as the RLS/DB layer. Map exact SQL messages to the Spec §10.1 status/code pairs. After rollback, call `AuditService.record` for every refund rejection before returning; map audit failure to `503/audit_unavailable`.

- [ ] **Step 5: Prove privilege inventory, atomicity, and concurrency**

Extend the direct SQL suite to assert the role attributes, grants, six policy names, function owner/search path, execute grant, direct insert denial, same-org user `forbidden`, and foreign invoice `not_found`. Run both the application-layer unit proof and real DB suites:

```bash
npm run test:unit -w @continuous-security-demo/api -- --runTestsByPath src/refunds/refund.service.spec.ts
npm run supabase:reset
npm run test:rls -w @continuous-security-demo/api
npm run test:e2e -w @continuous-security-demo/api -- --runTestsByPath test/refunds.e2e-spec.ts
```

Expected: one concurrent refund succeeds, one returns `over_refund`, total refunds never exceed invoice amount, and every success/rejection has exactly the required audit behavior.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202608290003_create_refund.sql apps/api/src/refunds apps/api/src/app.module.ts apps/api/test
git commit -m "feat: make refunds atomic and idempotent"
```

### Task 10: Build the Authenticated Role-Aware Web UI

**Files:**
- Create: all `apps/web` files listed in the Planned File Map
- Modify: `apps/web/package.json`
- Test: TypeScript typecheck and Next production build

**Interfaces:**
- Produces server-only `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` using the current Supabase session token.
- Produces `ActionState = { error?: ProblemDetails; success?: boolean }` plus `createInvoiceAction`, `updateInvoiceStatusAction`, `createRefundAction`, and `updateMemberAction`, each with signature `(previous: ActionState, formData: FormData) => Promise<ActionState>`.
- Consumes `GET /me`, organization/member/invoice endpoints, and refund POST exactly as documented.
- Produces no domain call to Supabase and no registration/recovery route.

- [ ] **Step 1: Add a failing type/build boundary**

Create `apps/web/src/lib/types.ts` with the shared public response types and page imports that reference missing `apiFetch`, Supabase server/client helpers, and forms. Run:

```bash
npm run typecheck -w @continuous-security-demo/web
```

Expected: FAIL with unresolved local modules.

- [ ] **Step 2: Implement Supabase auth helpers only**

Install the exact browser/server auth dependencies:

```bash
npm install --save-exact -w @continuous-security-demo/web @supabase/ssr@0.12.5 @supabase/supabase-js@2.112.4
```

Use `@supabase/ssr` to create cookie-aware browser/server clients. Implement the server helper exactly around the async Next.js 16 cookie API:

```ts
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try { values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* Server Components cannot write; proxy.ts performs refresh writes. */ }
      }
    }
  });
}
```

`client.ts` returns `createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)`. `proxy.ts` exports `proxy(request: NextRequest): Promise<NextResponse>`, creates a request/response cookie adapter with `getAll`/`setAll`, calls `supabase.auth.getUser()` to refresh and validate auth, copies refreshed cookies to the response, and redirects unauthenticated `/dashboard` and `/organizations/**` requests to `/login`. The login server action allowlists `email` and `password`, calls `signInWithPassword({ email, password })`, redirects to `/dashboard` on success, and returns a focusable generic error on failure. Expose no sign-up or password-reset action.

- [ ] **Step 3: Implement the single Nest API client and named server actions**

Implement the only domain client as:

```ts
import 'server-only';

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect('/login');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${process.env.API_URL!}${path}`, { ...init, headers, cache: 'no-store' });
  if (!response.ok) throw await response.json() as ProblemDetails;
  return await response.json() as T;
}
```

Implement four route-local server actions with the declared `(previous, formData)` signature and this exact allowlist/endpoint matrix:

| Action | Parsed fields | Method/path | Revalidate |
|---|---|---|---|
| `createInvoiceAction` | `organizationId`, `customerId`, `description`, numeric `amountMinor`, `currency` | POST `/organizations/${organizationId}/invoices` | organization invoices page |
| `updateInvoiceStatusAction` | `organizationId`, `invoiceId`, `status` | PATCH `/organizations/${organizationId}/invoices/${invoiceId}` | invoice detail |
| `createRefundAction` | `organizationId`, `invoiceId`, numeric `amountMinor`, `currency`, `reason`, `idempotencyKey` | POST `/organizations/${organizationId}/invoices/${invoiceId}/refunds` | invoice detail |
| `updateMemberAction` | `organizationId`, `userId`, present `role` and/or `status` only | PATCH `/organizations/${organizationId}/members/${userId}` | members page |

Each action builds a fresh JSON object from only those fields, calls `apiFetch`, returns `{ success: true }` and `revalidatePath(...)` on success, or returns `{ error }` only when the caught value satisfies the `ProblemDetails` shape; unexpected errors are rethrown for the Next error boundary. Do not call `.from()` or `.rpc()` anywhere under `apps/web/src`.

- [ ] **Step 4: Implement accessible route pages and role UI**

Implement these exact server-rendered route responsibilities:

| Route | Fetches | Visible controls |
|---|---|---|
| `/dashboard` | `GET /me` | links for each active membership |
| `/organizations/[organizationId]/invoices` | invoice list | create form only for manager/admin |
| `/organizations/[organizationId]/invoices/[invoiceId]` | invoice detail | transition/refund forms only for manager/admin |
| `/organizations/[organizationId]/members` | member list | role/status form only for organization admin |

Bind forms to the named server actions. Use explicit `<label htmlFor>`, native `email/password/text/number/select/textarea` controls, `aria-describedby` for help/error text, and a client submit button driven by `useFormStatus()` with `disabled={pending}`. Render action failures as `<div role="alert" tabIndex={-1}>` containing `ProblemDetails.title`, optional `detail`, and `requestId`; focus the summary after failure. Client-side role checks affect presentation only; every page/action still sends the request to the authoritative API.

- [ ] **Step 5: Verify the frontend boundary and production build**

```bash
! grep -R "\.from(\|\.rpc(" apps/web/src
! grep -R "SUPABASE_SERVICE_ROLE_KEY" apps/web
npm run typecheck -w @continuous-security-demo/web
npm run build -w @continuous-security-demo/web
```

Expected: both grep assertions and both build commands pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web package.json package-lock.json
git commit -m "feat: add role-aware application UI"
```

### Task 11: Complete the Acceptance Matrix and Delivery Playbook

**Files:**
- Modify: `apps/api/test/app.e2e-spec.ts`, `apps/api/test/refunds.e2e-spec.ts`, `apps/api/test/schema.rls-spec.ts`, `apps/api/src/architecture.spec.ts`
- Create: `docs/superpowers/specs/2026-03-09-continuous-security-demo-delivery.md`
- Modify: `README.md`, `package.json`

**Interfaces:**
- Produces a root `npm test` that runs domain unit, real-Supabase RLS, and Nest HTTP e2e layers.
- Produces a delivery guide sufficient for a fresh local checkout.
- Produces no Project 2–6 artifact.

- [ ] **Step 1: Verify the acceptance-test inventory already owned by Tasks 2–10**

Run the named test files rather than adding deferred cases here: `src/config/env.spec.ts`, `src/architecture.spec.ts`, `src/invoices/invoice-state.spec.ts`, `src/invoices/invoice.service.spec.ts`, `src/refunds/refund.service.spec.ts`, `test/schema.rls-spec.ts`, `test/app.e2e-spec.ts`, and `test/refunds.e2e-spec.ts`. Their earlier tasks must already cover anonymous/auth token failures, safe-integer and currency boundaries, owner/other-owner/manager/cross-tenant visibility, suspension, privileged-field rejection, application/concurrent/direct-SQL last-admin cases, direct refund/audit denial, illegal transitions, foreign-known-idempotency-key denial, refund cap/state/idempotency/concurrency, audit completeness, health 503, OpenAPI gate, and service-role containment. If any named case is absent, return to its owning task before this final task.

- [ ] **Step 2: Run the complete suite without production changes**

```bash
npm run supabase:reset
npm test
```

Expected: PASS. Task 11 is verification/documentation only; it must not introduce a production-code fix or weaken an assertion.

- [ ] **Step 3: Write the delivery guide with exact local operations**

Document prerequisites; exact `node --version`, `npm --version`, and `npx supabase@2.116.0 --version` checks; `npm install`; `npm run supabase:start`; copying `.env.example` to workspace-local environment files and filling keys from `npx supabase@2.116.0 status -o env`; `npm run supabase:reset`; API/web start commands; all six seeded emails/passwords from Task 3; role-by-role browser walkthrough; `/health`; `/docs-json`; root/unit/RLS/e2e tests; both production builds; stop command; and troubleshooting for ports, reset, invalid config, 503 health, and request IDs.

- [ ] **Step 4: Perform a fresh-state verification**

From the repository root:

```bash
test "$(node --version)" = "v26.8.1"
test "$(npm --version)" = "12.0.2"
test "$(npx --yes supabase@2.116.0 --version)" = "2.116.0"
rm -rf node_modules apps/api/node_modules apps/web/node_modules apps/api/dist apps/web/.next
npm ci
npx supabase@2.116.0 stop --no-backup || true
npm run supabase:start
eval "$(npx supabase@2.116.0 status -o env)"
export SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export SUPABASE_JWT_AUDIENCE=authenticated SUPABASE_JWT_ISSUER="$API_URL/auth/v1"
export API_PORT=3001 WEB_ORIGIN=http://localhost:3000 OPENAPI_ENABLED=true
export RATE_LIMIT_AUTHENTICATED=60 RATE_LIMIT_ANONYMOUS=20 LOG_LEVEL=info
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export API_URL=http://127.0.0.1:3001
npm run supabase:reset
npm test
npm run typecheck --workspaces --if-present
npm run build -w @continuous-security-demo/api
npm run build -w @continuous-security-demo/web
npm run start -w @continuous-security-demo/api > /tmp/continuous-security-demo-api.log 2>&1 &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT
for attempt in $(seq 1 30); do curl --silent --fail http://127.0.0.1:3001/health && break; sleep 1; done
curl --fail http://127.0.0.1:3001/health
curl --fail http://127.0.0.1:3001/docs-json
```

Expected: clean install; deterministic reset; all three test layers pass; both workspaces typecheck/build; the built API reaches readiness within 30 seconds; health is `200 {"status":"ok"}`; OpenAPI JSON is returned in local mode; the trap stops the API.

- [ ] **Step 5: Prove the scope boundary**

```bash
test ! -d .github
test ! -d fixtures
! find . -type f \( -iname '*zap*' -o -iname '*sarif*' -o -iname '*playwright*' \) -print -quit | grep .
```

Expected: PASS; no Project 2–6 artifact exists.

- [ ] **Step 6: Commit**

```bash
git add README.md package.json docs/superpowers/specs/2026-03-09-continuous-security-demo-delivery.md
git commit -m "docs: verify and deliver Project 1"
```

## Traceability

| Approved design requirement | Implemented and proven in |
|---|---|
| Project 1 scope/non-goals; plain npm workspaces | Tasks 1, 11 |
| Repository/runtime/module topology | Tasks 1, 4–10 |
| Typed configuration and redacted startup failure | Task 4 |
| Browser/API/Supabase trust boundaries | Tasks 5, 8, 10 |
| JWT signature, issuer, audience, expiry, future issue time | Task 5 |
| Caller token preserved; no impersonation or exported elevated client | Tasks 5, 8 |
| Profiles, organizations, memberships, invoices, refunds, audits | Tasks 2, 3 |
| Forced RLS, column grants, ownership, tenant hiding | Tasks 2, 5–7, 9 |
| Self-only suspended membership visibility and approved 403/404 split | Tasks 2, 6 |
| Independent Nest membership/role checks before caller-RLS operations | Tasks 6, 7, 9 |
| Last-admin concurrency protection | Tasks 2, 6, 11 |
| Invoice allowlists, amount/currency bounds, state machine | Tasks 2, 7 |
| Hardened six-policy refund definer and `auth.uid()` grants | Task 9 |
| Authorization and invoice lock before idempotency; idempotency before mutable-state checks; overflow-safe cap | Task 9 |
| Atomic success audit and mandatory rejected audit | Tasks 8, 9 |
| Full REST surface and role matrix | Tasks 5–7, 9, 11 |
| RFC 9457 Problem Details and request IDs | Tasks 4, 11 |
| Exact CORS, body limit, throttling, Helmet, redacted JSON logs | Task 4 |
| Table-independent anon DB readiness, Auth/JWKS readiness, and 503 semantics | Tasks 2, 4, 11 |
| Role-aware web with Supabase auth only | Task 10 |
| Domain, real-RLS, HTTP e2e, concurrency, architecture tests | Tasks 2–9, 11 |
| Deterministic seeded roles and two organizations | Task 3 |
| OpenAPI local gate and production default | Tasks 4, 11 |
| Delivery guide and clean install/build acceptance | Task 11 |
