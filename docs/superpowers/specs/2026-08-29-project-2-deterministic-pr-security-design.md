# Project 2 — Deterministic Pull-Request Security Design

**Status:** Approved — 2026-08-29  
**Roadmap source:** `docs/superpowers/specs/2026-03-09-continuous-security-demo-design.md` §12.2  
**Repository:** `https://github.com/michaelm96/continuous-security-demo` (public, default branch `master`)

## 1. Goal

Project 2 adds reproducible GitHub security checks around the completed Project 1 application. Pull requests receive useful pass/fail results, complete scans publish genuine findings to GitHub Code Scanning, and intentionally vulnerable dependencies prove that the detector still works without leaving the real application permanently red.

Project 2 does not modify application behavior or authorization decisions.

## 2. Chosen approach

Use small, separate GitHub Actions workflows backed by locally runnable commands:

- GitHub Dependency Review for pull-request dependency and license policy.
- OSV-Scanner for dependency vulnerability detection and SARIF.
- Gitleaks CLI for full-history secret detection and SARIF.
- Checkov for GitHub Actions and future IaC misconfiguration detection and SARIF.
- CycloneDX npm tooling for a repository SBOM.
- GitHub Code Scanning for production SARIF.
- A separate expected-vulnerability fixture job for detector self-testing.

The implementation must prefer official GitHub primitives and existing repository tooling. It must not introduce a custom findings service, dashboard, scanner framework, monorepo orchestrator, or database.

## 3. Trust model

### 3.1 Pull requests are untrusted

Pull-request jobs:

- use `pull_request`, never `pull_request_target`, to inspect contributor code;
- receive no repository secrets;
- default to `contents: read`;
- receive only the additional permissions required for checks, artifacts, and supported SARIF upload;
- never create, update, or close GitHub Issues;
- never run application code with production credentials.

If GitHub cannot accept a SARIF upload from a fork, the workflow must retain the SARIF as an artifact and still enforce the local scanner result. It must never switch to `pull_request_target` as a workaround.

### 3.2 Trusted complete scans

A complete scan runs on:

- pushes to `master`;
- a weekly schedule;
- `workflow_dispatch` only when `github.ref == 'refs/heads/master'` and the workflow definition comes from the default branch.

Only those trusted-default-branch runs may receive `security-events: write` or feed Project 3. A non-`master` manual run may scan read-only but cannot upload production SARIF or reconcile Issues.

A trusted complete scan scans the complete current repository, uploads real findings to Code Scanning, and retains sanitized reports as artifacts for Project 3. A scan that cannot run or cannot produce its report fails closed.

### 3.3 Immutable tooling

- Every `uses:` reference is pinned to a verified full 40-character commit SHA, with a nearby version comment for maintainability.
- npm CLI packages are pinned to exact versions in `package-lock.json`.
- Non-npm tools use an equally reviewable immutable artifact: Gitleaks uses an exact release and verified archive checksum; Python tools use exact versions installed from a checked requirements file; the runner-provided `gh` version is recorded before use.
- Container tools, if used, are pinned by immutable digest.
- A repository check rejects mutable Action references such as `@main`, `@master`, or `@v4`.
- Dependabot may propose npm and GitHub Action updates, but updates remain ordinary reviewed pull requests.

## 4. Workflow decomposition

### 4.1 Pull-request security

A pull-request workflow performs these independent jobs:

1. **Lock/install integrity**
   - install untrusted pull-request dependencies with `npm ci --ignore-scripts`;
   - reject a missing lockfile or a working tree made dirty by validation, while permitting reviewed lockfile changes in the pull request;
   - prove the fixture is outside the root `apps/*` workspace.

2. **Dependency and license review**
   - evaluate only dependencies introduced or changed by the pull request;
   - block new vulnerabilities classified high or critical;
   - report moderate and low findings without blocking;
   - enforce the license policy in §5.2.

3. **OSV vulnerability scan**
   - scan the real repository dependency graph, excluding `security/fixtures/`;
   - emit SARIF 2.1.0;
   - upload or retain the report before applying the gate.

4. **Secret scan**
   - fetch complete Git history;
   - run the MIT-licensed Gitleaks CLI rather than `gitleaks-action`;
   - apply only the narrow exceptions in §5.3;
   - generate fully redacted output (`--redact=100`) before it reaches logs, SARIF, or artifacts;
   - emit sanitized SARIF and fail on every unallowlisted finding.

5. **IaC and workflow scan**
   - scan `.github/workflows/**` and any future supported IaC files;
   - emit SARIF;
   - block high and critical misconfigurations;
   - independently block mutable Action references.

6. **SBOM**
   - generate valid CycloneDX JSON from the committed root lockfile and npm workspaces;
   - upload it as an artifact even when a later gate fails.

Jobs should be independent so one failed scanner does not suppress evidence from another.

### 4.2 Complete security scan

The trusted complete-scan workflow performs full OSV, license, Gitleaks, and Checkov scans, generates the CycloneDX SBOM, uploads production SARIF with distinct categories, and retains sanitized reports. The license job evaluates the entire locked production dependency graph so a prohibited baseline dependency cannot hide behind pull-request delta review.

OSV and Checkov write machine-readable output first, then a small pinned Node.js evaluator normalizes tool severities and applies §5.1. It treats CVSS/security severity `>=7.0` as high or critical, lower known scores as report-only, and missing/unknown severity according to production versus development dependency classification. Checkov results without a trustworthy severity are blocking; no network enrichment or secret is required on pull requests. Focused fixtures cover high, moderate, unknown-production, unknown-development, and missing-severity inputs.

Each scanner follows this sequence:

```text
run scanner → capture exit status → publish report/artifact → apply policy result
```

A failed upload does not erase the scanner result. A scanner crash is not treated as a clean scan.

### 4.3 Vulnerable-fixture self-test

The fixture workflow scans only:

```text
security/fixtures/vulnerable/
├── package.json
├── package-lock.json
└── expected-advisories.json
```

Requirements:

- The package and vulnerable transitive graph are exactly pinned.
- `expected-advisories.json` names at least one stable advisory identifier expected from OSV.
- The job passes when every required advisory is present.
- It fails when a required advisory is absent, the scan crashes, or the fixture lockfile cannot be reproduced.
- Additional newly published fixture advisories are reported but do not make the self-test brittle.
- Fixture SARIF is retained as a clearly named artifact and is never uploaded as a production Code Scanning category.
- Fixture findings never feed Project 3 GitHub Issues.
- The fixture directory is not a root npm workspace and is never imported by application source.

This is analogous to controlled smoke in a test room: detecting the known danger is success; finding the same danger in the real application is failure.

## 5. Policies

### 5.1 Vulnerability severity

- High or critical: block.
- Moderate or low: report without blocking.
- Unknown severity: report and block when it affects a production dependency; report only for development-only dependencies unless another scanner classifies it high or critical.

The complete scan evaluates the whole dependency graph. Pull-request Dependency Review evaluates newly introduced changes.

### 5.2 Dependency licenses

Block dependencies with clearly unsuitable terms, including:

- AGPL family licenses;
- SSPL;
- non-commercial licenses;
- source-available licenses that prohibit ordinary redistribution or commercial use;
- a production dependency with no identifiable license.

Report uncertain development-only license metadata without blocking. Prefer a deny policy over a strict permissive-only allowlist so legitimate uncommon licenses do not create routine false failures. Any exception must identify one exact package/version and include a written rationale; broad license exceptions are forbidden.

The repository itself ships under the MIT License.

### 5.3 Secrets

Gitleaks scans complete Git history and redacts every finding value at generation time with `--redact=100`. Unredacted Gitleaks output is never written to logs, SARIF, artifacts, job summaries, or downstream Issues. The allowlist may contain only exact values or exact fingerprints for documented local-only material, such as deterministic demo-user passwords and public local Supabase values.

Forbidden exceptions include:

- entire-file or directory allowlists;
- generic password, token, JWT, private-key, or entropy patterns;
- production-looking values;
- generated local signing private keys.

Every unallowlisted secret finding blocks regardless of severity.

### 5.4 Workflow and pin policy

Every external Action is full-SHA pinned. Workflow permissions are declared explicitly at workflow or job scope. Write permissions are absent unless a job demonstrably needs them. Shell commands use strict error handling and quote interpolated values.

## 6. Data and artifact flow

```text
committed source + lockfiles
  ├─ dependency review ────────────────> PR check
  ├─ OSV ──────────────> osv.sarif ───> Code Scanning + artifact
  ├─ Gitleaks ─────────> secrets.sarif > Code Scanning + artifact
  ├─ Checkov ──────────> iac.sarif ───> Code Scanning + artifact
  └─ CycloneDX ────────> sbom.cdx.json > artifact

isolated fixture lockfile
  └─ OSV JSON → expected-ID assertion → fixture artifact only
```

Production and fixture reports use different artifact names and directories so downstream automation cannot mix them accidentally.

## 7. Repository and GitHub setup

Project 2 creates the public repository `michaelm96/continuous-security-demo`, adds it as `origin`, and pushes the existing `master` history.

After workflow check names exist and complete successfully, branch protection requires the real pull-request security checks. The fixture self-test is not a required merge check because its intentionally vulnerable input is demonstration evidence rather than application health.

Repository Actions settings must retain the minimal default `GITHUB_TOKEN` permissions. Any broader permission is declared only on the job that needs it.

## 8. Error handling

- Missing tools, malformed reports, unsupported report versions, scanner crashes, and timeouts fail the owning check.
- SARIF/report upload steps use `if: always()` or equivalent, but the final job result still reflects policy failure.
- No `continue-on-error` may turn a required production gate green.
- A zero-resource IaC scan is successful only when the scanner itself ran successfully and reported zero recognized resources.
- Logs must not print environment values, authorization headers, signing keys, or complete generated tokens.

## 9. Verification

Small automated checks must prove:

- every workflow Action reference is a full SHA;
- workflow permissions are explicit and minimal;
- root `npm ci` is lockfile-clean;
- `security/fixtures/vulnerable/` is outside npm workspaces;
- the expected fixture advisory is detected;
- fixture results cannot enter production SARIF paths;
- the Gitleaks configuration has only exact narrow exceptions;
- a synthetic unallowlisted secret makes the secret check fail but its value appears in none of the captured logs, SARIF, artifacts, or Project 3 Issue payloads;
- severity normalization blocks high, unknown-production, Checkov missing-severity, and malformed input while reporting moderate and unknown-development input;
- the complete license baseline blocks prohibited or unidentified production licenses;
- generated SBOM parses as CycloneDX JSON and includes both workspaces;
- malformed scanner output fails rather than being treated as empty;
- production SARIF artifacts use distinct tool/category names;
- non-`master` manual dispatch cannot receive write permissions or publish production findings.

GitHub end-to-end verification must additionally prove:

- all workflows start under their intended triggers;
- real SARIF reaches the Security tab;
- the fixture workflow stays green when its required advisory is detected;
- a controlled high-severity application fixture fails the real gate when temporarily introduced on a test branch;
- branch protection recognizes the required checks.

## 10. Planned file surface

Expected additions are limited to:

```text
.github/dependabot.yml
.github/dependency-review-config.yml
.github/workflows/security-pr.yml
.github/workflows/security-main.yml
.github/workflows/security-fixtures.yml
.gitleaks.toml
.checkov.yml
LICENSE
security/requirements-project2.txt
security/gitleaks-fixture.toml
security/fixtures/vulnerable/package.json
security/fixtures/vulnerable/package-lock.json
security/fixtures/secrets/github-token.txt
security/fixtures/iac/unsafe-workflow.yml
scripts/security/sarif-policy.mjs
scripts/security/license-policy.mjs
scripts/security/check-action-pins.mjs
scripts/security/write-scan-manifest.mjs
scripts/security/assert-fixtures.mjs
scripts/security/*.test.mjs
```

The implementation plan may combine tiny validation scripts when that reduces duplication without weakening a separate failure signal.

## 11. Explicit exclusions

Project 2 does not add:

- application, authentication, authorization, RLS, database, or UI changes;
- SAST beyond the named dependency/secret/IaC checks;
- API fuzzing or endpoint inventory;
- ZAP or other DAST;
- staging infrastructure;
- AI review;
- a findings database or dashboard;
- GitHub Issue synchronization.

## 12. Acceptance criteria

Project 2 is complete when:

1. `michaelm96/continuous-security-demo` exists publicly with the existing history on `master`.
2. Root installation remains reproducible with `npm ci`.
3. Pull requests run dependency/license, OSV, Gitleaks, IaC/workflow, pin, and SBOM jobs.
4. High/critical dependency findings, prohibited licenses, every unallowlisted secret, and mutable Action refs block.
5. Moderate/low dependency findings remain visible without blocking.
6. Complete `master` scans upload genuine sanitized SARIF to GitHub Code Scanning and retain sanitized reports.
7. The fixture job proves at least one required advisory is detected while production gates remain green.
8. Fixture findings never appear as genuine application Code Scanning findings.
9. A valid CycloneDX SBOM is downloadable from the workflow run.
10. All new scripts have focused automated checks, and the existing Project 1 tests/builds remain green.
11. Required real security checks are enabled in branch protection after their first successful run.
