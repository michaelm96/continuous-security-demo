# continuous-security-demo

A continuously verified, multi-tenant invoice + refund demo that doubles as
a complete security pipeline reference. Project 1 ships the application
itself; Projects 2 and 3 layer deterministic GitHub security workflows on
top.

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
| `npm run security:test` | Run the security policy unit tests |
| `npm run security:actions` | Reject mutable external Action refs |
| `npm run security:licenses` | Evaluate the locked license graph |
| `npm run security:sbom` | Emit a CycloneDX SBOM |
| `npm run security:secrets` | Full-history Gitleaks scan with `--redact=100` |

## Security verification

`docs/security-verification.md` is the runbook for the deterministic
production and fixture scans. Every CI job runs the same pinned local
commands, and the fixture self-test under `security/fixtures/` proves
each scanner still detects the four required identifiers (OSV, Gitleaks,
Checkov, action-ref checker).

## Configuration

Copy `.env.example` and fill in local values. Secrets are never committed.

## License

MIT — see `LICENSE`.
