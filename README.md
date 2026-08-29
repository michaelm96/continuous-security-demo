# continuous-security-demo

Project 1: a multi-tenant refunds demo built as plain npm workspaces.

| Workspace | Package | Stack |
|---|---|---|
| `apps/api` | `@continuous-security-demo/api` | NestJS 12 |
| `apps/web` | `@continuous-security-demo/web` | Next.js 16 (App Router) |

## Toolchain

Node `26.8.1` (see `.nvmrc`), npm `12.0.2`.

```sh
nvm use
npm install
```

## Scripts (root)

| Script | What it does |
|---|---|
| `npm run build` | Build every workspace |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm test` | API unit, RLS, and e2e suites |
| `npm run supabase:start` | Start the local Supabase stack |
| `npm run supabase:reset` | Reset the local database |

## Configuration

Copy `.env.example` and fill in local values. Secrets are never committed.
