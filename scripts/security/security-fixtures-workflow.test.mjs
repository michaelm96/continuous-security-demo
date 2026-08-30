import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../../.github/workflows/security-fixtures.yml', import.meta.url),
  'utf8',
);

// Return the body of the named step (everything between its `- name:` header
// and the next `- name:` header, or EOF for the final step). Bounding the
// body at the next step header keeps assertions scoped to the step they
// describe, so moving a line into a later step makes them fail.
function stepBody(name) {
  const after = workflow.split(`- name: ${name}\n`, 2)[1];
  if (after === undefined) {
    throw new Error(`step not found: ${name}`);
  }
  return after.split(/\n\s*- name: /, 1)[0];
}

const checkovStepBody = stepBody('Scan the fixture IaC');

// Regression guard for GitHub Actions run 33319452080: OSV exited 127 because
// security-reports/ did not exist. The fix is a named step running
// `mkdir -p security-reports` immediately before the OSV scan. The
// negative-lookahead in the middle of the regex bounds the matched range to
// a single step body: any other `- name:` header before the OSV scan step
// would break the match, so this proves adjacency (not just "mkdir is in
// some step earlier in the file").
test('security-fixtures.yml runs mkdir -p security-reports in the step immediately before the OSV scan', () => {
  assert.match(
    workflow,
    /- name: [^\n]*\n(?:(?!\n\s*- name:)[\s\S])*?run: mkdir -p security-reports\b\n\s*- name: Scan the vulnerable fixture package/,
    '`mkdir -p security-reports` must run in a step immediately before "Scan the vulnerable fixture package"',
  );
});

// Regression guard for GitHub Actions run 33320910062: Checkov 3.3.16 treated
// `--output-file-path security-reports/fixture-checkov.sarif` as a DIRECTORY
// and wrote `results_sarif.sarif` inside it, so the downstream `[ ! -s ... ]`
// check failed with `EISDIR: illegal operation on a directory, read`. The fix
// follows the proven production pattern from `.github/workflows/security-main.yml`:
// pass `security-reports` (a directory) to Checkov, find the generated
// `results_sarif.sarif`, then copy it to the stable report filename.
test('security-fixtures.yml Checkov step passes the directory to --output-file-path, finds results_sarif.sarif, and copies it to the stable report path', () => {
  // 1. The stable SARIF filename must NOT be passed to --output-file-path:
  //    Checkov 3.3.16 treats it as a directory and writes results_sarif.sarif
  //    inside it (this is exactly what broke the run).
  assert.doesNotMatch(
    workflow,
    /--output-file-path\s+security-reports\/fixture-checkov\.sarif\b/,
    'Checkov must not receive the stable SARIF filename as --output-file-path',
  );

  // 2. The step must locate Checkov's generated SARIF and copy it to the
  //    stable path the downstream inversion gate consumes. All assertions
  //    operate on the step body extracted above, so moving any of these
  //    lines to a subsequent step would fail this test.
  assert.match(
    checkovStepBody,
    /find security-reports -name 'results_sarif\.sarif'/,
    'the Checkov step must `find` results_sarif.sarif inside security-reports',
  );
  assert.match(
    checkovStepBody,
    /cp "\$\{sarif\}" security-reports\/fixture-checkov\.sarif/,
    'the Checkov step must copy ${sarif} to the stable SARIF path',
  );
  assert.match(
    checkovStepBody,
    /\[ ! -s security-reports\/fixture-checkov\.sarif \]/,
    'the Checkov step must verify the stable SARIF is nonempty',
  );

  // 3. None of the locate/copy/verify commands may live in a LATER step.
  //    Scanning the rest of the workflow for each command catches the
  //    "moved into a subsequent step" regression that the step-body
  //    assertions above cannot see on their own.
  const later = workflow.split('- name: Scan the fixture IaC\n', 2)[1]
    .split(/\n\s*- name: /, 2)[1] ?? '';
  for (const [label, pattern] of [
    ['`find ... results_sarif.sarif`', /find security-reports -name 'results_sarif\.sarif'/],
    ['`cp "${sarif}" ... fixture-checkov.sarif`', /cp "\$\{sarif\}" security-reports\/fixture-checkov\.sarif/],
    ['the nonempty guard', /\[ ! -s security-reports\/fixture-checkov\.sarif \]/],
  ]) {
    assert.doesNotMatch(
      later,
      pattern,
      `${label} must not appear in any step after "Scan the fixture IaC"`,
    );
  }
});

// Regression guard for the Checkov 3.3.16 GitHub Actions discovery bug: when
// the scan root is passed as the relative path `security/fixtures/iac`,
// Checkov's GitHub Actions framework emits zero rules (CKV_GHA_2 / CKV2_GHA_1
// go missing), which silently breaks the downstream inversion gate. The
// scanner only discovers the fixture at `security/fixtures/iac/.github/workflows/`
// when `-d` is an ABSOLUTE path. `${PWD}` at the top of the runner step is
// the repo root that `actions/checkout` just populated, so
// `"${PWD}/security/fixtures/iac"` is the absolute scan root Checkov needs.
test('security-fixtures.yml Checkov step scans an absolute scan root via "${PWD}/security/fixtures/iac" (Checkov 3.3.16 zero-rules bug for relative -d)', () => {
  assert.match(
    checkovStepBody,
    /checkov -d "\$\{PWD\}\/security\/fixtures\/iac"/,
    'the Checkov step must pass "${PWD}/security/fixtures/iac" to `-d` (absolute scan root)',
  );

  // Guard against regressing back to a bare relative path. Allow the
  // absolute `${PWD}` form above; reject `checkov -d security/fixtures/iac`
  // or `checkov -d ./security/fixtures/iac`.
  assert.doesNotMatch(
    checkovStepBody,
    /checkov -d (?!["']?\$\{PWD\})[^"' \n]*?security\/fixtures\/iac\b/,
    'the Checkov step must NOT use a bare relative `-d security/fixtures/iac`; absolute scan root is required',
  );
});

// Regression guard for the Checkov 3.3.16 zero-rules bug inherited from the
// repo-root `.checkov.yml`. The fixture step runs from the repo root, so it
// loads `.checkov.yml` and inherits its `skip-path: security/fixtures`
// entry; the relative framework-discovery walk then matches that skip and
// emits zero rules. Two flags together override the inherited skip and
// force the github_actions framework:
//   * `--framework github_actions` keeps Checkov on the GitHub Actions
//     scanner (the default walk would also discover Kubernetes/Dockerfile/
//     etc. and inherit unrelated skip-path matches).
//   * `--skip-path '^$'` resets the inherited skip list so no path is
//     skipped; the repo-root skip is overridden at the CLI.
test('security-fixtures.yml Checkov step pins --framework github_actions and resets the inherited skip list with --skip-path \'^$\' (Checkov 3.3.16 zero-rules bug)', () => {
  assert.ok(
    checkovStepBody.includes('--framework github_actions'),
    'the Checkov step must pass --framework github_actions (forces the GitHub Actions scanner)',
  );
  assert.ok(
    checkovStepBody.includes(`--skip-path '^$'`),
    "the Checkov step must pass --skip-path '^$' (overrides the repo-root .checkov.yml skip list)",
  );
});

const gitleaksStepBody = stepBody('Scan the fixture secret');

// Inherited `bash -e` would abort before `status=$?` runs; the if/else makes
// gitleaks' exit the conditional test, so errexit does not trigger and the
// 0/1 status gate and SARIF nonempty guard (same step, in order) run.
test('security-fixtures.yml Gitleaks step wraps detect in if/else, then gates on 0/1 status and nonempty SARIF', () => {
  assert.match(
    gitleaksStepBody,
    /if gitleaks detect --no-git --redact=100 --config security\/gitleaks-fixture\.toml \\\n\s+--source security\/fixtures\/secrets \\\n\s+--report-format sarif --report-path security-reports\/fixture-gitleaks\.sarif; then\n\s+status=0\n\s+else\n\s+status=\$\?\n\s+fi\n\s+if \[ "\$\{status\}" -ne 0 \] && \[ "\$\{status\}" -ne 1 \]; then/,
    'gitleaks detect must be inside `if ...; then status=0; else status=$?; fi`, followed by the 0/1 status gate',
  );
  assert.match(
    gitleaksStepBody,
    /if \[ ! -s security-reports\/fixture-gitleaks\.sarif \]; then/,
    'the SARIF nonempty guard must live in the same step, after the 0/1 status gate',
  );
});
