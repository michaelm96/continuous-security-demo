import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectWorkflowFiles } from './check-action-pins.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// Checkov 3.3.16 only discovers GitHub Actions workflows under a literal
// `.github/workflows/` directory inside the scan root. The fixture must
// therefore live at the nested `.github/workflows/` path so that running
// `checkov -d security/fixtures/iac --framework github_actions` actually
// emits `CKV_GHA_2` (and `CKV2_GHA_1`). The nested path is NOT the
// production `.github/workflows/` tree, so the production action-ref
// checker is not confused by it as long as its recursive walker descends
// into it.
const NESTED_FIXTURE = resolve(
  REPO_ROOT,
  'security',
  'fixtures',
  'iac',
  '.github',
  'workflows',
  'unsafe-workflow.yml',
);

// Structural regression guard for GitHub Actions run 33320910062. The
// fixture MUST live at this nested path so Checkov's GitHub Actions
// discovery picks it up; this test fails immediately if anyone moves the
// fixture back to the non-nested location that Checkov cannot discover.
test('security/fixtures/iac/.github/workflows/unsafe-workflow.yml exists at the scanner-discoverable nested path', () => {
  assert.ok(
    existsSync(NESTED_FIXTURE),
    `expected Checkov-discoverable fixture at ${NESTED_FIXTURE}; ` +
      'moving it out of `.github/workflows/` re-introduces the false-negative ' +
      'where Checkov 3.3.16 emits zero rules because GitHub Actions discovery ' +
      'requires a literal `.github/workflows/` directory inside the scan root',
  );
  const content = readFileSync(NESTED_FIXTURE, 'utf8');
  // The fixture must still carry the mutable `actions/checkout@v4` reference
  // and the `${{ github.event.issue.title }}` run-block interpolation that
  // CKV_GHA_2 (script injection) flags. If a future edit removes either, the
  // inversion gate will catch it via `assert-fixtures.mjs`, but we want a
  // structural guarantee here so the path itself is never questioned.
  assert.match(
    content,
    /uses:\s*actions\/checkout@v4\b/,
    'fixture must still carry the unpinned actions/checkout@v4 reference',
  );
  assert.match(
    content,
    /run:\s*echo\s+["']?\$\{\{\s*github\.event\.issue\.title\s*\}\}["']?/,
    'fixture must still carry the ${{ github.event.issue.title }} script-injection bait that CKV_GHA_2 catches',
  );
});

// The recursive action-ref checker must still find the mutable action when
// scanning the parent directory. The walker previously skipped every
// `.`-prefixed directory; the move below `.github/workflows/` would
// therefore silently drop the finding. This test guards the walker fix.
test('check-action-pins.mjs walker finds the mutable action when scanning security/fixtures/iac (descends into .github/workflows/)', () => {
  const result = inspectWorkflowFiles(
    resolve(REPO_ROOT, 'security', 'fixtures', 'iac'),
  );
  const checkoutRefs = result.mutable.filter(
    (item) => item.ref === 'actions/checkout@v4',
  );
  assert.ok(
    checkoutRefs.length >= 1,
    `expected the walker to report actions/checkout@v4 as mutable; got ${JSON.stringify(result.mutable)}`,
  );
});
