# Project 3 — Application-Specific Verification Design

**Status:** Approved — 2026-08-29  
**Roadmap source:** `docs/superpowers/specs/2026-03-09-continuous-security-demo-design.md` §12.3  
**Depends on:** Project 2 deterministic security workflows and retained production SARIF

## 1. Goal

Project 3 verifies that the running application behaves like its OpenAPI contract and authorization model. It inventories every live OpenAPI operation, requires an explicit authorization policy for each one, exercises the policy against real Supabase Auth and forced PostgreSQL RLS, fuzzes the live NestJS API with Schemathesis, and reconciles trusted complete-scan SARIF into deduplicated GitHub Issues.

Project 3 does not replace Project 2 scanners or alter application authorization decisions.

## 2. Chosen approach

Use one disposable real-stack verification workflow plus small checked-in test data and Node.js scripts:

- start the real local Supabase stack and reset its deterministic seed;
- start NestJS with OpenAPI enabled;
- fetch `/docs-json` from the running process;
- reconcile its method/path inventory with a typed authorization matrix;
- drive HTTP authorization tests from that matrix using real seeded identities;
- run Schemathesis against the live OpenAPI endpoint;
- retain JUnit, coverage, inventory, and failure artifacts;
- on trusted complete `master` scans only, use `gh` to reconcile production SARIF into GitHub Issues.

No mock Auth server, mock database, custom findings service, or custom property-testing framework is introduced.

## 3. Real-stack lifecycle

The application verification workflow runs on pull requests, pushes to `master`, a weekly schedule, and manual dispatch.

Its setup sequence is:

1. install the exact Node/npm toolchain and run `npm ci --ignore-scripts` for untrusted pull-request code (`npm ci` is permitted only on trusted repository code when lifecycle scripts are required);
2. start Supabase CLI 2.116.0;
3. run the repository reset/seed command;
4. obtain real ES256 bearer tokens for the seeded identities without logging token values;
5. start NestJS with `OPENAPI_ENABLED=true`;
6. wait independently for PostgreSQL, Auth/JWKS, `/health`, and `/docs-json` readiness;
7. run inventory, authorization, and fuzz checks;
8. upload all reports with `if: always()` or equivalent;
9. terminate NestJS and Supabase even after failure.

The workflow uses only local deterministic credentials already documented for the demo. It does not use production secrets or a managed Supabase project. Each run receives a fresh disposable database, so mutation fuzzing cannot damage persistent data.

A readiness timeout, failed reset, failed seed, missing identity, unhealthy dependency, or malformed OpenAPI document fails the job. A startup failure is not reported as a clean test result.

## 4. OpenAPI endpoint inventory

The inventory tool fetches the live `/docs-json` document and normalizes every supported operation into:

```text
UPPERCASE_METHOD + normalized path template
```

It ignores OpenAPI document metadata but not operations. It rejects:

- duplicate method/path operations;
- unsupported or malformed path items;
- operations without a stable OpenAPI operation identifier;
- a live endpoint absent from the authorization matrix;
- a matrix endpoint absent from the live document;
- duplicate matrix entries.

The comparison is exact. Newly added controllers cannot merge until their authorization policy is recorded, and stale policy entries cannot survive endpoint removal.

Generated inventories are workflow artifacts, not committed snapshots. The live controller-generated document remains the source of API shape; the checked-in matrix remains the source of expected authorization behavior.

Before inventory or fuzzing can pass, every operation must declare a stable operation ID, bearer security requirement when guarded, path parameters, request body schema, concrete success/error response schemas, status codes, and content types matching its existing runtime behavior. TypeScript interfaces alone do not count because they are erased at runtime.

Swagger decorators and documentation-only response DTOs may be added or corrected when the live document inaccurately describes existing request/response behavior. Such corrections must not change authentication, authorization, RLS, or domain behavior.

## 5. Authorization matrix

A typed checked-in matrix records one entry per OpenAPI operation. Each entry contains:

```ts
interface EndpointAuthorizationPolicy {
  operationId: string;
  method: string;
  path: string;
  scenario: string;
  cases: readonly AuthorizationCase[];
}

interface AuthorizationCase {
  actor: 'anonymous' | 'alphaUserA' | 'alphaManager' | 'alphaAdmin' | 'alphaSuspended' | 'alphaUserB' | 'betaAdmin';
  resourceTenant: 'alpha' | 'beta' | 'none';
  ownership: 'owner' | 'non_owner' | 'not_applicable';
  expectedStatus: number;
}
```

`scenario` selects a small request builder that supplies seeded IDs and valid minimal bodies. It avoids embedding executable callbacks into policy data while allowing the same matrix to drive real HTTP requests.

The matrix must cover, where applicable:

- anonymous versus authenticated access;
- active versus suspended membership;
- `user`, `manager`, and `organization_admin` roles;
- same-tenant access;
- cross-tenant existence hiding;
- invoice owner versus non-owner behavior;
- known same-tenant insufficient-role behavior;
- public health behavior.

Expected statuses preserve the Project 1 contract, with two explicit exceptions already proven by Project 1:

- `/me` returns `200` for any verified identity. Suspended callers receive `200` with empty `organizations` because `memberships_select_self` is active-only. The matrix asserts the suspended case explicitly.
- `/organizations` returns `200 []` for suspended callers (not `403`) because the Supabase select returns zero rows under RLS. The matrix asserts `status 200` with empty body.

Standard expectations otherwise:

- unauthenticated: `401`;
- known same-tenant insufficient role: `403`;
- cross-tenant, unknown, or hidden ownership: `404`;
- valid operation: endpoint-specific success status;
- domain conflicts such as final-admin protection: `409` only in explicit domain scenarios.

The test driver sends requests through NestJS. It does not call PostgREST directly. Existing Project 1 RLS tests remain the independent database-boundary proof.

Mutation cases must be order-independent. Each membership update, invoice transition, and refund scenario uses a dedicated seeded resource or resets the database immediately before that scenario. A scenario may not consume state or an idempotency key required by a later case.

## 6. Schemathesis fuzzing

Schemathesis reads the live `/docs-json` URL and targets the running NestJS base URL. It uses a real active admin token for authenticated operation coverage, with the `ignored_auth` check ensuring protected operations do not silently accept missing credentials. Seeded organization, member, invoice, and refund examples or hooks provide at least one successful request path for every operation; random UUIDs that exercise only `404` do not satisfy coverage. The disposable API process raises the existing rate-limit thresholds high enough that bounded fuzz traffic is not dominated by `429`, while rate-limit behavior remains covered by its focused Project 1 tests.

Required checks include:

- no unexpected server errors;
- declared status-code conformance;
- content-type conformance;
- response-schema conformance;
- negative-data rejection;
- ignored authentication.

Pull requests use a fixed seed and bounded examples per operation so failures are reproducible and runtime remains predictable. Scheduled runs may choose a random seed, but the exact seed and command must be written to the job summary and retained report.

Schemathesis produces:

- JUnit results;
- schema-coverage output;
- the exact seed and invocation;
- a failure artifact when any generated case fails.

Generated mutation data operates only on the disposable seeded database. The workflow resets the database before authorization scenarios, before Schemathesis, and between mutating scenarios unless they use distinct immutable seed resources.

The authorization matrix, not random fuzz traffic, proves tenant and role access. Schemathesis proves schema-derived input and response robustness. Neither substitutes for the other.

## 7. Production SARIF to GitHub Issues

Project 3 adds a small Node.js reconciler that consumes only production SARIF retained by Project 2 complete scans. It invokes the already available `gh` CLI; it does not add a GitHub SDK.

### 7.1 Stable identity

For each SARIF result, the reconciler builds an identity namespaced by normalized tool name and rule ID. It then chooses:

1. the first non-empty scanner-supplied `partialFingerprints` entry in this exact order: `matchBasedId/v1`, `primaryLocationLineHash`, `primaryLocationStartColumnFingerprint`; undocumented keys are ignored;
2. otherwise, a deterministic SHA-256 hash of tool name, rule ID, normalized repository-relative URI, and the result's stable logical fingerprint fields when available.

Line numbers and mutable message text are excluded from fallback identity. Harmless line movement or message wording changes therefore update one issue rather than creating another, while tool/rule namespacing prevents cross-scanner collisions.

Every managed issue contains a hidden marker:

```html
<!-- security-fingerprint:<fingerprint> -->
```

and the label `security-finding`.

### 7.2 Reconciliation behavior

For each current finding:

- create an issue when no open or closed managed issue has that fingerprint;
- reopen a previously closed managed issue when the finding returns;
- update the existing open issue when severity, location, message, or scan link changes;
- avoid duplicate comments when nothing material changed.

After processing current findings, close an open managed issue only when:

- the event is a trusted full scan of `master` using the default-branch workflow definition;
- every required production scanner completed successfully in that same workflow run;
- a signed-by-context completeness manifest proves every expected SARIF input has the same run ID, `master` ref, head SHA, scanner tool, category, and recorded digest;
- every expected SARIF input parsed successfully and matched its manifest entry;
- the fingerprint is absent from the complete current finding set.

Pull requests, fixture scans, missing artifacts, scanner crashes, and partial runs never close issues.

Issue titles identify the tool, severity, and rule. Bodies include the rule, location, redacted and length-bounded message, fingerprint, scan URL, and a note that Code Scanning/SARIF is authoritative. They must not include secrets or full credential-like snippets. Scanner-controlled text is passed to `gh` only through `spawn`/`execFile` argument arrays and private `--body-file` or stdin—never shell interpolation.

### 7.3 Permissions and concurrency

The issue-reconciliation job has `contents: read` and `issues: write` only, and runs from trusted `master` workflow code after all production scanner jobs succeed. Manual dispatch must also prove `github.ref == 'refs/heads/master'` and default-branch workflow provenance. Pull-request and non-`master` manual workflows never receive `issues: write`.

A workflow concurrency group serializes reconciliation so two complete scans cannot race to open, update, or close the same issue set.

## 8. Data flow

```text
real Supabase + seeded identities
          │
          ├─ NestJS `/docs-json` ─> normalized inventory ─┐
          │                                               ├─ exact reconciliation gate
          └─ authorization matrix ────────────────────────┘
                                   │
                                   └─ real HTTP role/tenant/owner tests

live `/docs-json` + disposable API ─> Schemathesis ─> JUnit + coverage + gate

Project 2 production SARIF ─> normalize/fingerprint ─> `gh issue create/edit/close`
fixture SARIF ───────────────────────────────────────> excluded
```

## 9. Error handling

- Inventory parsing is strict; malformed or unsupported OpenAPI is failure.
- Matrix scenario names are validated before any request runs.
- A missing token or seeded ID fails setup rather than silently skipping cases.
- Every HTTP case records method, path template, actor alias, expected status, and actual status without logging bearer tokens.
- Schemathesis reports upload even when the fuzz gate fails.
- SARIF parsing rejects malformed 2.1.0 inputs; malformed input is not treated as zero findings.
- Issue reconciliation is idempotent and stops before closure when same-run/ref/SHA/tool/category/digest provenance or input completeness is uncertain.
- `gh` runs without a shell, uses argument arrays plus a private body file/stdin, bounds untrusted text, and neutralizes `@mentions`; quotes, newlines, command substitutions, leading options, and mentions are test inputs rather than executable syntax.
- Cleanup runs after success or failure.

## 10. Verification

Focused automated tests must prove:

- OpenAPI normalization produces stable method/path keys;
- every live operation has exactly one matrix entry;
- stale, duplicate, or missing entries fail;
- invalid scenario or actor names fail before network traffic;
- the six authenticated actor aliases obtain real tokens while the anonymous alias remains tokenless;
- authorization cases exercise NestJS and return their exact expected statuses;
- cross-tenant cases preserve `404` existence hiding;
- every operation has at least one seeded successful fuzz path and bounded fuzzing is not dominated by `404` or `429`;
- mutating authorization scenarios are order-independent;
- the Schemathesis command records a reproducible seed;
- SARIF fingerprint fallback is stable across line and message movement, namespaces scanner-supplied values by tool/rule, and deterministically selects preferred fields;
- repeated issue reconciliation creates no duplicates;
- returning findings reopen the existing issue;
- a complete clean master set closes resolved issues;
- partial, malformed, failed, PR, or fixture input never closes issues;
- issue content redacts credential-like data and treats quotes, newlines, substitutions, leading options, and `@mentions` as inert text;
- mixed-run, mixed-SHA, wrong-ref, wrong-tool/category, or digest-mismatched reports cannot close issues;
- non-`master` manual dispatch cannot write Issues.

Existing Project 1 unit, e2e, RLS, build, lint, and architecture checks must remain green. Project 2 security checks must also remain green.

## 11. Planned file surface

Expected additions are limited to:

```text
.github/workflows/application-verification.yml
apps/api/src/common/openapi-schemas.ts
apps/api/test/openapi.e2e-spec.ts
apps/api/test/security/authorization-matrix.ts
apps/api/test/security/authorization-matrix.e2e-spec.ts
security/schemathesis.toml
security/requirements-project3.txt
security/schemathesis-hooks.py
scripts/security/openapi-inventory.mjs
scripts/security/run-schemathesis.sh
scripts/security/seed-token.mjs
scripts/security/sarif-issues.mjs
scripts/security/*.test.mjs
```

Project 2 complete-scan workflows may receive the minimum edits needed to retain production SARIF and invoke trusted reconciliation. Existing Swagger decorators may receive accuracy-only edits proven by tests.

## 12. Explicit exclusions

Project 3 does not add:

- mocked authentication or mocked RLS as substitutes for the real stack;
- ZAP or other staging DAST infrastructure;
- a managed Supabase/staging environment;
- browser E2E;
- authentication, authorization, ownership, or RLS policy changes;
- a custom findings database or dashboard;
- AI-assisted review;
- SARIF-to-Issue writes from pull requests or fixtures.

## 13. Acceptance criteria

Project 3 is complete when:

1. The application verification workflow starts a fresh seeded local Supabase stack and real NestJS API.
2. Every live `/docs-json` operation has exactly one authorization-matrix entry and no stale entry exists.
3. The matrix drives real HTTP cases for role, membership status, tenant, and ownership boundaries.
4. Cross-tenant and hidden-owner cases remain `404`; same-tenant insufficient-role cases remain `403`.
5. Schemathesis runs the approved checks against the live API with reproducible pull-request seeds.
6. JUnit, schema coverage, inventory, seed, and failure evidence are retained.
7. Production SARIF produces at most one GitHub Issue per stable fingerprint.
8. Repeat findings update rather than duplicate issues, returned findings reopen, and resolved findings close only after a complete successful `master` scan.
9. Fixture findings and partial/failed scans can never create false resolution.
10. Pull-request jobs have no issue-write permission.
11. All focused tests, existing Project 1 verification, Project 2 security checks, and GitHub end-to-end runs pass.
