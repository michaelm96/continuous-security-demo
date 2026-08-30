# Project 3 — Application-Specific Verification Implementation Plan

> **For the implementing agent:** Execute only after Project 2 is green on GitHub. Use TDD. Every code/config change must be dispatched through `build_team` per `/Users/michael/.pi/agent/AGENTS.md`. Do not weaken or redesign authentication, authorization, RLS, ownership, audit, or domain rules. If verification exposes a Project 1 defect, stop and fix it as a separate focused remediation rather than changing the expected matrix.

**Goal:** Reconcile every live OpenAPI operation with an explicit authorization policy, exercise that policy against real seeded Supabase Auth and forced PostgreSQL RLS, fuzz the disposable API with Schemathesis, and reconcile complete production SARIF into deduplicated GitHub Issues.

**Architecture:** The running NestJS `/docs-json` is the source of API shape. A checked-in typed matrix is the source of expected role/tenant/ownership behavior. Jest drives real HTTP cases with real GoTrue tokens. A pinned Schemathesis/tracecov toolchain performs schema-derived fuzzing. A dependency-free Node.js reconciler consumes only Project 2's complete production manifest and invokes the already-installed `gh` CLI.

**Toolchain:** Existing Node 26.8.1/npm 12.0.2/NestJS 12.0.1/Jest 30.5.0/Supabase CLI 2.116.0; Python 3.13; Schemathesis 4.25.2; tracecov 0.23.4; `astral-sh/setup-uv` pinned to `20cfd1bf945f4377ade1205e4dbc17946fc9a30d` (v10.0.1).

**Design:** `docs/superpowers/specs/2026-08-29-project-3-application-verification-design.md`

---

## Fixed operation inventory

The current API has exactly these ten operations. Use these stable `operationId` values:

```text
healthCheck                 GET    /health
getMe                       GET    /me
listOrganizations           GET    /organizations
listOrganizationMembers     GET    /organizations/{organizationId}/members
updateOrganizationMember    PATCH  /organizations/{organizationId}/members/{userId}
listInvoices                GET    /organizations/{organizationId}/invoices
createInvoice               POST   /organizations/{organizationId}/invoices
getInvoice                  GET    /organizations/{organizationId}/invoices/{invoiceId}
updateInvoice               PATCH  /organizations/{organizationId}/invoices/{invoiceId}
createRefund                POST   /organizations/{organizationId}/invoices/{invoiceId}/refunds
```

Any additional live operation added during implementation must receive an equally explicit matrix entry; do not silently ignore it.

---

## Task 1: Make the live OpenAPI contract accurate and stable

**Files:**
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/auth/me.controller.ts`
- Modify: `apps/api/src/organizations/organizations.controller.ts`
- Modify: `apps/api/src/invoices/invoices.controller.ts`
- Modify: `apps/api/src/refunds/refunds.controller.ts`
- Modify: `apps/api/src/invoices/dto/create-invoice.dto.ts`
- Modify: `apps/api/src/invoices/dto/patch-invoice.dto.ts`
- Modify: `apps/api/src/organizations/dto/patch-membership.dto.ts`
- Modify: `apps/api/src/refunds/dto/create-refund.dto.ts`
- Create: `apps/api/src/common/openapi-schemas.ts`
- Create: `apps/api/test/openapi.e2e-spec.ts`

Accuracy-only Swagger metadata is permitted. Do not alter service calls, guards, DTO validators, status codes, or response bodies.

### Step 1: Write the failing live-document test

Use the real Nest test bootstrap already used by `apps/api/test/app.e2e-spec.ts`, with `OPENAPI_ENABLED=true`. Fetch `/docs-json` and assert:

```ts
const expected = new Map([
  ['GET /health', 'healthCheck'],
  ['GET /me', 'getMe'],
  ['GET /organizations', 'listOrganizations'],
  ['GET /organizations/{organizationId}/members', 'listOrganizationMembers'],
  ['PATCH /organizations/{organizationId}/members/{userId}', 'updateOrganizationMember'],
  ['GET /organizations/{organizationId}/invoices', 'listInvoices'],
  ['POST /organizations/{organizationId}/invoices', 'createInvoice'],
  ['GET /organizations/{organizationId}/invoices/{invoiceId}', 'getInvoice'],
  ['PATCH /organizations/{organizationId}/invoices/{invoiceId}', 'updateInvoice'],
  ['POST /organizations/{organizationId}/invoices/{invoiceId}/refunds', 'createRefund'],
]);
```

For every operation assert:

- exact stable operation ID;
- public `/health` has no bearer requirement;
- all other operations declare bearer auth;
- path parameters are required UUID strings where applicable;
- request DTO operations expose required fields, numeric bounds, enums/patterns, lengths, and no authority fields;
- success status matches runtime (`200` or `201`);
- Problem Details media type/schema is declared for relevant `400/401/403/404/409/429/503` responses;
- no duplicate operation ID exists.

Run:

```bash
npm -w apps/api run test:e2e -- --runTestsByPath test/openapi.e2e-spec.ts
```

Expected: failure because controllers/DTOs lack explicit Swagger metadata.

### Step 2: Add the minimum explicit metadata

Use the exact operation IDs from the fixed inventory on each `@ApiOperation` and `@ApiBearerAuth()` on guarded controllers. Use `@ApiParam`, `@ApiBody`, `@ApiConsumes`, `@ApiProduces`, and explicit response decorators wherever runtime reflection cannot describe the existing contract accurately. Add seeded UUID/body examples for every parameterized operation so the Schemathesis examples phase has one successful path per operation.

DTO examples:

```ts
@ApiProperty({ minimum: 1, maximum: 9007199254740991, type: Number })
amountMinor!: number;

@ApiProperty({ pattern: '^[A-Z]{3}$', example: 'USD' })
currency!: string;

@ApiProperty({ enum: ['issued', 'paid', 'cancelled'] })
status!: PatchableInvoiceStatus;
```

Keep every existing `class-validator` decorator. Swagger decorators document validation; they do not replace it.

Define concrete Swagger-only schemas in `apps/api/src/common/openapi-schemas.ts` for Problem Details and the existing success response shapes. Every operation must declare concrete success/error schemas, statuses, and content types; erased TypeScript interfaces are not sufficient. Reuse a schema only when at least three controllers need it. Do not create a parallel domain model hierarchy.

### Step 3: Prove metadata did not change behavior

```bash
npm -w apps/api run test:e2e -- --runTestsByPath test/openapi.e2e-spec.ts
npm -w apps/api run test:unit
npm -w apps/api run test:e2e
npm -w apps/api run test:rls
npm -w apps/api run typecheck
npm -w apps/api run lint
```

### Step 4: Commit

```bash
git add apps/api/src apps/api/test/openapi.e2e-spec.ts
git commit -m "docs(api): make OpenAPI contract explicit"
```

---

## Task 2: Reconcile OpenAPI with a typed authorization matrix

**Files:**
- Create: `scripts/security/openapi-inventory.mjs`
- Create: `scripts/security/openapi-inventory.test.mjs`
- Create: `apps/api/test/security/authorization-matrix.ts`
- Create: `apps/api/test/security/authorization-matrix.e2e-spec.ts`
- Modify: `apps/api/test/helpers/seed-identities.ts` only if a missing deterministic resource alias is required
- Modify: `apps/api/package.json`
- Modify: `package.json`

### Step 1: Write failing inventory normalizer tests

Test pure functions:

```js
export function normalizeOpenApi(document) {}
export function reconcileInventory(operations, policies) {}
```

Required behavior:

- normalize methods to uppercase and OpenAPI paths to their literal `{parameter}` templates;
- return stable keys `METHOD /path` with operation ID;
- reject malformed path items, missing operation IDs, unsupported methods, duplicate method/path keys, and duplicate operation IDs;
- reject missing matrix entries, stale matrix entries, and duplicate matrix entries;
- sort output deterministically;
- never ignore an operation because it is undocumented beyond its path item.

Run:

```bash
node --test scripts/security/openapi-inventory.test.mjs
```

Expected: module-not-found failure.

### Step 2: Implement the minimal inventory tool

The CLI accepts:

```text
--schema http://127.0.0.1:3001/docs-json
--output security-reports/openapi-inventory.json
```

It fetches with a timeout, validates `openapi` and `paths`, normalizes operations, and writes JSON atomically. Non-2xx, timeout, malformed JSON, or malformed OpenAPI exits nonzero.

The standalone script generates the artifact. Exact matrix reconciliation occurs in the typed Jest suite, avoiding a TypeScript runtime dependency in the Node script.

### Step 3: Define the checked-in matrix

Use exactly:

```ts
export type Actor =
  | 'anonymous'
  | 'alphaUserA'
  | 'alphaManager'
  | 'alphaAdmin'
  | 'alphaSuspended'
  | 'alphaUserB'
  | 'betaAdmin';

export interface AuthorizationCase {
  actor: Actor;
  resourceTenant: 'alpha' | 'beta' | 'none';
  ownership: 'owner' | 'non_owner' | 'not_applicable';
  expectedStatus: number;
}

export interface EndpointAuthorizationPolicy {
  operationId: string;
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  scenario: string;
  cases: readonly AuthorizationCase[];
}

export const AUTHORIZATION_MATRIX: readonly EndpointAuthorizationPolicy[] = [];
```

Add one policy per fixed operation. Cases must include where applicable:

- anonymous `401`;
- active same-tenant success;
- suspended same-tenant `403`;
- cross-tenant `404`;
- ordinary-user owner success for invoice reads;
- ordinary-user non-owner `404` for invoice reads;
- ordinary-user insufficient role `403` for invoice creation/update and refund;
- manager/admin success for privileged operations;
- public health `200`.

Do not infer a new policy from current accidental behavior. The approved Project 1 contract remains authoritative.

### Step 4: Write the failing real-stack matrix driver

Use:

- `apps/api/test/helpers/auth.ts::signIn`;
- `SEED_IDENTITIES` and `SEED_IDS`;
- real Nest bootstrap via `applyEdge`;
- real local GoTrue, PostgREST, PostgreSQL, and forced RLS.

Build a fixed `Record<string, ScenarioBuilder>` rather than storing callbacks in the policy data. Each builder supplies deterministic path params and minimal valid bodies. Validate all scenario names before making any request.

The suite must:

1. fetch the live `/docs-json`;
2. reconcile exact operations/operation IDs against the matrix;
3. obtain tokens for the five authenticated aliases without logging them;
4. run every case through NestJS with `supertest`;
5. report method, path template, actor alias, expected status, and actual status on failure;
6. check Problem Details `status`, `code`, and `requestId` for failures;
7. assert `/me` returns only the verified caller's active memberships, not same-organization membership rows;
8. use unique request IDs/idempotency keys for mutating success cases;
9. reset the database immediately before each membership update, invoice transition, or refund scenario unless that scenario has its own dedicated seeded resource;
10. prove the same matrix passes in a deliberately shuffled scenario order, so mutations cannot invalidate later cases.

Run the fresh stack first:

```bash
npm run supabase:start
npm run supabase:reset
npm -w apps/api run test:e2e -- --runTestsByPath test/security/authorization-matrix.e2e-spec.ts
```

Expected initial failure: missing matrix/driver. If the new `/me` self-only assertion fails on existing code, do not relax it. File a separate focused Project 1 remediation for `MeService.getMe(principal: Principal): Promise<MeResponse>` to scope its membership query by `principal.userId`, then re-run all Project 1 checks before resuming.

### Step 5: Add scripts and verify

Add:

```json
{
  "security:inventory": "node scripts/security/openapi-inventory.mjs --schema http://127.0.0.1:3001/docs-json --output security-reports/openapi-inventory.json",
  "security:authorization": "npm -w apps/api run test:e2e -- --runTestsByPath test/security/authorization-matrix.e2e-spec.ts"
}
```

Then run:

```bash
node --test scripts/security/openapi-inventory.test.mjs
npm run security:authorization
npm -w apps/api run test:unit
npm -w apps/api run test:rls
npm -w apps/api run typecheck
npm -w apps/api run lint
git diff --check
```

### Step 6: Commit

```bash
git add scripts/security/openapi-inventory.* apps/api/test/security apps/api/test/helpers/seed-identities.ts apps/api/package.json package.json
git commit -m "test: verify live endpoint authorization matrix"
```

---

## Task 3: Add reproducible Schemathesis fuzzing and real-stack workflow

**Files:**
- Create: `security/schemathesis.toml`
- Create: `security/requirements-project3.txt`
- Create: `security/schemathesis-hooks.py`
- Create: `scripts/security/run-schemathesis.sh`
- Create: `scripts/security/run-schemathesis.test.mjs`
- Create: `scripts/security/seed-token.mjs`
- Create: `scripts/security/seed-token.test.mjs`
- Create: `.github/workflows/application-verification.yml`
- Modify: `.gitignore`
- Modify: `package.json`

Do not use `schemathesis/action@v3.0.0`: although its outer ref can be pinned, its composite currently invokes mutable nested action tags. Use immutable `setup-uv` plus exact Python package versions instead.

### Step 1: Test the Schemathesis runner contract

The Node test reads the shell script/config and asserts exact invariants:

```text
requirements file contains exactly: schemathesis==4.25.2 and tracecov==0.23.4
checks: not_a_server_error,status_code_conformance,content_type_conformance,response_schema_conformance,negative_data_rejection,ignored_auth
--generation-deterministic
--seed is required
--max-examples is required
--phases examples,fuzzing is required
--report junit
JUnit path: security-reports/schemathesis-junit.xml
HTML coverage path: security-reports/schema-coverage.html
Markdown coverage path: security-reports/schema-coverage.md
Authorization value is never echoed
```

Also prove the runner rejects an empty/non-numeric seed, empty token, absent schema URL, or unwritable report directory before invoking Schemathesis.

Expected: file-not-found failure.

### Step 2: Implement the token helper

`seed-token.mjs` signs in through real Supabase Auth using environment-provided local URL/anon key and one actor alias. Reuse the seeded email/password mapping exactly, but print only the access token to stdout for command substitution. Errors go to stderr without credentials or tokens.

The unit test injects `fetch` and proves:

- the expected Auth endpoint and JSON body are used;
- a returned access token is emitted;
- missing session or non-2xx fails;
- diagnostic text never contains password/token.

The workflow writes the token to a masked environment value using `::add-mask::` before any later command.

### Step 3: Create schemathesis.toml config

`security/schemathesis.toml` is an empty config file (all options are passed via CLI in the runner). This satisfies the Files surface while keeping all configuration in version-controlled CLI flags:

```bash
mkdir -p security
printf '# Schemathesis configuration — all options passed via CLI flags\n' > security/schemathesis.toml
```

### Step 5: Implement tracecov hook and runner

`security/schemathesis-hooks.py` contains only:

```py
import tracecov.schemathesis
tracecov.schemathesis.install()
```

The runner sets:

```bash
export SCHEMATHESIS_HOOKS="$PWD/security/schemathesis-hooks.py"
export SCHEMATHESIS_COVERAGE_FORMAT="html,markdown"
export SCHEMATHESIS_COVERAGE_REPORT_HTML_PATH="$PWD/security-reports/schema-coverage.html"
export SCHEMATHESIS_COVERAGE_REPORT_MARKDOWN_PATH="$PWD/security-reports/schema-coverage.md"
```

Then executes:

```bash
schemathesis run "$SCHEMA_URL" \
  --url "$API_URL" \
  --generation-database=:memory: \
  --generation-deterministic \
  --seed "$SEED" \
  --max-examples "$MAX_EXAMPLES" \
  --phases examples,fuzzing \
  --checks not_a_server_error,status_code_conformance,content_type_conformance,response_schema_conformance,negative_data_rejection,ignored_auth \
  --header "Authorization: Bearer $AUTH_TOKEN" \
  --report junit \
  --report-junit-path security-reports/schemathesis-junit.xml
```

Print the seed and a redacted command before execution. Never use `eval`.

### Step 4: Create the application-verification workflow

Triggers:

```yaml
on:
  pull_request:
  push:
    branches: [master]
  schedule:
    - cron: '43 4 * * 1'
  workflow_dispatch:
    inputs:
      seed:
        description: Schemathesis seed
        required: false
```

Permissions: `contents: read` only. Concurrency cancels superseded runs on the same ref.

Use exact immutable actions:

```text
actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
astral-sh/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d
actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
```

Job sequence:

1. `npm ci --ignore-scripts` under Node 26.8.1/npm 12.0.2 for pull requests (trusted `master` may use `npm ci` only if a required lifecycle script is documented);
2. create `.venv-security` with uv, install exactly `security/requirements-project3.txt` into it, and prepend `.venv-security/bin` to `PATH`; the file contains only `schemathesis==4.25.2` and `tracecov==0.23.4`;
3. `npm run supabase:start`;
4. `npm run supabase:reset`;
5. independently wait with bounded timeouts for DB, GoTrue/JWKS, and seeded sign-in;
6. build/start NestJS with `OPENAPI_ENABLED=true`, `RATE_LIMIT_AUTH_PER_MIN=10000`, and `RATE_LIMIT_ANON_PER_MIN=10000` on port 3001, logging to `security-reports/api.log`; the existing focused rate-limit tests remain unchanged;
7. independently wait for `/health` and `/docs-json`;
8. run `npm run security:inventory`;
9. run the exact authorization-matrix suite;
10. reset the disposable database so authorization mutations cannot affect fuzzing;
11. obtain/mask a fresh `alphaAdmin` token;
12. choose fixed seed `20260829` for PR/push, manual input when supplied, and a generated numeric seed for schedule; write it to the job summary and `security-reports/schemathesis-seed.txt`;
13. run `run-schemathesis.sh` with the examples phase plus PR max examples `25` and scheduled max examples `100`; assert its coverage report records at least one 2xx example for every operation and that generated traffic is not dominated by `404` or `429`;
14. upload all reports with `if: always()`;
15. on `always()`, stop NestJS and Supabase.

A setup/readiness/reset failure must fail the job, not produce a false clean result. Preserve API logs on failure, but sanitize with the existing redaction rules and never upload environment dumps.

### Step 6: Validate locally

```bash
node --test scripts/security/run-schemathesis.test.mjs scripts/security/seed-token.test.mjs
npm run supabase:start
npm run supabase:reset
OPENAPI_ENABLED=true API_PORT=3001 npm -w apps/api run start >security-reports/api.log 2>&1 &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true; npm run supabase:stop' EXIT
npm run security:inventory
npm run security:authorization
uv venv .venv-security
uv pip install --python .venv-security/bin/python -r security/requirements-project3.txt
PATH="$PWD/.venv-security/bin:$PATH" AUTH_TOKEN="$(node scripts/security/seed-token.mjs alphaAdmin)" \
  SEED=20260829 MAX_EXAMPLES=10 \
  bash scripts/security/run-schemathesis.sh

test -s security-reports/schemathesis-junit.xml
test -s security-reports/schema-coverage.html
test -s security-reports/schema-coverage.md
```

### Step 6: Commit

```bash
git add security/schemathesis* security/requirements-project3.txt scripts/security/run-schemathesis* scripts/security/seed-token* .github/workflows/application-verification.yml .gitignore package.json
git commit -m "test: fuzz the real API from its OpenAPI contract"
```

---

## Task 4: Build the idempotent SARIF-to-Issues reconciler

**Files:**
- Create: `scripts/security/sarif-issues.mjs`
- Create: `scripts/security/sarif-issues.test.mjs`
- Create: `scripts/security/fixtures/issues/*.json`
- Modify: `package.json`

Use only Node.js standard library plus the existing `gh` executable.

### Step 1: Write failing fingerprint tests

Export:

```js
export function fingerprintResult(tool, result) {}
export function normalizeFinding(tool, result, runUrl) {}
export function redactIssueText(text) {}
export function planReconciliation(findings, managedIssues, context) {}
```

Prove fingerprint construction:

1. namespace every identity by normalized tool name and rule ID;
2. select the first nonempty `partialFingerprints` entry in this exact key order: `matchBasedId/v1`, `primaryLocationLineHash`, `primaryLocationStartColumnFingerprint`; ignore undocumented keys;
3. otherwise SHA-256 the tool name, rule ID, normalized repository-relative URI, and stable logical fingerprint fields when present.

Line numbers and mutable message text must not affect fallback identity. Changing only line or message updates the same issue. Reject absolute/out-of-repository paths and prove identical scanner values under different tool/rule namespaces do not collide.

### Step 2: Write failing reconciliation tests

Cover:

- new fingerprint → one create;
- same open fingerprint with no material change → no operation/comment;
- same open fingerprint with changed severity/location/message/run link → one update;
- same closed fingerprint → reopen and update the existing issue;
- absent fingerprint on complete successful trusted `master` scan with same-run/ref/SHA/tool/category/digest provenance → close;
- PR, fixture, partial, missing, malformed, failed, non-`master`, mixed-run, mixed-SHA, wrong-tool/category, or digest-mismatched input → never close;
- two managed issues with one fingerprint → fail closed rather than guessing;
- unmanaged issues are untouched;
- issue title identifies tool/severity/rule;
- body includes hidden `<!-- security-fingerprint:<fingerprint> -->`, location, message, run URL, and authority note;
- credentials, bearer tokens, JWTs, PATs, and password-like values are redacted;
- quotes, newlines, `$()`/backticks, leading `--` text, and `@mentions` remain inert, bounded text and never alter the `gh` argument vector.

### Step 3: Implement parsing and pure planning

The CLI accepts:

```text
--manifest security-reports/production-manifest.json
--sarif security-reports/osv.sarif
--sarif security-reports/gitleaks.sarif
--sarif security-reports/checkov.sarif
--repository michaelm96/continuous-security-demo
--run-url https://github.com/michaelm96/continuous-security-demo/actions/runs/$GITHUB_RUN_ID
```

Before GitHub access it must:

- validate SARIF 2.1.0;
- verify every file digest and declared scanner tool/category against the complete Project 2 manifest;
- require `complete: true`, default-branch workflow provenance, `master`, and one shared run ID/ref/head SHA across every required successful production scanner before allowing closure;
- reject fixture-marked input;
- normalize/deduplicate current findings by fingerprint.

### Step 4: Add a thin `gh` adapter

Run commands with `spawnSync`/`execFileSync`, never a shell string. Construct argument arrays shaped exactly like:

```js
['issue', 'list', '--repo', repository, '--label', 'security-finding', '--state', 'all', '--limit', '1000', '--json', 'number,title,body,state,labels']
['issue', 'create', '--repo', repository, '--label', 'security-finding', '--title', title, '--body-file', bodyFile]
['issue', 'edit', String(number), '--repo', repository, '--title', title, '--body-file', bodyFile]
['issue', 'reopen', String(number), '--repo', repository]
['issue', 'close', String(number), '--repo', repository, '--comment', redactedComment]
```

Write bodies to private temporary files (`0600`) and delete them in `finally`. Never pass body text or tokens on the command line. Bound title/body lengths, neutralize `@mentions`, and treat scanner filenames/messages as data. Tests inject a fake executable and assert the exact argument arrays for quotes, newlines, `$()`/backticks, leading options, and mentions. Paginate/fail when the managed issue set exceeds the requested limit rather than silently ignoring issues.

Add `--dry-run`, which prints only fingerprint and planned operation, not finding snippets.

### Step 5: Verify and commit

```bash
node --test scripts/security/sarif-issues.test.mjs
npm run security:test
node scripts/security/sarif-issues.mjs \
  --manifest scripts/security/fixtures/issues/complete-manifest.json \
  --sarif scripts/security/fixtures/issues/findings.sarif \
  --repository michaelm96/continuous-security-demo \
  --run-url https://github.com/michaelm96/continuous-security-demo/actions/runs/1 \
  --dry-run
git diff --check
git add scripts/security/sarif-issues.* scripts/security/fixtures/issues package.json
git commit -m "feat: reconcile production SARIF into GitHub Issues"
```

---

## Task 5: Integrate trusted issue reconciliation and complete acceptance

**Files:**
- Modify: `.github/workflows/security-main.yml`
- Modify: `.github/workflows/application-verification.yml` only if end-to-end evidence exposes a workflow defect
- Modify: `README.md`
- Modify: `docs/security-verification.md`

### Step 1: Add the trusted issue job

In `security-main.yml`, add a final `issues` job with:

```yaml
needs: [manifest]
if: github.ref == 'refs/heads/master' && github.event.repository.default_branch == 'master' && needs.manifest.result == 'success'
permissions:
  contents: read
  issues: write
concurrency:
  group: security-issue-reconciliation
  cancel-in-progress: false
```

The job:

1. checks out the exact scanned commit;
2. downloads only `production-security-evidence` from the same run and verifies its run ID, ref, head SHA, tool, category, and digest manifest fields before any closure;
3. runs all Project 2/3 policy unit tests;
4. invokes `sarif-issues.mjs` with the complete manifest and expected production SARIF paths;
5. writes a redacted reconciliation summary artifact.

No pull-request or fixture workflow receives `issues: write`. No issue job runs when any required production scanner or manifest job failed/skipped.

### Step 2: Add workflow-structure tests

Extend the immutable-action/policy tests to assert:

- only trusted `security-main.yml` contains `issues: write`;
- it is job-scoped;
- the job requires successful manifest completion, `refs/heads/master`, and default-branch workflow provenance;
- issue reconciliation concurrency does not cancel in progress;
- fixture and PR workflow artifact names cannot match `production-security-evidence`;
- application verification has cleanup and `if: always()` artifact upload;
- no `pull_request_target` exists.

Run:

```bash
npm run security:test
npm run security:actions
```

### Step 3: Run full local verification

```bash
npm ci --ignore-scripts
npm run supabase:start
npm run supabase:reset
npm run typecheck
npm test
npm run build
npm run security:test
npm run security:actions
npm run security:licenses
npm run security:sbom
npm run security:secrets
npm run security:authorization
# Start live API, then:
npm run security:inventory
SEED=20260829 MAX_EXAMPLES=25 AUTH_TOKEN="$(node scripts/security/seed-token.mjs alphaAdmin)" \
  bash scripts/security/run-schemathesis.sh
npm run supabase:stop
git diff --check
```

Required evidence:

- Project 1 unit/e2e/RLS/build/lint/architecture checks remain green;
- Project 2 production and fixture checks remain green;
- exact ten-operation inventory reconciles with exact ten matrix entries;
- every matrix case returns its specified status;
- `/me` contains only the caller's memberships;
- JUnit and both schema-coverage reports are nonempty;
- fixed-seed Schemathesis rerun reproduces any failure;
- dry-run issue reconciliation is stable and duplicate-free;
- no token/credential appears in logs or artifacts.

### Step 4: Update the runbook

Document:

- fresh-stack local application-verification command order;
- fixed versus scheduled Schemathesis seeds;
- matrix maintenance rule for new/removed operations;
- report/artifact names;
- stable issue fingerprint and reopen/close semantics;
- complete-scan prerequisite for closure;
- how to run `sarif-issues.mjs --dry-run` safely;
- why Code Scanning/SARIF remains authoritative.

### Step 5: Commit integration/docs

```bash
git add .github/workflows/security-main.yml .github/workflows/application-verification.yml README.md docs/security-verification.md scripts/security
git commit -m "feat: gate application behavior and reconcile findings"
```

### Step 6: Verify on GitHub

Push only from a clean, fully green tree:

```bash
git push origin master
gh run list --branch master --limit 20
gh workflow run application-verification.yml --ref master
gh run watch --exit-status
gh issue list --label security-finding --state all --limit 100
```

Confirm:

1. real Supabase and NestJS start and clean up;
2. inventory/matrix/Schemathesis jobs succeed;
3. JUnit, HTML/Markdown coverage, inventory, seed, and logs are retained;
4. production SARIF creates at most one managed issue per fingerprint;
5. rerunning unchanged SARIF creates no duplicates or duplicate comments;
6. a controlled test finding reopens the same issue after recurrence;
7. only a later complete clean `master` scan closes it;
8. fixture and failed/partial runs never create false resolution;
9. PR runs have no issue-write permission.

Do not introduce a real vulnerability merely to test issue lifecycle. Use a temporary SARIF-only controlled rule in a short-lived branch or the reconciler's test fixtures with dry-run for local proof, then verify live lifecycle with an intentionally safe scanner policy finding if one exists.

### Step 7: Final review

Review the complete Project 3 diff against every acceptance criterion in the approved design. Re-run all local verification after any fix. Record final GitHub run URLs in `docs/security-verification.md` without credentials.
