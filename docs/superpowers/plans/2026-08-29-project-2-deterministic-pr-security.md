# Project 2 — Deterministic Pull-Request Security Implementation Plan

> **For the implementing agent:** Execute task by task with TDD. Every code/config change must be dispatched through `build_team` per `/Users/michael/.pi/agent/AGENTS.md`. Documentation-only corrections may be made directly. Do not change application authentication, authorization, RLS, or domain behavior.

**Goal:** Add deterministic, least-privilege GitHub security workflows for production dependencies, licenses, secrets, IaC/workflows, SBOMs, SARIF, and isolated vulnerable-fixture self-tests.

**Architecture:** Keep scanner output in each scanner's native SARIF/JSON, then use small dependency-free Node.js policy scripts for the repository-specific decisions GitHub Actions cannot express directly. Pull requests remain untrusted and read-only. Trusted `master` and scheduled runs retain production SARIF for Project 3. Fixtures run separately and can pass only by detecting their required advisories.

**Toolchain:** Node 26.8.1, npm 12.0.2, Node `node:test`, GitHub Actions pinned to immutable 40-character SHAs, OSV-Scanner 2.5.1, Gitleaks 8.30.1, Checkov 3.3.16, `@cyclonedx/cyclonedx-npm` 6.0.1.

**Design:** `docs/superpowers/specs/2026-08-29-project-2-deterministic-pr-security-design.md`

---

## Immutable tool references

Use these exact references in workflow files:

```text
actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0
actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294 # v5.0.0
github/codeql-action/upload-sarif@cdf488f595d80d6e07e03d4674febd5ab45fa938 # v4.37.9
google/osv-scanner-action reusable workflow@6e4298ebc4db23e847df9b2e2de2939d6f066c67 # v2.5.1
```

Gitleaks Linux x64 archive:

```text
version: 8.30.1
sha256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
```

---

## Task 1: Establish MIT metadata and pinned local tooling

**Files:**
- Create: `LICENSE`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`
- Modify: `.gitignore`
- Create: `security/requirements-project2.txt`

### Step 1: Record the failing metadata check

Run:

```bash
node - <<'NODE'
const fs = require('node:fs');
const root = require('./package.json');
const api = require('./apps/api/package.json');
const web = require('./apps/web/package.json');
if (!fs.existsSync('LICENSE')) throw new Error('LICENSE missing');
for (const [name, pkg] of Object.entries({ root, api, web })) {
  if (pkg.license !== 'MIT') throw new Error(`${name} license is not MIT`);
}
NODE
```

Expected: failure because `LICENSE` is absent and package metadata is not MIT.

### Step 2: Add only the required metadata and dependency

- Add the standard MIT license text with copyright `2026 Michael M`.
- Set `license: "MIT"` in the root and both workspaces.
- Add exact root dev dependency `@cyclonedx/cyclonedx-npm: "6.0.1"`.
- Add `security/requirements-project2.txt` containing exactly `checkov==3.3.16`; workflows install from that checked file rather than a floating package name.
- Add root scripts:

```json
{
  "security:test": "node --test scripts/security/*.test.mjs",
  "security:actions": "node scripts/security/check-action-pins.mjs .github/workflows",
  "security:sarif": "node scripts/security/sarif-policy.mjs --threshold 7",
  "security:licenses": "node scripts/security/license-policy.mjs",
  "security:sbom": "cyclonedx-npm --output-file security-reports/sbom.cdx.json --output-format JSON --spec-version 1.6 --omit dev"
}
```

- Ignore generated `security-reports/`, but do not ignore checked-in fixtures or policies.
- Run the repository's pinned npm 12.0.2 when updating the lockfile.

### Step 3: Verify

```bash
npm ci
npm run typecheck
npm run build
node -e "const p=require('./package-lock.json'); if(p.packages['node_modules/@cyclonedx/cyclonedx-npm'].version!=='6.0.1') process.exit(1)"
git diff --check
```

### Step 4: Commit

```bash
git add LICENSE package.json package-lock.json apps/api/package.json apps/web/package.json .gitignore security/requirements-project2.txt
git commit -m "chore: establish MIT security tooling baseline"
```

---

## Task 2: Build and test the repository policy scripts

**Files:**
- Create: `scripts/security/sarif-policy.mjs`
- Create: `scripts/security/sarif-policy.test.mjs`
- Create: `scripts/security/license-policy.mjs`
- Create: `scripts/security/license-policy.test.mjs`
- Create: `scripts/security/check-action-pins.mjs`
- Create: `scripts/security/check-action-pins.test.mjs`
- Create: `scripts/security/fixtures/*.json`

All scripts must use only Node.js standard-library modules. No YAML, SARIF, SPDX, or GitHub SDK dependency is needed.

### Step 1: Write failing SARIF policy tests

Cover:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSarif } from './sarif-policy.mjs';

test('blocks a security-severity of 7.0 or higher', () => {
  assert.equal(evaluateSarif([sarifResult('7.0')], 7).blocked.length, 1);
});

test('reports but does not block severity below 7.0', () => {
  assert.equal(evaluateSarif([sarifResult('6.9')], 7).blocked.length, 0);
});

test('rejects malformed or missing SARIF instead of treating it as clean', () => {
  assert.throws(() => evaluateSarif([{ version: '2.0.0' }], 7));
});
```

Also cover severity on `result.properties`, severity on the referenced rule, multiple runs, deduplication, and missing files. Add explicit fixtures proving: high blocks; moderate reports; unknown production blocks; unknown development reports; Checkov missing severity blocks; malformed/missing severity context fails closed.

Run:

```bash
node --test scripts/security/sarif-policy.test.mjs
```

Expected: module-not-found failure.

### Step 2: Implement the minimum SARIF gate

Export:

```js
export function readSarif(path) {}
export function normalizeSarif(log) {}
export function evaluateSarif(results, threshold = 7) {}
```

Rules:

- require SARIF `version === "2.1.0"` and an array of runs;
- read numeric security severity from scanner/result/rule properties using the explicit keys emitted by OSV and Checkov;
- block `>= 7.0`, report `< 7.0`;
- accept an explicit production/development dependency classification map for OSV unknown-severity results; block unknown production and report unknown development;
- block Checkov results without a trustworthy severity instead of silently treating them as low;
- preserve tool, rule ID, level, location, redacted message, and scanner fingerprint;
- malformed input or a missing expected report exits nonzero;
- never print secret snippets.

The CLI accepts one or more paths after `--input`, writes a compact JSON summary when `--output` is supplied, and exits `1` only for blocking findings or malformed/incomplete input.

### Step 3: Write failing license-policy tests

Use representative npm-query package records. Prove:

- `MIT`, `Apache-2.0`, BSD, ISC, and `(MIT OR Apache-2.0)` pass;
- `AGPL-*`, `SSPL-*`, `BUSL-*`, Elastic License, Commons Clause, PolyForm, CC-BY-NC, and strings containing `Non-Commercial` block in production;
- absent/empty production license blocks;
- the same absent or unknown metadata in dev-only input reports but does not block;
- packages marked private and belonging to this repository are MIT after Task 1.

Expected initial run: module-not-found failure.

### Step 4: Implement exact license policy

Export:

```js
export function classifyLicense(value) {}
export function evaluatePackages(packages, scope) {}
```

The CLI accepts:

```text
--production security-reports/npm-production.json
--development security-reports/npm-development.json
--output security-reports/license-policy.json
```

Use normalized SPDX-like tokens and explicit deny patterns. Do not attempt a general SPDX parser. Unknown production metadata fails closed; unknown development metadata is a warning.

### Step 5: Write failing immutable-action tests

Prove:

- external `owner/repo@` refs require exactly 40 lowercase or uppercase hex characters;
- tags, branches, short SHAs, expressions, and missing refs fail;
- `./local-action` passes;
- `docker://image@sha256:<64 hex>` passes, while mutable container tags fail;
- comments and quoted `uses:` values parse correctly;
- the diagnostic contains file and line.

### Step 6: Implement the minimal line-oriented checker

Export:

```js
export function inspectWorkflow(source, file) {}
export function inspectWorkflowFiles(paths) {}
```

A line-oriented `uses:` matcher is sufficient because only immutable reference syntax is being checked. Recursively inspect `.yml` and `.yaml` under the supplied paths, including checked-in reusable workflows and local action metadata.

### Step 7: Verify and commit

```bash
npm run security:test
node scripts/security/check-action-pins.mjs scripts/security/fixtures/workflows/pass
node scripts/security/check-action-pins.mjs scripts/security/fixtures/workflows/fail && exit 1 || true
git diff --check
git add scripts/security package.json
git commit -m "feat: add deterministic security policy gates"
```

---

## Task 3: Configure full-history secret scanning

**Files:**
- Create: `.gitleaks.toml`
- Create: `security/gitleaks-fixture.toml`
- Create: `scripts/security/install-gitleaks.sh`
- Create: `scripts/security/install-gitleaks.test.mjs`
- Modify: `package.json`

### Step 1: Test the installer contract before implementation

The test reads the shell script and asserts:

- version is exactly `8.30.1`;
- Linux x64 archive SHA-256 is exactly `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`;
- checksum verification occurs before extraction/install;
- `curl` uses `--fail --show-error --location`;
- no `curl | sh` or mutable `latest` URL exists.

Expected: file-not-found failure.

### Step 2: Implement the checksum-verified installer

The script must:

1. create a temporary directory and clean it with `trap`;
2. download `gitleaks_8.30.1_linux_x64.tar.gz` from the exact GitHub release URL;
3. verify the exact SHA-256 with `sha256sum -c`;
4. extract only the `gitleaks` binary;
5. install it to a caller-supplied directory, defaulting to `$HOME/.local/bin`;
6. print `gitleaks version` without printing environment values.

### Step 3: Add exact production and fixture configs

Both configs extend Gitleaks defaults.

Production `.gitleaks.toml` must:

- exclude `security/fixtures/` only;
- allow the six documented `LocalOnly-*` demo passwords only when both exact value and expected seed/test/docs path match (`condition = "AND"`);
- allow only the known local Supabase anon/service-role example JWTs at their exact config/test/docs paths;
- contain no broad password, JWT, `SUPABASE_*`, or repository-wide allowlist.

`security/gitleaks-fixture.toml` must extend defaults without inheriting the production fixture exclusion.

### Step 4: Add scripts and verify locally

Add:

```json
{
  "security:secrets": "gitleaks git --log-opts=--all --config .gitleaks.toml --redact=100 --report-format sarif --report-path security-reports/gitleaks.sarif"
}
```

Run:

```bash
node --test scripts/security/install-gitleaks.test.mjs
bash scripts/security/install-gitleaks.sh .local/bin
PATH="$PWD/.local/bin:$PATH" npm run security:secrets
node scripts/security/sarif-policy.mjs --threshold 7 --input security-reports/gitleaks.sarif --output security-reports/gitleaks-policy.json
```

Expected: production tree/history is clean; the report exists and contains no plaintext secret.

Add a focused test that runs Gitleaks against a temporary synthetic secret, captures stdout/stderr and SARIF, copies the sanitized report through the artifact staging path, and asserts the exact secret value occurs nowhere even though the gate fails. Project 3 separately proves the same sanitized input cannot leak into an Issue payload.

### Step 5: Commit

```bash
git add .gitleaks.toml security/gitleaks-fixture.toml scripts/security/install-gitleaks.* package.json
git commit -m "feat: add exact full-history secret scanning"
```

---

## Task 4: Add production PR and trusted-main workflows

**Files:**
- Create: `.github/workflows/security-pr.yml`
- Create: `.github/workflows/security-main.yml`
- Create: `.github/dependabot.yml`
- Create: `.checkov.yml`
- Create: `scripts/security/write-scan-manifest.mjs`
- Create: `scripts/security/write-scan-manifest.test.mjs`
- Modify: `package.json`

### Step 1: Write failing manifest tests

The manifest is Project 3's completeness proof. Test that it:

- requires statuses for `osv`, `gitleaks`, `checkov`, `licenses`, and `sbom`;
- requires expected report paths and SHA-256 digests;
- rejects a missing, failed, skipped, empty, or malformed scanner report;
- marks fixture reports as `fixture: true` and refuses to include them in a production-complete manifest;
- records commit SHA, ref, run ID, tool versions, and generation time;
- sets `complete: true` only when every production input is successful and digestible.

### Step 2: Implement the manifest writer

Export pure `buildManifest(input)` and keep GitHub-environment reading in the CLI. The CLI exits nonzero when completeness cannot be proven. It writes `security-reports/production-manifest.json` atomically.

### Step 3: Create `security-pr.yml`

Triggers:

```yaml
on:
  pull_request:
  workflow_dispatch:
```

Top-level permissions: `contents: read`.

Use independent jobs so one failure does not erase other evidence:

1. `dependency-review`: official action, `fail-on-severity: high`, explicit license deny list.
2. `osv`: official reusable PR workflow at SHA `6e4298ebc4db23e847df9b2e2de2939d6f066c67`; do not fail on every advisory. Retain SARIF.
3. `osv-policy`: `if: always()`, download the exact OSV artifact, run the tested `>=7.0` policy with production/development classification.
4. `gitleaks`: checkout with `fetch-depth: 0`, checksum-install Gitleaks, scan `--all --redact=100`, upload sanitized SARIF.
5. `checkov`: install from `security/requirements-project2.txt`, scan `.github`, `supabase`, Docker/config surfaces with SARIF, then apply the tested local severity evaluator; missing severity blocks.
6. `licenses-sbom`: `npm ci --ignore-scripts`, capture `npm query '.prod' --json > security-reports/npm-production.json` and `npm query '.dev' --json > security-reports/npm-development.json`, run license policy against those files, generate CycloneDX JSON.
7. `policy-tests`: `npm ci --ignore-scripts`, run `npm run security:test` and action-pin checker.

Fork PRs must not require repository secrets. PR jobs must not have `issues: write`; do not use `pull_request_target`.

Every artifact upload uses `if: always()` and fixed retention. Missing expected output still fails its job after upload.

### Step 4: Create `security-main.yml`

Triggers:

```yaml
on:
  push:
    branches: [master]
  schedule:
    - cron: '17 4 * * 1'
  workflow_dispatch:
```

Permissions stay `contents: read` at workflow level. Give only SARIF upload jobs `security-events: write`, and gate those jobs with `github.ref == 'refs/heads/master'` plus default-branch workflow provenance so a non-master manual dispatch stays read-only.

Run the same production scanners plus the full locked-graph production/development license policy against the complete current tree/history. Upload each production SARIF to Code Scanning under stable categories such as `osv-production`, `gitleaks-production`, and `checkov-production`.

Scanner execution is decoupled from policy verdict:

- Each scanner job (OSV, Gitleaks, Checkov, license) generates its raw report and uploads it. Scanners MUST NOT fail because of policy decisions; they MUST fail when the binary crashes, a report is missing, the report is malformed, or upstream invocation fails. A scanner that crashes exits nonzero and the manifest job marks that slot as `incomplete` (not `complete: true`).
- A separate `policy-eval` job (`if: always()` on each upstream) downloads the artifact set and applies the tested severity evaluator and license policy. Its exit code communicates the verdict (1 = blocking findings exist, 0 = clean) but does not gate the manifest job.
- The `manifest` job runs after all scanner jobs complete (`if: always()` on every scanner, `needs: [osv, gitleaks, checkov, licenses-sbom]` without requiring `success()`). It downloads all reports, verifies run ID, ref, head SHA, tool, category, and SHA-256 digest, and writes/uploads `production-security-evidence` containing:

```text
security-reports/osv.sarif
security-reports/gitleaks.sarif
security-reports/checkov.sarif
security-reports/license-policy.json
security-reports/sbom.cdx.json
security-reports/production-manifest.json
```

`production-manifest.json` records:

- `headSha`, `ref`, `runId`, `toolVersions`, `generationTime`;
- one record per scanner with `status: success | failure`, `reportPath`, `digest`, `category`, `expected: true | false`;
- `policy: { verdict: 'clean' | 'blocking', blockedCount, reportedCount }` — present even when blocking;
- `complete: true` only when every required production scanner has `status: success` and every digest matches. A scanner crash or missing report sets `complete: false` and `incompleteReason[]`.

Project 3 reads the manifest and refuses to mutate Issues when `complete` is `false`. The manifest job has no issue-write permission. The `policy-eval` job fails the workflow when `verdict === 'blocking'`, ensuring CI still blocks, but the manifest is preserved for Project 3 regardless.

### Step 5: Add Dependabot and Checkov scope

Dependabot:

- npm ecosystem at repository root weekly;
- GitHub Actions ecosystem at repository root weekly;
- bounded open PR count;
- no auto-merge.

Checkov:

- compact output plus SARIF;
- scan `.github`, `supabase`, Docker/config/IaC surfaces;
- exclude `security/fixtures` from production;
- skip only checks proven inapplicable by an inline reason in `.checkov.yml`.

### Step 6: Validate workflow syntax and policy

```bash
npm run security:test
npm run security:actions
python - <<'PY'
import pathlib, yaml
for path in pathlib.Path('.github/workflows').glob('*.y*ml'):
    yaml.safe_load(path.read_text())
PY
rg 'pull_request_target|issues: write|@[A-Za-z][^ #]*$' .github/workflows && exit 1 || true
git diff --check
```

Use a temporary Python environment for validation only; do not add PyYAML to the application.

### Step 7: Commit

```bash
git add .github .checkov.yml scripts/security/write-scan-manifest.* package.json
git commit -m "feat: add deterministic production security workflows"
```

---

## Task 5: Add isolated vulnerable fixtures and self-test workflow

**Files:**
- Create: `security/fixtures/vulnerable/package.json`
- Create: `security/fixtures/vulnerable/package-lock.json`
- Create: `security/fixtures/vulnerable/expected-advisories.json`
- Create: `security/fixtures/secrets/github-token.txt`
- Create: `security/fixtures/iac/unsafe-workflow.yml`
- Create: `scripts/security/assert-fixtures.mjs`
- Create: `scripts/security/assert-fixtures.test.mjs`
- Create: `.github/workflows/security-fixtures.yml`

### Step 1: Write the failing fixture assertion tests

The pure function accepts normalized scanner results and requires exactly these stable demonstrations:

```text
OSV: GHSA-xvch-5gv4-984h (minimist 0.0.8, critical)
Gitleaks: github-pat
Checkov: CKV_GHA_2
Action-ref checker: mutable-action-ref
```

Prove that:

- all required IDs detected returns success;
- zero detections fails;
- one missing expected ID fails;
- scanner failure/missing report fails;
- extra findings are reported but do not hide missing required IDs;
- fixture results are marked `fixture: true`.

### Step 2: Create minimal fixtures

- `vulnerable/package.json` depends only on `minimist: 0.0.8`; generate its lockfile without installing scripts.
- `vulnerable/expected-advisories.json` records `GHSA-xvch-5gv4-984h`; the assertion CLI reads this checked requirement rather than hiding the expected advisory only in source code.
- `secrets/github-token.txt` contains one clearly synthetic, invalid GitHub PAT-shaped value and a comment stating it must never be used; fixture Gitleaks still runs with `--redact=100`, and the exact value must be absent from captured output and artifacts.
- `iac/unsafe-workflow.yml` contains:
  - one mutable external action ref for the local ref checker;
  - one `${{ github.event.issue.title }}` interpolation directly inside `run:` to trigger `CKV_GHA_2`.

Do not place the unsafe workflow under `.github/workflows`.

### Step 3: Implement `assert-fixtures.mjs`

Export `assertFixtureEvidence(evidence, requirements)`. The CLI reads the four report paths and writes `security-reports/fixture-summary.json`. It exits:

- `0` only when every required stable identifier is detected;
- `1` when an expected finding is absent, a report is malformed/missing, or a scanner did not complete.

Scanner findings themselves are not a job failure until this inversion check runs.

### Step 4: Create `security-fixtures.yml`

Triggers: pull request, push to `master`, weekly schedule, manual dispatch.

Permissions: `contents: read` only.

The job:

1. scans only `security/fixtures/vulnerable/package-lock.json` with OSV;
2. scans only `security/fixtures/secrets` with fixture Gitleaks config;
3. scans only `security/fixtures/iac` with Checkov;
4. runs the action-ref checker only on the unsafe fixture;
5. captures outputs even though detections are expected;
6. runs `assert-fixtures.mjs` as the actual gate;
7. uploads `fixture-security-evidence` with `if: always()`.

Never upload fixture SARIF to Code Scanning and never include it in `production-security-evidence`.

### Step 5: Verify and commit

```bash
npm run security:test
node scripts/security/check-action-pins.mjs security/fixtures/iac && exit 1 || true
# Run all four fixture scanners, then:
node scripts/security/assert-fixtures.mjs \
  --osv security-reports/fixture-osv.sarif \
  --gitleaks security-reports/fixture-gitleaks.sarif \
  --checkov security-reports/fixture-checkov.sarif \
  --actions security-reports/fixture-actions.json
git diff --check
git add security/fixtures scripts/security/assert-fixtures.* .github/workflows/security-fixtures.yml
git commit -m "test: prove security scanners detect vulnerable fixtures"
```

---

## Task 6: Local acceptance, public repository, and GitHub acceptance

**Files:**
- Modify: `README.md`
- Create: `docs/security-verification.md`
- Modify only if verification proves necessary: workflow/policy files from Tasks 1–5

### Step 1: Document exact local commands

Document:

```bash
npm ci --ignore-scripts
npm run security:test
npm run security:actions
npm run security:licenses
npm run security:sbom
npm run security:secrets
# exact Checkov and OSV commands used by CI
# exact fixture self-test commands
```

Explain production versus fixture evidence, the high/critical gate, license policy, full-history secret scanning, SARIF categories, artifact names, and why fixture results never reach Code Scanning.

### Step 2: Run the complete local gate

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run security:test
npm run security:actions
npm run security:licenses
npm run security:sbom
npm run security:secrets
# run pinned OSV and Checkov production commands
# run all pinned fixture commands and assert-fixtures.mjs
git diff --check
git status --short
```

Expected:

- Project 1 verification remains green;
- production scans must report no blocking high/critical finding, no secret leak, no prohibited or missing production license, and no high/critical IaC result;
- fixture self-test detects all four required identifiers;
- every external workflow action passes the immutable-ref checker;
- reports contain no plaintext credentials.

If a production scanner finds a real issue, fix the root cause in a separate focused `build_team` task. Never weaken the threshold or allowlist to make the build green.

### Step 3: Commit docs

```bash
git add README.md docs/security-verification.md
git commit -m "docs: add deterministic security verification runbook"
```

### Step 4: Create and push the public repository

Preconditions: clean worktree, all local gates green, active `gh` account is `michaelm96`.

```bash
gh repo create michaelm96/continuous-security-demo \
  --public \
  --source=. \
  --remote=origin \
  --description="Continuous application-security verification demo"
git push -u origin master
```

Do not use `--push` until the remote URL and visibility are confirmed. After confirmation, push the reviewed commits with `git push -u origin master`; never publish uncommitted reports or credentials.

### Step 5: Verify GitHub end to end

```bash
gh repo view michaelm96/continuous-security-demo --json nameWithOwner,visibility,url
gh workflow list
gh run list --branch master --limit 20
```

Confirm:

- repository is public and owned by `michaelm96`;
- `security-main` and `security-fixtures` complete successfully;
- production Code Scanning receives only production categories;
- fixture artifacts exist but fixture SARIF is absent from Code Scanning;
- `production-security-evidence` includes a complete manifest and all expected reports;
- workflow token permissions match the design;
- branch protection can require the independent production and fixture checks after their exact check names are known.

Record run URLs in `docs/security-verification.md`; do not record tokens or credentials.

### Step 6: Final focused review

Review the complete Project 2 diff against every acceptance criterion in the approved design. Re-run the complete local gate after any fix. Finish with a focused commit only if a real review finding required changes.
