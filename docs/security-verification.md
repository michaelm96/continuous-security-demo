# Deterministic security verification runbook

Project 2 wires five independent scanners (dependency review, OSV,
Gitleaks, Checkov, license + SBOM) into two GitHub Actions workflows.
Every scanner is pinned by SHA, every policy is implemented in
repository-local Node.js stdlib scripts, and a separate
`security-fixtures` workflow proves the scanners still detect the four
required identifiers.

## Production evidence

`security-main.yml` runs on every push to `master`, on a weekly schedule
(`17 4 * * 1`), and on manual dispatch. It performs five parallel
scans, applies the policies in `scripts/security/`, and writes a
completeness manifest.

| Scanner | What it scans | Output category (when published) |
|---|---|---|
| OSV-Scanner | full `package-lock.json` | `osv-production` |
| Gitleaks CLI | full git history with `--redact=100` | `gitleaks-production` |
| Checkov | `.github`, `supabase`, `apps` | `checkov-production` |
| License policy | production + development `npm query` snapshots | (n/a) |
| CycloneDX | production-only SBOM | (n/a) |

The manifest job (`scripts/security/write-scan-manifest.mjs`) records
head SHA, ref, run ID, tool versions, per-report SHA-256 digests, and
the policy verdict. It exits nonzero when completeness cannot be
proven, but it never gates other jobs.

## Pull-request evidence

`security-pr.yml` runs on every pull request and on manual dispatch.
It evaluates only dependencies newly introduced by the PR, runs the
same scanners as the trusted workflow, and gates the verdict via the
tested Node.js evaluators. Fork pull requests need no secrets because
no job requests `issues: write` or `security-events: write`. The
workflow never uses `pull_request_target`.

## Fixture self-test

`security-fixtures.yml` scans only `security/fixtures/`:

- `security/fixtures/vulnerable/package.json` depends on
  `minimist@0.0.8` so OSV must detect `GHSA-xvch-5gv4-984h`.
- `security/fixtures/secrets/github-token.txt` is a clearly synthetic
  invalid PAT; Gitleaks must match the `github-pat` rule and the value
  must never appear in any captured output thanks to `--redact=100`.
- `security/fixtures/iac/unsafe-workflow.yml` contains a mutable
  `actions/checkout@v4` reference and a `${{ github.event.issue.title }}`
  interpolation, so Checkov must detect `CKV_GHA_2` and the action-ref
  checker must flag the mutable ref.

`scripts/security/assert-fixtures.mjs` enforces the inversion check
itself: it exits `0` only when every required stable identifier is
detected; it exits `1` when a report is missing or malformed, when a
required ID is absent, or when a scanner did not complete.

Fixture SARIF is **never** uploaded to GitHub Code Scanning and is
**never** included in `production-security-evidence`. The fixture
artifact is `fixture-security-evidence`.

## Exact local commands

```sh
# Install the locked graph without running any package lifecycle scripts.
npm ci --ignore-scripts

# Run the security policy unit tests.
npm run security:test

# Reject mutable external Action references in .github/workflows.
npm run security:actions

# Capture the production and development graphs, then evaluate licenses.
mkdir -p security-reports
npm query '.prod' --json > security-reports/npm-production.json
npm query '.dev'  --json > security-reports/npm-development.json
npm run security:licenses -- \
  --production security-reports/npm-production.json \
  --development security-reports/npm-development.json \
  --output security-reports/license-policy.json

# Emit the CycloneDX SBOM (production-only).
npm run security:sbom

# Full-history Gitleaks scan with redaction.
npm run security:secrets

# OSV-Scanner direct (mirrors what security-main.yml runs).
npx --yes -p osv-scanner@2.5.1 osv-scanner \
  --format=sarif \
  --output=security-reports/osv.sarif \
  --lockfile=package-lock.json

# Checkov with the production config.
pip install -r security/requirements-project2.txt
checkov --config-file .checkov.yml --soft-fail
sarif="$(find security-reports -name 'results_sarif.sarif' -print -quit)"
[ -n "${sarif}" ] && cp "${sarif}" security-reports/checkov.sarif

# Fixture self-test (simulate the CI gate with synthetic scanner output).
node scripts/security/assert-fixtures.mjs \
  --osv        security-reports/fixture-osv.sarif \
  --gitleaks   security-reports/fixture-gitleaks.sarif \
  --checkov    security-reports/fixture-checkov.sarif \
  --actions    security-reports/fixture-actions.json \
  --requirements security/fixtures/vulnerable/expected-advisories.json \
  --output     security-reports/fixture-summary.json
```

## Severity policy

`scripts/security/sarif-policy.mjs --threshold 7` treats CVSS / security
severity `>= 7.0` as blocking. Findings below that threshold are
reported but do not block. Findings with no extractable severity are
classified by dependency kind:

- production dependency with unknown severity → **blocks**
- development dependency with unknown severity → reported only
- Checkov finding with no severity → **blocks** (via `--checkov`)

## License policy

`scripts/security/license-policy.mjs` evaluates the full locked graph.
Permitted: MIT, Apache-2.0, ISC, BSD-2/3-Clause, CC0-1.0, Unlicense,
WTFPL, 0BSD, MPL-2.0, Zlib, Python-2.0, PostgreSQL, NCSA, OpenSSL, BSL-1.0,
Artistic-2.0. Restricted: AGPL, SSPL, BUSL, GPL family, LGPL family,
Elastic, Commons-Clause, PolyForm. Non-commercial: CC-BY-NC, NC suffixes.
Missing production license → blocks.

Per-package exceptions live in `security/license-exceptions.json` and
each entry must include a `rationale` of at least 20 characters.
Broad license exceptions are forbidden.

## SARIF categories

| Workflow | Category | Tool |
|---|---|---|
| `security-main` | `osv-production` | OSV-Scanner |
| `security-main` | `gitleaks-production` | Gitleaks |
| `security-main` | `checkov-production` | Checkov |

Categories are distinct so production SARIF cannot be confused with
fixture SARIF. Fixture SARIF is never published to Code Scanning.

## Artifact names

| Artifact | Workflow | Contents |
|---|---|---|
| `osv-report` | `security-main`, `security-pr` | `security-reports/osv.sarif` |
| `gitleaks-report` | `security-main`, `security-pr` | `security-reports/gitleaks.sarif` |
| `checkov-report` | `security-main`, `security-pr` | `security-reports/checkov.sarif` |
| `licenses-sbom-report` | `security-main`, `security-pr` | `security-reports/license-policy.json`, `sbom.cdx.json` |
| `policy-evaluation` | `security-main` | `security-reports/*-policy.json` |
| `production-security-evidence` | `security-main` | every scanner report + `production-manifest.json` |
| `fixture-security-evidence` | `security-fixtures` | every fixture report + `fixture-summary.json` |

## Public GitHub repository

The repository is mirrored at
`https://github.com/michaelm96/continuous-security-demo`. The local
gate must be green before pushing. Workflow runs are visible at
`https://github.com/michaelm96/continuous-security-demo/actions` and
Code Scanning at `https://github.com/michaelm96/continuous-security-demo/security/code-scanning`.
