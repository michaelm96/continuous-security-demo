# Continuous Application-Security Verification Demonstration — Project 1 Design

Status: Approved — 2026-08-29
Revision: 2026-08-29 — corrected the minor-unit ceiling to JavaScript's exact integer limit (`9007199254740991`); added a table-independent anonymous database-readiness RPC and narrowly scoped self-membership visibility so suspended callers can receive the approved 403 without broader tenant access.
Date: 2026-03-09
Owners: Platform security demonstration
Scope: Plain npm-workspaces monorepo containing `apps/web`, `apps/api`, `supabase/`, and documentation. CI, scanners, fixtures, and GitHub Actions are deferred to Projects 2–6.

---

## 1. Objective and Scope

### 1.1 Objective

Project 1 establishes a secure-by-default, multi-tenant invoice and refund application that serves as the durable substrate for a six-project continuous application-security verification program. The application itself must demonstrate, by construction, the trust and authorization decisions that later projects will exercise with scanners, fuzzers, and policy tools. Every authorization decision is enforced in two independent layers — NestJS application checks and PostgreSQL row-level security (RLS) — so that a single failure at either layer still preserves the intended tenant and role boundary.

### 1.2 In Scope (Project 1)

- Plain `npm` workspaces monorepo (`package.json` with `workspaces`, no Nx, no Turborepo).
- `apps/web`: Next.js (App Router) + Tailwind CSS, type-checked and buildable, role-aware UI for the supported roles.
- `apps/api`: NestJS application exposing the documented REST surface, OpenAPI 3.x emitted from the start, configured for fail-closed defaults.
- `supabase/`: SQL migrations and a deterministic, idempotent local seed mechanism. Local development runs against the Supabase CLI (`supabase start`) with the local Postgres + GoTrue + PostgREST + Studio stack.
- Supabase Auth (GoTrue) as the identity provider; Supabase-hosted PostgreSQL as the system of record.
- NestJS verification of the Supabase-issued JWT: signature against Supabase JWKS plus `iss`, `aud`, and `exp`.
- Domain tables, RLS policies, constraints, and a single transactional refund function that locks the invoice row.
- API modules: auth, organizations, invoices, refunds, audit, health.
- Test harness: domain unit tests, real-local-Supabase RLS integration tests, Nest HTTP e2e tests, frontend typecheck and production build.
- A delivery document (`docs/superpowers/specs/2026-03-09-continuous-security-demo-delivery.md`) describing how to install, start, migrate, seed, run, and exercise the system locally. Project 1 ships the delivery document alongside code.

### 1.3 Out of Scope (Project 1)

- No Nx, Turborepo, Lerna, or other monorepo orchestrators.
- No ORM (no Prisma, TypeORM, MikroORM, Drizzle, Knex, Sequelize, Mongoose). Database access is performed via the Supabase JS client and via parameterized SQL through `pg` / `postgres-js` where server-side logic is required.
- No microservices. The API is a single NestJS process; no message broker (no Kafka, RabbitMQ, NATS, Redis pub/sub, BullMQ).
- No custom policy engine (no OPA, Cerbos, Casbin, OpenFGA in-process). Authorization is NestJS guards plus PostgreSQL RLS.
- No payments, no email, no SMS, no push notifications.
- No public registration or password-recovery flows. Identities are provisioned only by the local seed mechanism and (in later projects) by controlled administrative paths.
- No analytics, telemetry, feature flags, or product instrumentation.
- No known-vulnerable dependency fixtures, no vulnerability scanners, no dependency-audit automation, no fuzzing harness, no DAST, no GitHub Actions. These belong to Projects 2–6.
- No Docker images for production deployment. Local development uses the Supabase CLI only.

---

## 2. Non-Goals

The following are explicitly not goals of Project 1, and design choices that would pull the project toward them are rejected:

1. **Defending against a compromised Supabase.** Supabase is treated as a trusted infrastructure dependency. Project 1 does not introduce out-of-band verification of Supabase-internal state.
2. **Defending against a compromised developer workstation.** Secrets used during local seed and local Supabase startup are local-only and out of scope.
3. **Hardening the browser.** The browser is untrusted (Section 4); the design assumes a fully hostile client. Defending the browser process itself is not a goal.
4. **General-purpose authorization as a service.** There is no reusable policy framework. Authorization is encoded in NestJS guards, controller logic, and PostgreSQL RLS policies specific to this application's schema.
5. **High availability, multi-region, or disaster recovery.** A single local Supabase stack and a single API process are sufficient.
6. **Compliance certification.** The design aims to be defensible, not certified. PCI, SOC 2, HIPAA, ISO 27001, and similar regimes are out of scope.
7. **Performance engineering beyond correctness defaults.** Request limits and throttling are present to bound abuse, not to meet a latency SLO.
8. **Internationalization, accessibility audits beyond reasonable defaults, or design system abstraction.** Tailwind utilities are sufficient.

---

## 3. Architecture

### 3.1 Repository Layout

```
/
├── package.json                     # npm workspaces root
├── package-lock.json
├── tsconfig.base.json
├── .gitignore
├── .env.example                     # documented, non-secret defaults
├── README.md
├── docs/
│   └── superpowers/
│       └── specs/
│           ├── 2026-03-09-continuous-security-demo-design.md   # this document
│           └── 2026-03-09-continuous-security-demo-delivery.md # run/install/playbook
├── apps/
│   ├── web/                         # Next.js App Router + Tailwind
│   └── api/                         # NestJS
└── supabase/
    ├── config.toml                  # local Supabase CLI config
    ├── migrations/                  # timestamped SQL migrations
    └── seed.sql                     # deterministic local seed (idempotent)
```

Project 1 introduces `docs/superpowers/specs/2026-03-09-continuous-security-demo-delivery.md` describing install, start, migrate, seed, run, identities, role UI, OpenAPI generation, tests, and production build steps.

### 3.2 Runtime Topology

Three runnable units in development:

1. **Supabase local stack** (`supabase start`) — Postgres 15, GoTrue, PostgREST, Storage, Studio. Started by the Supabase CLI; not part of the npm workspace builds.
2. **NestJS API** (`apps/api`) — single Node.js process on port 3001. Verifies Supabase JWTs, enforces guards, executes SQL through caller-scoped clients and through the narrowly scoped service-role client constructed inside `AuditModule` (and the separate local seed entry point, which is not part of the running API process).
3. **Next.js web** (`apps/web`) — single Node.js process on port 3000. Server Components fetch only via the API; client components receive only the Supabase anon key and a short-lived access token.

In production (Project 4 territory, documented but not built here) the topology is identical in shape: a managed Supabase project, the NestJS process behind a TLS-terminating proxy, and the Next.js process behind the same proxy. The local and production topologies share the same `apps/api` and `apps/web` code.

### 3.3 Process and Module Boundaries

- `apps/api` is a NestJS application with one module per domain area:
  - `AuthModule` — JWT verification guard, principal extraction, `/me`.
  - `OrganizationsModule` — listing, membership listing, membership role updates.
  - `InvoicesModule` — invoice listing, creation, retrieval, status transitions.
  - `RefundsModule` — refund creation, idempotency, transactional enforcement.
  - `AuditModule` — audit event emission; the only module that writes to `audit_events`.
  - `HealthModule` — `/health` endpoint.
  - `DatabaseModule` — Supabase caller-scoped client factory only; exports `callerClient(accessToken)` and nothing else. Does not export any elevated/admin client and is the only client factory reachable through dependency injection from domain modules.
  - `ConfigModule` — typed environment configuration with fail-closed defaults.
  - `CommonModule` — Problem Details exception filter, request ID middleware, throttling, CORS, body parsing limits.
- `apps/web` is a Next.js App Router application with route groups:
  - `(public)/login` — Supabase Auth UI integration for development seeding identities.
  - `(app)/dashboard` — authenticated landing.
  - `(app)/invoices` — list and detail.
  - `(app)/refunds` — refund creation form.
  - `(app)/admin/members` — organization admin role management (gated by API).
- `supabase/migrations/` contains ordered, timestamp-prefixed SQL files. Migration 0001 establishes extensions (`pgcrypto`, `citext`), the `auth` schema references, and the domain tables. Subsequent migrations add policies, constraints, and the refund function.

### 3.4 Configuration

Environment variables (documented in `.env.example`; secrets are never committed):

| Variable | Owner | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `apps/web` | Supabase project URL used by the browser. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `apps/web` | Supabase anon key (browser-safe, RLS-respecting). |
| `SUPABASE_URL` | `apps/api` | Same Supabase URL, used server-side for JWKS verification and as the base URL for the narrowly scoped service-role Supabase client constructed inside the audit-writer provider in `AuditModule` (and for the separate local seed entry point). |
| `SUPABASE_ANON_KEY` | `apps/api` | Server-side anon (publishable) key used to instantiate caller-scoped Supabase clients so that Postgres runs as `authenticated` with `auth.uid()` derived from the verified JWT and RLS is enforced. Token signature/claims verification is performed separately against the Supabase JWKS by `JwtVerifier` and does not depend on this key. |
| `SUPABASE_SERVICE_ROLE_KEY` | `apps/api` | Elevated key. Held only in the API process; never sent to the browser; used only by the narrowly scoped application-tier audit-writer provider inside `AuditModule` (which constructs its own service-role Supabase client internally and does not expose it) and by the separate local seed entry point (which constructs its own service-role client and is not importable by runtime domain modules). No other module reads `SUPABASE_SERVICE_ROLE_KEY` and `DatabaseModule` exports no provider that exposes it. |
| `SUPABASE_JWT_AUDIENCE` | `apps/api` | Expected `aud` claim. |
| `SUPABASE_JWT_ISSUER` | `apps/api` | Expected `iss` claim (the Supabase project URL). |
| `API_PORT` | `apps/api` | Default 3001. |
| `WEB_ORIGIN` | `apps/api` | Exact origin allowed by CORS. |
| `RATE_LIMIT_*` | `apps/api` | Throttling tunables. |
| `LOG_LEVEL` | `apps/api` | Default `info`. |
| `NODE_ENV` | `apps/api` | Standard Node environment selector. Used to select the `OPENAPI_ENABLED` default (enabled for local development/test, disabled in production; staging sets it explicitly to `true`). |
| `OPENAPI_ENABLED` | `apps/api` | Boolean. Gates mounting of the OpenAPI runtime endpoints (`/docs` and `/docs-json`). Default is `true` when `NODE_ENV` is not `production` (local development and tests), and `false` when `NODE_ENV` is `production`. Staging sets it explicitly to `true` because Projects 2 and 3 consume `/docs-json` for endpoint inventory and fuzz seeding. The endpoints are mounted only when `OPENAPI_ENABLED` is `true`; otherwise they return 404 Problem Details (`code: not_found`). No separate docs service is introduced. |

The API fails closed on startup if any required variable is missing or if `SUPABASE_JWT_AUDIENCE` does not match the configured audience. The startup-failure contract is precise: any missing or invalid required configuration prevents the Nest application from booting. `ConfigModule` validates the typed environment configuration before `NestFactory.create()` returns; on any failure the process emits exactly one redacted structured error log with `code: configuration_invalid` that names the invalid configuration keys but never their values (no env-var content, no parsed-value content, no `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY` substrings), then exits with a nonzero exit code (`process.exit(1)`). Startup configuration failures are not expressed as a `/health` response and are not retried in-process. Runtime dependency loss (e.g., Supabase database/Auth/JWKS unreachable after a successful boot) remains the signal that surfaces as a `/health` 503 Problem Details (`code: dependency_unavailable`, numeric `status: 503`).

---

## 4. Trust Boundaries

### 4.1 Trust Zones

| Zone | Trust | Description |
|---|---|---|
| Browser | **Untrusted** | Any value submitted by the browser is treated as adversarial input. |
| Next.js server | **Semi-trusted** | Runs server-side rendering and route handlers; receives the user's bearer token from the browser. |
| NestJS API | **Trusted application tier** | Verifies identity, enforces authorization, emits audit events. |
| Supabase (Postgres, GoTrue, PostgREST) | **Trusted infrastructure** | Identity issuance, persistent storage, RLS enforcement. |
| Developer workstation (local Supabase stack) | **Trusted in development only** | Hosts the elevated service-role key and seed credentials. |

### 4.2 Boundary Rules

1. **No trust crosses the browser boundary upward.** The browser sends a Supabase-issued bearer token and request bodies. Identity claims, role, organization membership, ownership, prices, and refund authority are **never** read from the request body and **never** trusted from the token beyond `sub` (user id) and standard claims (`aud`, `iss`, `exp`, `iat`).
2. **Role and organization authority are derived server-side on every request.** The API loads the caller's active membership from Postgres and uses it for authorization. Membership changes take effect from the database immediately, not from cached token claims.
3. **Frontend uses Supabase only for authentication.** The web app never calls PostgREST directly with the anon key for domain data. Domain data flows only through the NestJS API. PostgREST is Supabase internal infrastructure and is not a public API: all browser-to-database traffic routes through NestJS, PostgREST endpoints are not exposed to the internet, the NestJS rejection-audit handler is therefore the single gate for all refund attempts, and the `create_refund` function's `GRANT EXECUTE TO authenticated` is for NestJS-service-layer callers, not direct browser access.
4. **Elevated credentials never reach the frontend.** The `SUPABASE_SERVICE_ROLE_KEY` is referenced only inside the NestJS process. It is loaded from the API process environment, never from `NEXT_PUBLIC_*`, and is never returned by any endpoint.
5. **Elevated credentials are isolated from ordinary requests.** `DatabaseModule` exports only `callerClient(accessToken)`. There is no `DatabaseModule.adminClient()` provider, no exported elevated client, and no generic maintenance caller reachable through dependency injection from domain modules. The exact allowlist of in-process readers of `SUPABASE_SERVICE_ROLE_KEY` is: (a) the privately scoped audit-writer provider inside `AuditModule`, which constructs its own service-role Supabase client internally and does not expose it as a DI token, and (b) the separate local seed entry point, which constructs its own service-role client and is not importable by runtime domain modules. Ordinary controllers and services depend only on `callerClient`; domain modules cannot obtain an elevated client through DI.
6. **CORS is an exact-origin allowlist.** The API accepts browser requests only from the configured `WEB_ORIGIN`. Cross-origin requests without credentials are not permitted for authenticated endpoints.
7. **Bearer tokens are the only authentication channel.** No session cookies, no API keys issued to end users, no HMAC-signed request bodies.
8. **All request bodies pass DTO validation with `whitelist: true` and `forbidNonWhitelisted: true`.** Unknown fields are rejected as 400.
9. **Request limits and throttling are applied at the API edge.** Maximum body size, JSON depth, and per-IP/per-user request rates are bounded.

### 4.3 What the API Does Not Trust From the Token

The NestJS guard extracts and validates:

- `sub` — Supabase user id (treated as an opaque identifier).
- `aud` — must equal `SUPABASE_JWT_AUDIENCE`.
- `iss` — must equal `SUPABASE_JWT_ISSUER`.
- `exp` — must be in the future.
- `iat` — must be in the past or present; tokens issued in the future are rejected as 401.

The guard does **not** read role, organization, or custom claims from the token for authorization. These are re-derived from the database on every request.

---

## 5. Components

### 5.1 Supabase Local Stack

- **Postgres** — system of record. Schema lives in `supabase/migrations/`. RLS is enabled on every domain table. Extensions: `pgcrypto`, `citext`.
- **GoTrue** — identity provider. Issues JWTs signed with the project's signing key (asymmetric). The JWKS is exposed at `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
- **PostgREST** — present for Supabase internals; the application does not depend on it directly.
- **Studio** — local-only inspection tool; not used in automated tests.

### 5.2 NestJS API

#### 5.2.1 Bootstrapping

The application boots through `main.ts` which configures:

- `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` globally.
- A Problem Details exception filter (Section 10.3).
- A request-id middleware that assigns a UUID per request, exposes it via the `X-Request-Id` response header, and echoes it on errors.
- CORS configured with `origin: [WEB_ORIGIN]`, `credentials: false`, explicit methods and headers.
- Body parsing limits (`100kb` JSON, `100kb` urlencoded) and `express.json({ limit: '100kb' })`.
- `@nestjs/throttler` with conservative defaults (60 requests per minute per IP for authenticated routes, 20 for anonymous routes).
- Helmet with a conservative default header policy.
- OpenAPI generation via `@nestjs/swagger`, with the runtime endpoints `/docs` (Swagger UI) and `/docs-json` (the OpenAPI JSON document) mounted only when the typed env config `OPENAPI_ENABLED` is `true`. The default for `OPENAPI_ENABLED` is `true` when `NODE_ENV` is not `production` (local development and tests) and `false` when `NODE_ENV` is `production`; staging sets it explicitly to `true` because Projects 2 and 3 consume `/docs-json`. When `OPENAPI_ENABLED` is `false`, requests to `/docs` or `/docs-json` return 404 Problem Details (`code: not_found`); the routes are not mounted at all. No separate docs service is introduced. OpenAPI is generated at runtime from controllers and DTOs and is part of the runtime surface, not a build-time artifact.
- Graceful shutdown hooks.

Production-mode boot disables stack traces in error responses (`process.env.NODE_ENV === 'production'` ⇒ stack trace omitted).

#### 5.2.2 AuthModule

- `JwtVerifier` — fetches and caches Supabase JWKS, verifies signature, `aud`, `iss`, and `exp`. Uses `jose` with `jwtVerify` and `createRemoteJWKSet`.
- `AuthGuard` — NestJS `CanActivate` that resolves the bearer token, calls `JwtVerifier`, and on success retains the verified raw token in request-scoped internal auth context only (`req.principal = { userId, accessToken }`). The token is never logged, persisted, returned to the browser, or used to mint a new token. The API never impersonates the caller: the verified token is passed to a caller-scoped Supabase client that uses the anon/publishable key so that Postgres runs as `authenticated` with `auth.uid()` set from the verified JWT.
- `MeController` — `GET /me`. Returns exactly the authenticated caller's own profile and the caller's own active memberships (read via caller-scoped client so RLS applies). `GET /me` returns only the caller's profile plus active memberships; it does not return same-org profiles, same-org membership lists, organization rosters, or any other resource. Same-org profile SELECT visibility on `profiles` exists in the RLS policy surface only to support the members endpoint and does not broaden `/me`; `MeController` does not enumerate other users, does not join across `memberships`, and does not return any list keyed on another user id.

#### 5.2.3 OrganizationsModule

- `OrganizationsController`:
  - `GET /organizations` — lists organizations in which the caller has an active membership.
  - `GET /organizations/:organizationId/members` — lists members of the organization.
  - `PATCH /organizations/:organizationId/members/:userId` — updates a member's role or active status. Enforces last-admin self-demotion and self-suspension prohibitions (Section 8).
- `MembershipService` — loads the caller's active membership for an organization, performs role checks, performs tenant ownership checks, and executes the update via caller-scoped client.

#### 5.2.4 InvoicesModule

- `InvoicesController`:
  - `GET /organizations/:organizationId/invoices` — list invoices in the organization.
  - `POST /organizations/:organizationId/invoices` — create an invoice. The DTO accepts only `customerId`, `description`, `amountMinor`, `currency`; `amountMinor` and `currency` are request input that is strictly validated by the DTO and constrained by the database. `ownerId` is derived server-side via the column default `auth.uid()`; `status` defaults to `draft` server-side. `organizationId` is supplied to the insert solely from the URL path parameter (never from the body), and the API verifies the caller has an active `manager` or `organization_admin` membership in that organization before issuing the insert through the caller-scoped client.
  - `GET /organizations/:organizationId/invoices/:invoiceId` — retrieve an invoice.
  - `PATCH /organizations/:organizationId/invoices/:invoiceId` — limited transitions (mark `issued`, `paid`, `cancelled`). State-machine logic is in the service.
- `InvoiceService` — first calls `MembershipService.loadActiveMembership` for the URL organization, performs the endpoint role check in NestJS, validates inputs, fetches detail rows by both URL organization and invoice ID, independently checks owner/role on the returned row, then executes the same operation through the caller-scoped RLS client. A unit test proves inactive/insufficient callers are rejected before the invoice query or mutation is invoked.

#### 5.2.5 RefundsModule

- `RefundsController`:
  - `POST /organizations/:organizationId/invoices/:invoiceId/refunds` — create a refund. DTO accepts `amountMinor`, `currency`, `reason`, `idempotencyKey`; `actorId`, `organizationId`, and `invoiceId` are derived server-side, not accepted from the body.
- `RefundService` — first calls `MembershipService.loadActiveMembership` for the URL organization and requires `manager` or `organization_admin` in NestJS; a unit test proves an inactive/insufficient caller is rejected before RPC invocation. It then calls a single PostgreSQL function (`public.create_refund(p_invoice_id, p_amount_minor, p_currency, p_reason, p_idempotency_key, p_request_id)`) inside one transaction. `p_request_id` is the API request/correlation UUID passed as a non-authority metadata parameter; it is persisted as the success `audit_events.correlation_id` so the audit row is correlatable with the API request. The function derives the actor from `auth.uid()`, locks the invoice row, validates invoice state, validates amount and currency, enforces idempotency and cumulative refunds against the invoice amount, persists the refund, appends the SUCCESS audit event in the same transaction using `p_request_id` as the `correlation_id`, and returns the persisted record. Concurrency safety is provided by `SELECT ... FOR UPDATE` on the invoice row inside the transaction; concurrent requests cannot over-refund.

#### 5.2.6 AuditModule

- `AuditService` — `record({ actorId, organizationId, action, targetType, targetId, result, metadata })`. Persists to `audit_events` through a service-role Supabase client constructed inside a privately scoped audit-writer provider owned by `AuditModule`. The audit-writer provider is the only module-internal reader of `SUPABASE_SERVICE_ROLE_KEY`; it constructs its own client (`createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })`) and does not export that client as a DI token. The provider is module-private: it is not exported from `AuditModule` and no other module can import it. Audit writes must succeed even when the calling user's RLS policies would deny access; the `audit_events` table has a dedicated insert policy restricted to the service-role client and rejects ordinary member-scoped writes. The `AuditModule`/`AuditService` is the only application-tier writer to `audit_events`; the `create_refund` RPC is the DB-tier success-audit writer (its success row is appended in the same PostgreSQL transaction as the refund insert inside `create_refund` so the refund and its success audit are atomic). Rejected-attempt audit is mandatory, not optional: after a refund transaction rolls back (idempotency conflict, over-refund, invalid state, invalid amount, currency mismatch), the handler MUST invoke the isolated `AuditService` to record the rejected attempt before returning the mapped rejection. The global `AuthGuard`, the DTO `ValidationPipe`, and the Problem Details exception filter MUST record applicable auth/DTO/high-risk rejections using the isolated `AuditService`, using safe request context (never bearer tokens, never full request bodies, never `Authorization` headers). If required audit persistence is unavailable when a high-risk rejection must be recorded, the system fails closed: the endpoint returns `503` Problem Details with `code: audit_unavailable` and emits a redacted structured fallback error log (no token, no body, no `Authorization` header). There is no audit API or audit-table read access in Project 1.
- High-risk actions emit success and rejection events:
  - Membership role change (success, rejected as forbidden, rejected as last-admin).
  - Invoice creation, status transition.
  - Refund creation (success in the refund transaction, rejection due to amount/state/idempotency/concurrency after rollback).
  - Authentication failures (token verification failures with `actorId = null`).
- Audit records never include bearer tokens, full request bodies, `Authorization` headers, secrets, or sensitive identifiers. The `reason` field for refunds is recorded as a length and a hash prefix, not the raw value. No ordinary audit-table read access exists in Project 1.

#### 5.2.7 HealthModule

- `GET /health` — the single readiness endpoint. Database readiness calls `public.health_check()` through an anon-key Supabase client; the SQL function is `stable security invoker set search_path = ''`, returns only `true`, reads no table, has `EXECUTE` revoked from `public`/`authenticated` and granted only to `anon`, and therefore proves PostgREST-to-PostgreSQL execution without granting anonymous table access. Returns `200 { status: "ok" }` when the process is running, required configuration is present, and the required Supabase database, Supabase Auth, and Supabase JWKS dependencies are reachable. Returns RFC 9457 Problem Details with `title`, numeric `status: 503`, `code: dependency_unavailable`, and `requestId` (matching the `X-Request-Id` response header) when any required Supabase runtime dependency is unavailable. Missing required startup configuration prevents boot and is not expressed as a `/health` response. No separate liveness endpoint is exposed in Project 1.

### 5.3 Next.js Web

- Uses `@supabase/ssr` for auth state in Server Components and Route Handlers. No `localStorage` token caching.
- Server-side fetches to the NestJS API use `fetch` with the user's bearer token attached; tokens are obtained per-request from the Supabase session cookie.
- Client components receive no elevated credentials. They send only the user-scoped bearer token in `Authorization: Bearer …` headers.
- Routes enforce client-side role checks for UX only; the API is the authoritative enforcement point.

---

## 6. Data Model and Invariants

### 6.1 Schema

All tables live in the `public` schema. All domain tables have RLS enabled and a `tenant_id`-style scoping mechanism.

```sql
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
```

### 6.2 RLS Policies and Direct PostgREST Safety

RLS is enabled and forced on every domain table. Column-level `GRANT`s restrict the `authenticated` role to the columns the application actually exposes; anything outside the allowlist is `REVOKE`d at the Postgres role level so that direct PostgREST or `psql` access cannot bypass DTO and business invariants. The API uses two Postgres roles for policy expressions:

- `authenticated` — the role assumed by caller-scoped Supabase clients (anon-key authenticated as a user). Policies branch on `auth.uid()` to scope rows to the caller's memberships.
- `service_role` — used only by the audit-writer provider inside `AuditModule` and by the separate local seed entry point. There is no generic admin client exported through DI. The default Supabase convention is that `service_role` bypasses RLS; Project 1 retains that convention and deliberately uses that broad bypass capability inside the audit-writer provider (which must persist audit rows even when RLS would deny a caller-scoped write) and inside the local seed entry point (which provisions identities, memberships, invoices, and refund fixtures across all tenants in one transaction). Project 1 does **not** use the service-role key inside `create_refund`. The `create_refund` function is owned by a named, explicitly controlled non-client migration/definer role (`public_refund_definer`), which is distinct from the Supabase `service_role` Postgres role; the function runs with that definer's privileges, never with the Supabase service-role key, and the definer role is explicitly not a member of `service_role`. Containment of the elevated credential is enforced at exact application callsites: `SUPABASE_SERVICE_ROLE_KEY` is read only by the privately scoped audit-writer provider inside `AuditModule` (which constructs its own service-role Supabase client and does not expose it) and by the separate local seed entry point (which constructs its own service-role client and is not importable by runtime domain modules). `DatabaseModule` exports no provider that exposes an elevated client; domain modules (organizations, invoices, refunds, etc.) cannot obtain an elevated client through dependency injection. An architectural test in Project 1 (Section 11.5) asserts that `DatabaseModule` exports no elevated provider and that only `AuditModule` plus the separate seed entry point reference `SUPABASE_SERVICE_ROLE_KEY` or service-role client construction.

Policy summary:

| Table | Select | Insert | Update | Delete |
|---|---|---|---|---|
| `profiles` | self OR same-organization active member | self only | self only | denied |
| `organizations` | caller has any active membership in the row | denied for `authenticated` | denied for `authenticated` | denied |
| `memberships` | caller's own row regardless of status OR caller has active membership in the same `organization_id`; the self branch exists only so NestJS can map suspended self to 403 | denied for `authenticated` | only `organization_admin` of the same `organization_id` | denied |
| `invoices` | ordinary `user`: only rows where `owner_id = auth.uid()` AND same `organization_id`; `manager` or `organization_admin`: any row in their `organization_id` | caller has active membership in `organization_id` with role `manager` or `organization_admin`; the insert exposes only safe input columns (`organization_id`, `customer_id`, `description`, `amount_minor`, `currency`) at the column `GRANT` level; `owner_id` is DB-derived via its `default auth.uid()` and `status` is DB-derived via its `default 'draft'` and neither column is granted to `authenticated`; DB `CHECK` constraints mirror DTO bounds (`char_length(customer_id) between 1 and 128`, `char_length(description) between 1 and 1024`, `amount_minor between 1 and 9007199254740991`, `currency ~ '^[A-Z]{3}$'`) so direct PostgREST cannot bypass DTO validation | caller has active membership in `organization_id` with role `manager` or `organization_admin`; the update exposes only the `status` column and a DB trigger enforces the legal state transitions in Section 6.4 | denied |
| `refunds` | ordinary `user`: only refunds whose invoice's `owner_id = auth.uid()` AND `organization_id` matches an active membership; `manager` or `organization_admin`: any refund in their `organization_id` (mirrors `invoices` SELECT visibility). No `INSERT`/`UPDATE`/`DELETE` for `authenticated`. | denied for `authenticated` (direct INSERT into `refunds` is denied); only the `create_refund` RPC inserts | denied | denied |
| `audit_events` | no `authenticated` read access in Project 1 (no audit API exists) | only the privately scoped audit-writer provider inside `AuditModule` (the application-tier writer; the `create_refund` RPC appends its success row in the same DB transaction under the definer role's grants) | denied | denied |

Direct INSERT into `refunds` is denied at the column/grant level and by RLS so that the only path to creating a refund is the `create_refund` RPC. The `create_refund` function is `SECURITY DEFINER` and is owned by a dedicated, non-login definer role. The role, the function, and the supporting grants/policies are designed to be executable under the rule that every domain table has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` (Section 6.2 opening). The exact migration is:

```sql
-- 1. Dedicated definer role. NOLOGIN: no human, no app process logs in as this role.
--    NOINHERIT: it does not silently inherit privileges from any parent role.
--    NOBYPASSRLS: it must operate through RLS-targeted grants and policies, not by
--    blanket bypass, so its behavior is reviewable against the same RLS surface as
--    ordinary callers.
create role public_refund_definer nologin noinherit nobypassrls;

-- 2. The role owns nothing else in the database. It is created empty; the only
--    object it owns is the create_refund function itself (set in step 4).
--    No credentials (no password, no SCRAM verifier, no auth-method mapping
--    entries) are ever set on this role, so the role cannot be impersonated by
--    presenting a password.

-- 3. Exact table privileges required by create_refund. No broader grants are
--    issued; nothing is granted on profiles, organizations, audit_events beyond
--    the single success-row insert needed by the function, or any other object
--    outside this allowlist. SELECT on refunds is required to evaluate the
--    idempotency check and the cumulative-cap sum; INSERT on refunds is the
--    function's only mutating path; SELECT on invoices and SELECT on memberships
--    are required for the lock + authorization derivation; UPDATE(id) on
--    invoices is the narrowly scoped column grant that authorizes the row lock
--    taken by `SELECT ... FOR UPDATE` (PostgreSQL authorizes row locking through
--    the UPDATE privilege, not the SELECT privilege; SELECT alone is verified
--    insufficient). The grant is column-restricted to `id` only, so it cannot
--    be used to mutate any other invoice column; the function contains no
--    UPDATE statement on invoices, so the grant is not exercised for mutation
--    by the function. INSERT on audit_events is required for the atomic
--    success audit row in the same transaction.
grant select on public.invoices   to public_refund_definer;
grant update (id) on public.invoices to public_refund_definer;
grant select on public.memberships to public_refund_definer;
grant select, insert on public.refunds  to public_refund_definer;
grant insert on public.audit_events to public_refund_definer;

-- 3a. auth schema privileges required for `auth.uid()` to execute under the
--     `public_refund_definer` SECURITY DEFINER role. A custom non-login role
--     has no implicit privileges on the `auth` schema in standard PostgreSQL /
--     Supabase, so the function's `v_actor_id := auth.uid()` call would fail
--     with a permissions error without these grants. USAGE on the schema
--     allows the definer to resolve `auth` references; EXECUTE on the function
--     `auth.uid()` allows the definer to call it. No broader auth-schema
--     grants (no SELECT on `auth.users`, no EXECUTE on any other `auth.*`
--     function) are issued; the definer role's exposure to the `auth` schema
--     is limited to the single function the create_refund RPC needs.
grant usage on schema auth to public_refund_definer;
grant execute on function auth.uid() to public_refund_definer;

-- 4. The full function definition lives in Section 6.3, where it is created as
--    SECURITY DEFINER. The ownership transfer to public_refund_definer and the
--    REVOKE/GRANT EXECUTE statements (using the full six-type signature) appear
--    immediately after the Section 6.3 function body. The definer role owns no
--    other object.

-- 5. Targeted definer-role RLS policies. FORCE ROW LEVEL SECURITY is in effect
--    on every domain table, so even a SECURITY DEFINER caller is subject to RLS
--    unless the role has BYPASSRLS. The definer role has BYPASSRLS false, and
--    therefore can perform the create_refund operations only because narrowly
--    scoped, INSERT/SELECT/UPDATE-targeted policies exist that admit this
--    specific role. Ordinary authenticated policies/grants on these tables
--    remain unchanged: the targeted policies are additive and ONLY admit
--    public_refund_definer for the specific operations create_refund performs.
--    The six targeted policies are exactly: SELECT on invoices (the function
--    reads only the locked row by id), UPDATE on invoices restricted to the
--    `id` column (present solely because PostgreSQL authorizes
--    `SELECT ... FOR UPDATE` through UPDATE permissions; SELECT privilege plus
--    a SELECT policy are verified insufficient for the row lock — without this
--    UPDATE policy and the matching `update (id)` column grant in step 3 the
--    `SELECT ... FOR UPDATE` in create_refund is rejected. The function
--    contains no invoice UPDATE statement, so the policy is never exercised
--    for an actual column write; it exists only to admit the row lock, and
--    because the definer role is NOLOGIN and reachable only through this
--    function, no other call path can reach it), SELECT on memberships (the
--    function reads only the row matched on (organization_id, user_id)),
--    SELECT on refunds (the idempotency lookup and the cumulative-cap sum),
--    INSERT on refunds (the function's only mutating path), and INSERT on
--    audit_events restricted to action = 'refund.created' and result =
--    'success' (the atomic success audit row in the same transaction).
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

-- 6. Execute grant: revoke PUBLIC execute, grant EXECUTE to authenticated only.
--    These statements (and the function-ownership ALTER) appear after the
--    Section 6.3 function body, using the full six-type signature
--    public.create_refund(uuid, bigint, char, text, text, uuid).
```

This design is executable under `ENABLE/FORCE ROW LEVEL SECURITY` on every domain table: the definer role does not hold `BYPASSRLS`, so when `create_refund` runs as `public_refund_definer` and touches a `FORCE RLS` table, Postgres evaluates the table's policies and admits the operation only because the targeted policies in step 5 explicitly grant the definer role the small set of operations the function needs. No other definer-role policies exist on these tables, and no authenticated-user policy or grant is changed: ordinary users continue to be admitted (or denied) by the existing ordinary policies. The definer role is not a member of `service_role` and is not a member of any other privileged Postgres role, so membership in `service_role` is not a transitive privilege path into the function's data. The role has no login capability, no password, and no credentials, so it cannot be reached by any direct connection — the only way to execute under its identity is to call `create_refund` via the function call interface as an `authenticated` user.

The function runs with the definer role's privileges. The definer role holds the exact table privileges and RLS-targeted policies required to read `invoices`/`memberships` for the locked row, to read/insert `refunds`, and to insert the success `audit_events` row under that role's narrowly scoped policy; in addition, because `public_refund_definer` is a custom non-login role with no implicit `auth` schema privileges in standard PostgreSQL/Supabase, step 3a grants `USAGE ON SCHEMA auth` and `EXECUTE ON FUNCTION auth.uid()` so that the function's `v_actor_id := auth.uid()` call resolves and executes under the definer's identity (no broader `auth`-schema grants are issued; the definer's exposure to the `auth` schema is limited to `auth.uid()` and to the schema-resolution privilege). The function is hardened with `set search_path = ''`, fully qualified object references (`public.invoices`, `public.refunds`, `public.memberships`, `public.audit_events`), `REVOKE` on `EXECUTE` from `public`, and `GRANT EXECUTE` only to `authenticated`. The function derives the actor from `auth.uid()` only — never from a request-supplied identifier — and asserts that `auth.uid()` matches an active membership with role `manager` or `organization_admin` for the invoice's `organization_id` inside the function.

### 6.3 Refund Function (`public.create_refund`)

```sql
-- Hardened: empty/safe search_path, fully qualified objects, explicit grants,
-- no trust in request-supplied actor/tenant/resource authority.

create or replace function public.create_refund(
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

-- Hand ownership of the function to the dedicated definer role. This is the
-- only object the definer role owns.
alter function public.create_refund(uuid, bigint, char, text, text, uuid) owner to public_refund_definer;

-- Explicit grants; revoke anything not explicitly granted.
revoke all on function public.create_refund(uuid, bigint, char, text, text, uuid) from public;
grant execute on function public.create_refund(uuid, bigint, char, text, text, uuid) to authenticated;
```

The function is owned by a named, explicitly controlled non-client migration/definer role (`public_refund_definer`) declared `SECURITY DEFINER`. It executes with that definer's privileges — not with the Supabase `service_role` key, not with `service_role` Postgres-role membership, and not by minting or impersonating the caller. The actor, tenant, and resource authority are all derived inside the function from `auth.uid()` and the locked invoice row, never from request-supplied parameters. `p_request_id` is the API request/correlation UUID; it is passed to the function as a non-authority metadata parameter and stored as `audit_events.correlation_id` so the audit row is correlatable with the originating API request. Actor, tenant, resource, ownership, role, state, and amount authority are still never taken from this metadata parameter — they are always derived from `auth.uid()`, the locked invoice row, the active membership row, and the DB-enforced constraints. The `AuditService` similarly uses the same request/correlation UUID for rejected-attempt audit rows emitted after rollback so all high-risk audit events for one API request share a single correlation id. `search_path` is set to the empty string and all objects are fully qualified (`public.invoices`, `public.refunds`, `public.memberships`, `public.audit_events`) so no attacker-controlled `search_path` element can shadow a referenced object. Ownership and grants are documented precisely: the function is `OWNED BY public_refund_definer`, `EXECUTE` is granted to `authenticated` only, `EXECUTE` is revoked from `public`, and the function does not require or assume the Supabase `service_role` Postgres role. Same `idempotency_key` with the same normalized payload returns the original refund without inserting a duplicate row, without appending a duplicate success audit, and without mutating any other table; the original success audit row retains the `correlation_id` from the original creation request (the replay's request id is recorded only in the access log, not in `audit_events`); same key with a different payload raises `idempotency_conflict` (HTTP 409), the originating transaction rolls back, and the handler then persists a NEW rejected-attempt audit row through the isolated `AuditService` correlated to the NEW request id. After rollback, the handler MUST persist the rejected-attempt audit row through the isolated `AuditService` before returning the mapped rejection: audit failure is itself a failure mode and maps to a `503` Problem Details with `code: audit_unavailable` plus a redacted structured fallback error log (no token, no body, no `Authorization` header).

Concurrency safety rests on the row-level lock on `public.invoices` taken inside the transaction. Two simultaneous refund attempts on the same invoice serialize on that lock; the second waits, re-reads cumulative refunds under the lock, and is rejected with `over_refund` if it would exceed the cap. Concurrent requests cannot over-refund.

### 6.4 Invariants

1. **Profiles mirror `auth.users`.** A row in `profiles` is created for every user provisioned by the seed mechanism. There is no public registration path.
2. **Active memberships are unique per `(organization_id, user_id)`.** The unique constraint prevents duplicate memberships.
3. **Last-admin protection.** No transaction may reduce the count of active `organization_admin` memberships in an organization below one. Enforced in application code (Section 8) and re-checked inside the membership update SQL by a concurrency-safe Postgres trigger/lock that holds the row lock on the organization until commit. The rule applies to:
   - Self-demotion by the final active admin.
   - Self-suspension by the final active admin.
   - Demotion or suspension of any other admin that would drop the count to zero.
4. **Refund cumulative cap.** `sum(refunds.amount_minor) <= invoice.amount_minor` at all times for any invoice. Enforced inside `create_refund` under a row lock; concurrent requests cannot over-refund.
5. **Idempotency.** Re-posting a refund with the same `idempotency_key` and identical normalized payload returns the original record without inserting a duplicate refund, without appending a duplicate success audit, and without mutating any other table; the original success audit row's `correlation_id` is preserved unchanged and remains correlatable with the original creation request, while the replay's own request id is observable only in the access log. Re-posting with the same key and a different payload raises `idempotency_conflict` (HTTP 409), the transaction rolls back, and the handler MUST persist a NEW rejected-attempt audit row through the isolated `AuditService` correlated to the NEW request id before returning the mapped rejection. If the required audit persistence is unavailable, the endpoint fails closed with a `503` Problem Details (`code: audit_unavailable`) plus a redacted structured fallback log.
6. **Invoice state machine.** `draft → issued → paid` and `draft|issued → cancelled`. No other transitions are permitted. `paid → cancelled` is forbidden. A Postgres trigger on `invoices` enforces these transitions; the application exposes only the `status` column for update.
7. **Refund state precondition.** A refund may be created only against an invoice in `issued` or `paid` status.
8. **Currency consistency.** Refund currency must equal invoice currency.
9. **Tenant integrity.** Every domain row carries an `organization_id` and every RLS policy uses it as the partitioning key. The tenant for a refund is derived from the locked invoice row, never from a request argument.
10. **No privileged request-body authority.** `owner_id`, `organization_id`, actor identity, state, and role authority are never accepted from request bodies or token claims beyond `sub`. On invoice create, `owner_id` is derived as `auth.uid()` server-side; `status` defaults to `draft` server-side.
11. **Direct refund insert denied.** The `authenticated` Postgres role has no `INSERT` privilege on `refunds`; refunds are created only via the `create_refund` RPC.
12. **Suspension is visible only to self.** An authenticated caller may select its own `memberships` row regardless of status so NestJS can distinguish a suspended same-tenant caller (403) from a missing/cross-tenant caller (404). This policy reveals no other membership and grants no organization, invoice, refund, or profile visibility; all tenant-wide policies still require an active membership.
13. **Anonymous readiness has no table access.** `anon` retains no domain-table privilege. It may execute only the table-independent `public.health_check()` readiness function described in Section 5.2.7.

---

## 7. API


### 7.1 Surface

All authenticated endpoints require `Authorization: Bearer <supabase_access_token>`. All paths are version-less in Project 1.

| Method | Path | Auth | Roles | Notes |
|---|---|---|---|---|
| GET | `/me` | required | any | Returns exactly the caller's own profile plus the caller's own active memberships. Same-org profile visibility exists in RLS only to support the members endpoint and does not broaden `/me`. |
| GET | `/organizations` | required | any | Lists organizations caller is an active member of. |
| GET | `/organizations/:organizationId/members` | required | active member | Lists memberships in the organization. |
| PATCH | `/organizations/:organizationId/members/:userId` | required | `organization_admin` | Updates role and/or status. Enforces last-admin protections. |
| GET | `/organizations/:organizationId/invoices` | required | active member | Lists invoices in the organization. |
| POST | `/organizations/:organizationId/invoices` | required | `manager`, `organization_admin` | Creates a draft invoice. |
| GET | `/organizations/:organizationId/invoices/:invoiceId` | required | active member | Retrieves an invoice. |
| PATCH | `/organizations/:organizationId/invoices/:invoiceId` | required | `manager`, `organization_admin` | Transitions status. |
| POST | `/organizations/:organizationId/invoices/:invoiceId/refunds` | required | `manager`, `organization_admin` | Creates a refund. Idempotent by `idempotencyKey`. |
| GET | `/health` | anonymous | n/a | Readiness; returns 200 if required Supabase database/auth/JWKS runtime dependencies are reachable, otherwise 503 Problem Details with numeric `status: 503`, `title`, `code: dependency_unavailable`, and `requestId`. Missing required startup configuration prevents boot and is not expressed as a `/health` response. No separate liveness endpoint. |

OpenAPI is generated by `@nestjs/swagger` from controller decorators and DTOs and is served at `GET /docs-json` (with `GET /docs` for Swagger UI) only when the typed env config `OPENAPI_ENABLED` is `true`. The default is enabled for local development and tests and disabled in production; staging sets it explicitly to `true`. Project 2 consumes this artifact for endpoint inventory and fuzz seeding, and Project 4 keeps it enabled in staging for DAST scenario generation.

### 7.2 Request DTOs (allowlists)

All DTOs use `class-validator` decorators and the global `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true`. Any unknown field is rejected as 400.

- `CreateInvoiceDto`: `customerId: string (1..128)`, `description: string (1..1024)`, `amountMinor: int (1..9007199254740991)`, `currency: string (^[A-Z]{3}$)`. `amountMinor` and `currency` are request input that is strictly validated by the DTO (the `@Max(9007199254740991)` upper bound on `amountMinor` is `Number.MAX_SAFE_INTEGER`, so JSON/TypeScript and PostgreSQL preserve the integer exactly while remaining above any real invoice value) and constrained by the database (`amount_minor between 1 and 9007199254740991`, `currency ~ '^[A-Z]{3}$'`); they are not magically server-derived. `ownerId`, `organizationId`, and `status` are not accepted.
- `PatchInvoiceDto`: `status: 'issued' | 'paid' | 'cancelled'`. No other fields are accepted. The legal transitions are also enforced by a Postgres trigger on `invoices`.
- `CreateRefundDto`: `amountMinor: int (1..9007199254740991)`, `currency: string (^[A-Z]{3}$)`, `reason: string (1..512)`, `idempotencyKey: string (1..128)`. The `@Max(9007199254740991)` upper bound on `amountMinor` is `Number.MAX_SAFE_INTEGER`, so JSON/TypeScript and PostgreSQL preserve the integer exactly while remaining above any real refund value. `actorId`, `organizationId`, and `invoiceId` are not accepted from the body — they come from the verified token and URL path.
- `PatchMembershipDto`: `role: 'user' | 'manager' | 'organization_admin'`, `status: 'active' | 'suspended'`. At least one of the two fields must be present.

No DTO accepts an `ownerId`, `organizationId`, `actorId`, or authoritative `status`/`role` from the request body. `ownerId` for invoice create is derived as `auth.uid()` server-side; `status` defaults to `draft` server-side; `organizationId` comes from the URL path; `actorId` comes from the verified token.

### 7.3 Response Envelopes

Successful responses return the resource directly (no envelope wrapper). Errors return RFC 9457 Problem Details. The public error body MUST contain at least:

- `title` — short human-readable summary.
- `status` — the HTTP status code as a number, mirrored in the response status line.
- `code` — a stable, machine-readable identifier chosen from a small fixed set: `validation_failed`, `unauthenticated`, `forbidden`, `not_found`, `idempotency_conflict`, `invalid_state`, `last_admin`, `over_refund`, `invalid_amount`, `currency_mismatch`, `throttled`, `dependency_unavailable`, `audit_unavailable`, `internal`. Each code is a single distinct value; the response body carries exactly one `code` field per error. Each code maps unambiguously to one HTTP status per Section 10.1.
- `requestId` — the per-request UUID, matching the `X-Request-Id` response header.

Optional RFC 9457 fields (`type`, `detail`, `instance`) may also appear. Example body:

```json
{
  "type": "https://docs.example/problems/forbidden",
  "title": "Forbidden",
  "status": 403,
  "code": "forbidden",
  "detail": "Caller is not a member of this organization.",
  "instance": "/organizations/00000000-0000-0000-0000-000000000000/members",
  "requestId": "8d7e6f5c-4b3a-2918-1707-6f5e4d3c2b1a"
}
```

The response also carries `X-Request-Id: <uuid>` matching `requestId`. The exact semantics of 400/401/403/404/409/429/500/503 are preserved per Section 10.1.

---

## 8. Authentication and Authorization


### 8.1 Authentication Flow

1. The browser authenticates with Supabase Auth (`signInWithPassword` for seeded identities; no public registration).
2. Supabase returns an access token (JWT) signed with the project's signing key.
3. The browser attaches the token in `Authorization: Bearer <token>` for every API request.
4. The Next.js server obtains the token from the Supabase session cookie when making server-side fetches to the API.
5. The NestJS `AuthGuard` resolves the token, calls `JwtVerifier` to verify signature against Supabase JWKS plus `aud`, `iss`, `exp`, and `iat` (rejecting tokens whose `iat` is in the future and any malformed token), and on success retains the verified raw token in request-scoped internal auth context (`req.principal = { userId, accessToken }`). On any failure (missing, malformed, expired, bad signature, wrong issuer, wrong audience, future `iat`), the guard returns 401 Problem Details and emits an audit `failure` event with `actorId = null`.
6. Domain services never mint or impersonate users. The verified raw token is passed only into a caller-scoped Supabase client constructed with the anon/publishable key so that Postgres enforces RLS with `auth.uid()` derived from the verified token. The token is never logged, stored beyond request scope, returned in a response, or used to mint another token. Service-role credentials remain isolated to the privately scoped audit-writer provider inside `AuditModule` and the separate local seed entry point; domain services cannot obtain an elevated client through DI.

### 8.2 Authorization Decision Order

Every authenticated, tenant-scoped endpoint runs the same sequence:

1. **Authenticate** — `AuthGuard` verifies the bearer token.
2. **Load active membership** — `MembershipService.loadActiveMembership(userId, organizationId)` selects only the caller's own membership row first: a narrow self-select RLS policy permits that row even when suspended, while every tenant-wide policy remains active-only. The service returns the caller's `role` only when active, returns 403 when that own row is suspended, and returns 404 when no own row exists for the URL organization. This is the sole information needed to distinguish a known suspended same-tenant caller from a missing/wrong-organization caller per Section 8.3.
3. **Role check** — Compare membership role against the endpoint's required role(s).
4. **Tenant/resource ownership check** — Resolve the target resource (e.g., invoice) and confirm `organization_id` matches the URL parameter. Mismatches return 404, not 403, to avoid leaking existence.
5. **RLS query** — Execute the domain query through a caller-scoped Supabase client (`callerClient(accessToken)`) constructed with the anon/publishable key and the verified bearer token retained in request-scoped internal auth context. Postgres RLS provides the second enforcement layer; a missing policy or a query that bypasses RLS is detected by the integration tests (Section 11.2).

This ordering means role and organization authority are **never** taken from request bodies or from token claims other than `sub`. Membership role changes take effect from the database immediately on the next request — there is no token-claim caching layer.

### 8.3 Cross-Tenant vs Forbidden Semantics

| Situation | Response |
|---|---|
| Resource does not exist | 404 `not_found` |
| Resource exists in a different tenant | 404 `not_found` (existence is hidden) |
| Resource exists in caller's tenant but caller is suspended | 403 `forbidden` |
| Resource exists in caller's tenant, caller is active, but lacks role | 403 `forbidden` |
| Caller attempts to suspend or demote the last active `organization_admin` in an organization | 409 `last_admin` |

### 8.4 Last-Admin Protection

`MembershipService.updateMember` rejects updates that would leave the target organization with zero active `organization_admin` rows. The check runs inside the same database transaction that performs the update, by counting active admins after applying the proposed change and rolling back if the count would be zero. The rule applies to:

- Self-demotion by the final active admin.
- Self-suspension by the final active admin.
- Demotion or suspension of any other admin that would drop the count to zero.

The same rule applies if the request comes from a different caller (an admin trying to demote the only other admin): the change is rejected with 409 and an audit `rejected` event is recorded. The final active admin cannot bypass the rule by any path exposed by the API.

### 8.5 Caller-Scoped Client Construction

`DatabaseModule` exports a single provider:

- `callerClient(accessToken)` — constructed with the Supabase anon/publishable key and the verified bearer token retained in request-scoped internal auth context. The client sets the user's `Authorization: Bearer <token>` on each outbound request so that Postgres runs as `authenticated` with `auth.uid()` derived from the verified JWT and RLS is enforced. The token is never read from the request body, never stored beyond request scope, never logged, and never returned to the browser. The API never mints, impersonates, or re-signs the caller.

`DatabaseModule` does not export any elevated client, any `adminClient()` provider, or any other DI token that exposes `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is read only by the privately scoped audit-writer provider inside `AuditModule` (which constructs its own service-role Supabase client internally and does not expose it) and by the separate local seed entry point (which constructs its own service-role client and is not importable by runtime domain modules). `callerClient` is the only client reachable through dependency injection from domain services. The service-role key never reaches any endpoint, never appears in logs, and never crosses the browser boundary.

---

## 9. Primary Flows


### 9.1 Authenticate and Inspect Self

1. Browser posts credentials to Supabase Auth; receives access token.
2. Browser `GET /me` with `Authorization: Bearer <token>`.
3. `AuthGuard` verifies token → `MeController` queries profile and active memberships via `callerClient(accessToken)` using the verified bearer token retained in request-scoped internal auth context.
4. RLS returns the profile and only the memberships belonging to active organizations the caller is in.

### 9.2 Create Invoice

1. Caller (manager or admin) `POST /organizations/:organizationId/invoices` with `{ customerId, description, amountMinor, currency }`.
2. `AuthGuard` verifies token.
3. `MembershipService.loadActiveMembership(userId, organizationId)` → role check → role must be `manager` or `organization_admin`.
4. `InvoiceService.create` validates DTO; inserts via `callerClient`.
5. RLS allows the insert because the caller's role matches the policy.
6. `AuditService.record({ action: 'invoice.created', result: 'success', ... })`.
7. Response 201 with the persisted invoice.

### 9.3 Issue a Refund (Idempotent)

1. Caller `POST /organizations/:organizationId/invoices/:invoiceId/refunds` with `{ amountMinor, currency, reason, idempotencyKey }`.
2. `AuthGuard` verifies token.
3. `MembershipService.loadActiveMembership` → role check → `manager` or `organization_admin`.
4. `RefundService.create` invokes `public.create_refund(p_invoice_id, p_amount_minor, p_currency, p_reason, p_idempotency_key, p_request_id)` inside one transaction, passing the API request/correlation UUID as the non-authority `p_request_id`. The function derives the actor from `auth.uid()`, locks the invoice row, derives the tenant from the locked invoice row, performs the active membership/role check internally, enforces idempotency before mutable state validation, validates amount/currency/state, enforces the cumulative cap, inserts the refund, appends the SUCCESS audit event in the same PostgreSQL transaction with `correlation_id = p_request_id`, and returns the persisted record.
5. Caller-scoped client re-reads the refund via RLS to confirm visibility and returns it.
6. On a retry with the same `idempotencyKey` and identical payload, the function takes the early-return path and returns the original row without inserting a duplicate refund or appending a duplicate success audit. The original success audit row's `correlation_id` is the request id of the original creation request and is preserved unchanged; the replay's request id is observable only in the access log line for that request and is not written to `audit_events`. The API returns 201 with the original record. On a retry with the same key but a different payload, the function raises `idempotency_conflict`; the API returns 409 Problem Details with `code: idempotency_conflict`, the originating transaction has rolled back, and the handler MUST now persist a NEW rejected-attempt audit row through the isolated `AuditService` correlated to the NEW request id (so the rejection is correlatable with the request that produced it) before returning. If that audit persistence is unavailable, the endpoint fails closed with `503` Problem Details (`code: audit_unavailable`) plus a redacted structured fallback log.

### 9.4 Change a Member's Role (Including Last-Admin)

1. Caller (admin) `PATCH /organizations/:organizationId/members/:userId` with `{ role?, status? }`.
2. `AuthGuard` → `MembershipService.loadActiveMembership` → role check → must be active `organization_admin`.
3. Inside one transaction:
   a. Read the target membership.
   b. If the proposed change would reduce the active-admin count to zero, raise `last_admin` and roll back.
   c. Apply the update via `callerClient` (RLS permits admins in the same organization).
4. `AuditService.record({ action: 'membership.updated', result: 'success' | 'rejected', target_id: membershipId })`.
5. Response 200 with the updated membership, or 409 Problem Details on last-admin rejection.

---

## 10. Error Handling and Logging

### 10.1 Error Semantics

| HTTP | `code` | Used for |
|---|---|---|
| 400 | `validation_failed` | DTO validation failure, unknown fields, malformed JSON, oversized body. Ordinary HTTP DTO failures always surface as `validation_failed`; `invalid_amount` and `currency_mismatch` are reserved for defense-in-depth paths only. |
| 400 | `invalid_amount` | Refund `amountMinor` failed DB `CHECK` (`amount_minor > 0`). Reserved for the RPC exception path when a row bypasses the DTO; never used for DTO violations, which surface as `validation_failed`. |
| 400 | `currency_mismatch` | Refund `currency` differs from the locked invoice's currency. Reserved for the RPC exception path; never used for DTO violations, which surface as `validation_failed`. |
| 401 | `unauthenticated` | Missing or invalid bearer token, expired token, bad signature, wrong issuer, wrong audience, or future `iat`. |
| 403 | `forbidden` | Caller authenticated and known to the target resource (same-org) but lacks role, or is suspended. |
| 404 | `not_found` | Resource does not exist, or exists in a different tenant (hidden), or caller has no membership row for the resource's organization (indistinguishable from foreign tenant). |
| 409 | `idempotency_conflict` | Same `idempotencyKey` with different payload. |
| 409 | `invalid_state` | Invoice state-machine precondition for a refund (`issued`/`paid`) failed, or another transition/precondition conflict surfaced by the RPC that is neither `last_admin` nor `over_refund` nor `idempotency_conflict`. |
| 409 | `last_admin` | An attempted membership update would leave the organization with zero active `organization_admin` rows. Distinct from `invalid_state`: this is a tenant-membership invariant, not an invoice transition. |
| 409 | `over_refund` | Refund would push cumulative refunds past the invoice amount. Distinct from `invalid_state`: this is a cumulative-cap invariant, not an invoice transition. |
| 429 | `throttled` | Rate limit exceeded. |
| 500 | `internal` | Unhandled error. The message is generic; the request id links to server logs. |
| 503 | `dependency_unavailable` | A critical runtime dependency (e.g., JWKS, database) is unreachable; `/health` returns Problem Details with numeric `status: 503`. |
| 503 | `audit_unavailable` | Required audit-event persistence is unavailable for a high-risk rejection; handler fails closed. |

Each response carries exactly one `code` value; no response combines `invalid_state` with another code, and no code is ever emitted in the form `invalid_state` plus a sub-code. The system fails closed: any unexpected error path returns 500 (or 503) with no information about internal state.

### 10.2 Logging

- Structured JSON logs (`pino`). The configured `LOG_LEVEL` controls the threshold; in development the level is `info` and in production it is set to an enabled level (`info` or higher) so that access logs are always emitted. The default `LOG_LEVEL` is `info`.
- Every request emits one access log line: `{ requestId, method, path, status, durationMs, userId?, organizationId? }`.
- Errors emit a separate error log line with `{ requestId, code, message }` — never with stack trace, request body, or headers in production.
- Audit events are written to `audit_events` and **not** duplicated to the application log stream beyond a one-line reference.

### 10.3 Secret Hygiene

The application never logs:

- Bearer tokens (full or partial).
- `SUPABASE_SERVICE_ROLE_KEY` or any other API key.
- `SUPABASE_ANON_KEY` is also not logged, although it is not strictly secret.
- Request bodies for endpoints that accept credentials, tokens, or sensitive identifiers (refund `reason` is logged only as a length and a hash prefix).
- `Authorization` headers in any form.

A `pino` redaction list enforces this. CI (Project 2) verifies the redaction list with a snapshot test.

---

## 11. Testing and Acceptance


### 11.1 Test Layers

1. **Domain unit tests** — pure functions (state-machine transitions, currency formatting, amount validation) exercised without I/O. Located in `apps/api/src/**/*.spec.ts`. Amount boundary cases include `1`, `9007199254740990`, and `9007199254740991` accepted, with `0`, fractional values, and `9007199254740992` rejected; this proves the JSON/TypeScript safe-integer ceiling.
2. **RLS integration tests** — run against the real local Supabase Postgres instance (started by the test harness, not mocked). Each test boots a fresh schema and seed snapshot, signs a caller token, executes the query through `callerClient`, and asserts visibility. These tests prove that RLS is the active enforcement layer and that no policy accidentally exposes cross-tenant rows.
3. **Nest HTTP e2e tests** — `supertest` against the running Nest application with real JWTs minted by the test harness. They cover the documented minimum matrix in Section 11.2 and additional refund-specific cases.
4. **Frontend typecheck and build** — `tsc --noEmit` and `next build` for `apps/web`. No browser end-to-end tests in Project 1; visual role UI is verified manually with the seeded identities per the delivery document.

### 11.2 Authorization Minimum Matrix

The following cases are required to pass. Direct caller-token tests cover ownership, tenant isolation, suspension, forbidden privileged columns, illegal invoice transitions, last-admin, and direct refund `INSERT` denial.

| Case | Expected |
|---|---|
| Anonymous request to any authenticated endpoint | 401 |
| User A `GET` of own invoice (same tenant, `owner_id = auth.uid()`) | 200 |
| User A `GET` of a same-tenant User B invoice (different `owner_id`, ordinary `user` role) | 404 (existence hidden) |
| `manager` (or `organization_admin`) `GET` of any invoice in their organization | 200 |
| Cross-tenant invoice (different `organization_id`) | 404 |
| Privileged-field mass assignment (invoice DTO with extra `ownerId`, `organizationId`, or authoritative `status` field) | 400 `validation_failed` |
| `manager` issuing refund in own organization | 200/201 |
| `manager` issuing refund in another organization | 404 |
| `user` role attempting PATCH on a membership | 403 |
| `organization_admin` role changing another member's role | 200 |
| Final active `organization_admin` attempting self-demotion | 409 `last_admin` |
| Final active `organization_admin` attempting self-suspension | 409 `last_admin` |
| Suspended caller attempting any authenticated action | 403 |
| Expired token (past `exp`) | 401 |
| Token with wrong issuer | 401 |
| Token with wrong audience | 401 |
| Token with bad signature | 401 |
| Malformed token (not a JWT, three-segment violation, unparsable header/payload) | 401 |
| Token with future `iat` (issued in the future) | 401 |
| Direct Postgres query with caller token against a cross-tenant row | 0 rows (RLS) |
| Direct Postgres INSERT into `refunds` as `authenticated` role | rejected (grant + RLS); only `create_refund` RPC may insert |
| Direct Postgres INSERT into `audit_events` as `authenticated` role | rejected by policy |
| Invoice update attempting illegal transition (`paid → cancelled`) | rejected by DB trigger |

### 11.3 Refund Test Matrix

| Case | Expected |
|---|---|
| Manager issues a refund within cumulative cap, invoice `issued` | 201, audit success |
| `user` role attempts a refund | 403 |
| Refund with `amountMinor <= 0` | 400 `validation_failed` |
| Refund exceeding cumulative cap on the invoice | 409 `over_refund` |
| Same `idempotencyKey`, same payload, repeat request | 201 with original record (no new refund row, no duplicate success audit) |
| Same `idempotencyKey`, different payload | 409 `idempotency_conflict`, rejected-attempt audit |
| Concurrent refunds on the same invoice summing over the cap | One succeeds, the other is rejected with `over_refund`; total never exceeds invoice amount |
| Refund against `cancelled` invoice | 409 `invalid_state` |
| Refund against `draft` invoice | 409 `invalid_state` |
| Refund against `paid` invoice within cap | 201 |
| Audit row produced for every successful refund and every rejected refund | asserted by integration test |

### 11.4 Direct RLS Tests

A dedicated suite calls Postgres directly with a caller token and asserts:

- `select * from invoices` as user A in organization X returns only organization X rows; ordinary `user` rows see only their own `owner_id`, `manager`/`organization_admin` see all of organization X.
- `insert into audit_events` as user A fails.
- `insert into refunds` as user A fails (only the RPC is permitted).
- `insert into invoices (organization_id, customer_id, description, amount_minor, currency) values (...)` as user A with `manager`/`organization_admin` role succeeds and the resulting row's `owner_id = auth.uid()` and `status = 'draft'` (DB-derived defaults; not request-supplied).
- Attempt to `insert into invoices (... owner_id, ...)` or `update invoices set owner_id = ...` as user A: rejected by column grant (the `owner_id` column is not granted to `authenticated`); the same applies to `organization_id`.
- Attempt to `insert into invoices (... amount_minor, currency ...)` with `amount_minor <= 0` or a non-`^[A-Z]{3}$` `currency`: rejected by DB `CHECK` constraint even when the column is granted.
- Attempt to `insert into invoices (... customer_id, description ...)` outside the `1..128`/`1..1024` length bounds: rejected by DB `CHECK` constraints (DTO alone is not relied upon for these bounds).
- Attempt to `update invoices set amount_minor = ...`, `currency = ...`, or `owner_id = ...`: rejected by column grant (only `status` is granted to `authenticated` for update).
- `update invoices set status = 'cancelled' where id = ...` on a `paid` invoice: rejected by the DB trigger (illegal transition `paid → cancelled`).
- `update invoices set status = 'draft' where id = ...` on an `issued` invoice: rejected by the DB trigger (illegal backward transition).
- `update memberships set role = 'user' where user_id = <final_admin>` (self-demotion of final active admin) and the equivalent `update memberships set status = 'suspended'` (self-suspension): rejected with `last_admin`; the same applies to a different admin demoting or suspending the only other active admin.
- `select create_refund(p_invoice_id, p_amount_minor, p_currency, p_reason, p_idempotency_key, p_request_id)` as user A in organization X with role `user` raises `forbidden` (same-org, insufficient role).
- `select create_refund(p_invoice_id, p_amount_minor, p_currency, p_reason, p_idempotency_key, p_request_id)` as user A in organization X attempting to refund an invoice in organization Y is hidden by RLS and raises `not_found` (cross-tenant existence hiding; the response is indistinguishable from the "no such invoice" path).
- Direct `insert into refunds (...)` as `authenticated` role: rejected by column grant and RLS; only the `create_refund` RPC may insert.

### 11.5 Acceptance Criteria for Project 1

Project 1 is complete when:

1. `npm install` at the repo root installs all workspaces.
2. `supabase start` brings up the local stack; `supabase db reset` applies migrations and the seed.
3. `npm run -w apps/api start:dev` boots the NestJS API on port 3001.
4. `npm run -w apps/web dev` boots the Next.js app on port 3000.
5. The delivery document (`docs/superpowers/specs/2026-03-09-continuous-security-demo-delivery.md`) describes all of the above with exact commands and lists the seeded identities.
6. The seeded identities cover each role: at least one `user`, one `manager`, one `organization_admin`, one suspended member, and two organizations (so cross-tenant tests are exercisable).
7. The web role UI shows the role-appropriate menu items for each seeded identity.
8. `GET /docs-json` returns the OpenAPI document produced from the NestJS controllers, because `OPENAPI_ENABLED` defaults to `true` for local development and tests.
9. `npm test` at the repo root runs all three test layers (domain, RLS integration, Nest e2e) and all assertions pass.
10. `npm run -w apps/web build` and `npm run -w apps/api build` complete without errors.

Project 1 also ships, as part of its test suite, a single small architecture/unit test that asserts the elevated-credential containment boundary. The test is plain Jest (or the project's chosen unit-test runner) over the compiled `apps/api/src` tree — no scanner framework, no architectural-analysis dependency. Concretely, the test:

- Enumerates the providers exported by `DatabaseModule` and asserts that none of them references `SUPABASE_SERVICE_ROLE_KEY` and none constructs a service-role Supabase client (`createClient(..., SUPABASE_SERVICE_ROLE_KEY, ...)` or any wrapper around it).
- Greps the `apps/api/src` source tree for the literal `SUPABASE_SERVICE_ROLE_KEY` and for service-role client construction and asserts that the only matching files are `audit.module.ts` (or its audit-writer provider) and the local seed entry point. No other runtime source file is permitted to reference the elevated key or to construct a service-role client.
- Asserts that domain modules (`organizations`, `invoices`, `refunds`, etc.) do not import any symbol that exposes an elevated client.

If any of the above fails, the test fails and Project 1 acceptance criterion 9 fails. This test is run by `npm test` at the repo root and is part of Project 1, not Project 2.

No Project 2–6 artifact is present in the repository at Project 1 completion.

---

## 12. Delivery Boundaries and Future Projects


### 12.1 Project 1 Deliverables (this project)

- `docs/superpowers/specs/2026-03-09-continuous-security-demo-design.md` (this document).
- `docs/superpowers/specs/2026-03-09-continuous-security-demo-delivery.md` (install/start/run/test playbook).
- `package.json` (npm workspaces root).
- `apps/web` (Next.js App Router + Tailwind, role-aware UI, typecheck/build clean).
- `apps/api` (NestJS, OpenAPI from controllers, fail-closed defaults, full test matrix green).
- `supabase/config.toml`, `supabase/migrations/*`, `supabase/seed.sql` (deterministic local seed).

### 12.2 Project 2 — Deterministic Pull-Request Security

- GitHub Actions workflows: dependency audit (npm audit / OSV-Scanner), license scan, secret scan (gitleaks), IaC scan (none in Project 1), SBOM emission (CycloneDX).
- SARIF upload to GitHub code scanning (`github/codeql-action/upload-sarif` or equivalent).
- Known-vulnerable dependency fixtures (intentionally pinned CVE versions in a `fixtures/vulnerable/` subtree excluded from the production build path) so scanners have signal to find.
- Pin/lock policy enforced in CI.
- Does not modify application code or authorization decisions.

### 12.3 Project 3 — Application-Specific Verification

- Endpoint inventory generation from `/docs-json`.
- Property-based fuzzing of API endpoints (fast-check / Schemathesis) against the running NestJS process.
- Authorization integration tests against the ZAP baseline (when run) or against the inventory directly.
- SARIF surfacing of findings into GitHub Issues via `gh` CLI.

### 12.4 Project 4 — Staging Security Verification

- Managed Supabase project and production-like configuration (still local-executable from a developer workstation).
- OWASP ZAP baseline scan against the staging API.
- OpenAPI-driven DAST scenario generation.
- Secrets via Doppler / 1Password CLI / GitHub OIDC; no `.env` files containing real secrets.

### 12.5 Project 5 — AI-Assisted Review

- AI-assisted diff review on pull requests, scoped to Project 1–4 invariants (authn/authz boundary, RLS coverage, secret hygiene, audit completeness).
- AI suggestions are advisory and gated by human approval.

### 12.6 Project 6 — Findings and Governance

- Centralized findings dashboard sourced from GitHub code scanning alerts, SARIF uploads, and manual issues.
- SLAs on findings by severity; rotation policy for stale alerts.
- Quarterly review of authorization policy changes against the invariants in Section 6.

### 12.7 Tooling Rule Across Projects 2–6

- Use GitHub-native primitives (SARIF upload, code scanning, issues, Actions artifacts, environments) before introducing any custom platform. No bespoke dashboards or pipelines until GitHub primitives demonstrably cannot meet the requirement.

---

## 13. Resolved Decisions

The following decisions were resolved during design review. Each is final; future projects inherit the choice unless an explicit amendment updates this section.

1. **Monorepo tooling: plain npm workspaces.** No Nx, Turborepo, or Lerna. `package.json#workspaces` and root-level scripts are sufficient.
2. **Database access: Supabase JS client + `pg`/`postgres-js` for server-side SQL.** No ORM. The `create_refund` function lives in Postgres and is invoked through the Supabase RPC surface.
3. **Authorization layers: NestJS guards + Postgres RLS.** No in-process policy engine. No OPA. The two layers must agree; tests cover both.
4. **JWT verification: Supabase JWKS via `jose`.** Verification happens on every request; tokens are not cached beyond the lifetime of a single request.
5. **Token claims trusted: `sub`, `aud`, `iss`, `exp`, `iat` only.** Role and organization are derived from the database on every request.
6. **Refund concurrency: one PostgreSQL transaction with `SELECT ... FOR UPDATE` on the invoice row.** No application-level lock; no advisory locks.
7. **Idempotency key scope: `(invoice_id, idempotency_key)` unique.** Same key with identical normalized payload returns the original refund without inserting a duplicate row, without appending a duplicate success audit, and without mutating any other table; the original success audit retains the `correlation_id` of the original creation request (the replay's request id is recorded only in the access log, not in `audit_events`). A different payload returns 409, rolls back, and the handler then writes a NEW rejected-attempt audit row through the isolated `AuditService` correlated to the NEW request id.
8. **Currency model: ISO-4217 three-letter codes stored as `char(3)` and validated by regex.** Amounts are integer minor units (`bigint`). No floating-point money.
9. **Elevated credentials scope: `SUPABASE_SERVICE_ROLE_KEY` is read only by the privately scoped audit-writer provider inside `AuditModule` and by the separate local seed entry point.** `DatabaseModule` exports only `callerClient(accessToken)` and does not export any elevated client or any provider that exposes `SUPABASE_SERVICE_ROLE_KEY`. Domain modules cannot obtain an elevated client through dependency injection. The API never mints or impersonates users; the verified bearer token is retained only in request-scoped internal auth context and passed to `callerClient` using the anon/publishable key. Enforced by code review and by an architectural test in Project 1 (Section 11.5).
10. **Frontend ↔ Supabase: auth only.** Domain data flows through the NestJS API exclusively.
11. **OpenAPI: generated at runtime by `@nestjs/swagger`, served at `/docs-json` (and `/docs` for Swagger UI) only when the typed env config `OPENAPI_ENABLED` is `true`.** The default is enabled for local development and tests (`NODE_ENV !== 'production'`) and disabled in production (`NODE_ENV === 'production'`); staging sets it explicitly to `true` because Projects 2 and 3 consume `/docs-json`. No build-time artifact; no separate docs service. When disabled, the routes are not mounted and requests to `/docs` or `/docs-json` return 404 Problem Details (`code: not_found`).
12. **Error format: RFC 9457 Problem Details.** The public error body MUST contain at least `title`, `status`, `code`, and `requestId`; optional RFC 9457 fields (`type`, `detail`, `instance`) may also appear. `requestId` matches the `X-Request-Id` response header. No custom envelope.
13. **Last-admin protection: enforced in `MembershipService` inside the same transaction as the membership update, with a Postgres re-check.** No path bypasses it.
14. **Cross-tenant semantics: 404, not 403, when the resource exists outside the caller's tenant.** Existence is hidden.
15. **Body limits: 100 KB JSON.** Throttling: 60 rpm authenticated, 20 rpm anonymous. Tunable via env.
16. **CORS: exact origin allowlist (`WEB_ORIGIN`), `credentials: false`.**
17. **Project 1 does not introduce vulnerability fixtures, scanners, or CI.** Those are scoped to Projects 2–6.
18. **Future dashboarding uses GitHub-native SARIF/issues/artifacts before any custom platform.**
19. **Startup failure contract:** missing or invalid required configuration prevents Nest boot, emits exactly one redacted structured log with `code: configuration_invalid` that names the invalid configuration keys but never their values, and exits with a nonzero exit code (`process.exit(1)`). Runtime dependency loss remains a `/health` 503 Problem Details (`code: dependency_unavailable`).

---

End of Project 1 design.
