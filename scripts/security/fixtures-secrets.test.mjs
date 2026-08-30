import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FIXTURE = resolve(
  __dirname,
  '..',
  '..',
  'security',
  'fixtures',
  'secrets',
  'github-token.txt',
);

// Constructed at runtime by concatenating non-triggering fragments so
// the full `ghp_` + 36-char literal never appears contiguously in this
// source. The test file itself is scanned by Gitleaks (production
// config does not exclude scripts/security/), and the source-level
// assertion below proves the literal is absent.
const EXPECTED_TOKEN =
  'ghp_' + 'aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY3zA5';

// Regression guard for GitHub Actions run 33320910062: the previous fixture
// used `ghp_` + 36 zero digits, which Gitleaks 8.30.1 flagged as a "no
// leaks found" false negative because the body was zero-entropy. The exact
// 36-character high-entropy body below is the smallest value the production
// scanner reliably matches against `github-pat`.
test('security/fixtures/secrets/github-token.txt carries the exact 36-char high-entropy synthetic body required to trigger Gitleaks github-pat', () => {
  const content = readFileSync(TOKEN_FIXTURE, 'utf8');
  const lines = content.split('\n');
  const bodyLines = lines.filter(
    (line) => line.trim() !== '' && !line.trim().startsWith('#'),
  );
  assert.equal(
    bodyLines.length,
    1,
    'the fixture must contain exactly one synthetic token body line',
  );
  const body = bodyLines[0].trim();
  assert.equal(
    body,
    EXPECTED_TOKEN,
    'fixture body must equal the exact high-entropy synthetic token',
  );
  assert.ok(body.startsWith('ghp_'), 'fixture body must carry the ghp_ prefix');
  assert.equal(
    body.length - 'ghp_'.length,
    36,
    'fixture body must carry exactly 36 characters after the ghp_ prefix',
  );
  assert.ok(
    !/^ghp_0{36}$/.test(body),
    'fixture must NOT use the zero-entropy 36-zero body that Gitleaks skipped',
  );
});

// Source-level guard: this file is scanned by Gitleaks (production config
// does NOT exclude scripts/security/), so the synthetic body must never
// appear as a contiguous `ghp_` + 36-char token here. EXPECTED_TOKEN is
// built at runtime from non-triggering fragments so the literal never sits
// verbatim in the file; this assertion proves that property without
// depending on a Gitleaks binary.
test('fixtures-secrets.test.mjs source must not embed a contiguous ghp_ + 36-char token', () => {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  assert.doesNotMatch(
    source,
    /ghp_[A-Za-z0-9]{36}/,
    'test source must not contain a contiguous ghp_ + 36-char token literal',
  );
});