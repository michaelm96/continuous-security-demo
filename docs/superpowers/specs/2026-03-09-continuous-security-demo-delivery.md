---
status: Approved — 2026-08-29
parent: 2026-03-09-continuous-security-demo-design.md
---

# Project 1 Delivery Playbook

This document is the operator manual for the locally runnable
multi-tenant invoice + refund demo. It assumes a fresh checkout of the
repository at `/Users/michael/Documents/vscode/continuous-security-demo`
on Node 26.8.1 (see `.nvmrc`) and a working Docker daemon.

## 1. Prerequisites

- Node 26.8.1 (`nvm use`).
- Docker running.
- Ports `54321`, `54322`, `54320`, `54323`, `54324`, `3000`, `3001`
  available on `127.0.0.1`.
- Exact Supabase CLI `2.116.0` is invoked through the workspace
  scripts (`npm run -w . supabase -- …` works without global install
  via `npx --yes supabase@2.116.0`).

## 2. First-time install

From the repo root:

```sh
# Pin Node/npm and install workspace deps.
nvm use
npm ci

# Generate the local ES256 signing key (ignored). Safe to re-run.
npm run supabase:prepare
```

## 3. Start the Supabase stack

```sh
# Boots the Supabase container, applies migrations, runs supabase/seed.sql.
npm run supabase:start
```

The first start prints the local `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`,
and a generated `JWT_SECRET` for the test harness. These are surfaced
through `npx --yes supabase@2.116.0 status -o env` and are wired into
the API workspace through `.env.local` on first run.

To stop without losing data: `npm run supabase:stop`.
To destroy and recreate (idempotent):

```sh
npm run supabase:reset
```

`reset` re-runs every migration and `supabase/seed.sql`. The
deterministic GoTrue identities survive every reset because their UUIDs
are fixed.

## 4. Run the API and the Web app

```sh
# API on http://127.0.0.1:3001
npm run -w @continuous-security-demo/api dev

# Web on http://127.0.0.1:3000
npm run -w @continuous-security-demo/web dev
```

The web app reads `API_URL` from `apps/web/.env.local` (or the shell
env). Use `http://127.0.0.1:3001` for local development.

## 5. Seeded identities (deterministic)

| Email                                 | Password              | Org  | Role               | Status    |
|---------------------------------------|-----------------------|------|--------------------|-----------|
| `admin.alpha@example.test`            | `LocalOnly-Admin1!`   | alpha | organization_admin | active    |
| `manager.alpha@example.test`          | `LocalOnly-Manager1!` | alpha | manager            | active    |
| `user-a.alpha@example.test`           | `LocalOnly-UserA1!`   | alpha | user               | active    |
| `user-b.alpha@example.test`           | `LocalOnly-UserB1!`   | alpha | user               | active    |
| `suspended.alpha@example.test`        | `LocalOnly-Suspended1!` | alpha | user              | suspended |
| `admin.beta@example.test`             | `LocalOnly-Admin2!`   | beta  | organization_admin | active    |

Both orgs are seeded with three invoices each. Two refunds already exist
in `alpha`.

## 6. OpenAPI

With `OPENAPI_ENABLED=true` (the default in local development and tests):

- Swagger UI: `http://127.0.0.1:3001/docs`
- OpenAPI JSON: `http://127.0.0.1:3001/docs-json`

Set `OPENAPI_ENABLED=false` in production — the routes are not mounted.

## 7. Tests

```sh
# Domain unit tests
npm run test:unit -w @continuous-security-demo/api

# Nest HTTP end-to-end tests (supertest + real Supabase tokens)
npm run test:e2e -w @continuous-security-demo/api

# RLS integration tests (real local Postgres + caller-token visibility)
npm run test:rls -w @continuous-security-demo/api

# Web typecheck and build
npm run typecheck -w @continuous-security-demo/web
npm run build -w @continuous-security-demo/web
```

A one-shot harness:

```sh
export $(npx --yes supabase@2.116.0 status -o env | xargs)
export SUPABASE_JWT_ISSUER="http://127.0.0.1:54321/auth/v1"
npm test
```

`npm test` at the repo root runs all three API test layers, the web
typecheck, and the API/web builds. Project 1 has no browser end-to-end
tests — the role-aware UI is verified manually with the seeded identities.

## 8. Production build

```sh
npm run build -w @continuous-security-demo/api
npm run build -w @continuous-security-demo/web
```

Both must complete with exit code 0. The web build emits a static
artifact; the API build emits a tree-loadable Node program.

## 9. Manual role UI verification

For each seeded identity in turn, sign in at
`http://127.0.0.1:3000/login` and confirm:

- `admin.alpha` sees **Invoices** and **Members** links for `alpha`,
  no nav for `beta` (different tenant).
- `manager.alpha` sees **Invoices** only for `alpha`.
- `user-a.alpha` sees neither Invoices nor Members (cannot manage).
  They still see the dashboard with a single alpha membership and
  can read invoices they own.
- `suspended.alpha` can sign in but `/organizations/…` routes
  redirect to `/dashboard` because their only membership is
  `status: 'suspended'`.
- `admin.beta` sees the beta org's Invoices and Members links but
  nothing of alpha's.

Confirm `GET /docs` and `GET /docs-json` return the OpenAPI document.

## 10. Reset and clean-state checks

```sh
npm run supabase:reset    # re-applies all migrations + seed
npm test                  # typecheck + build + unit + e2e + RLS
```

Two consecutive `supabase:reset` runs must both succeed — the
`public_refund_definer` role and `public.create_refund` function are
created on every reset and the migration is idempotent against an
already-present cluster role.

## 11. What's intentionally not in Project 1

Project 1 deliberately does not include CI, vulnerability fixtures,
scanners, fuzzing, DAST, Playwright, staging, AI-assisted review,
SARIF, or a findings platform. Those arrive in Projects 2–6 per the
parent design document §12.
