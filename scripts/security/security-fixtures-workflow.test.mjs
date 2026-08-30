import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression guard for GitHub Actions run 33319452080: OSV exited 127 because
// security-reports/ did not exist. The fix is a named step running
// `mkdir -p security-reports` immediately before "Scan the vulnerable fixture package".
const workflow = readFileSync(
  new URL('../../.github/workflows/security-fixtures.yml', import.meta.url),
  'utf8',
);

test('security-fixtures.yml runs mkdir -p security-reports in the step immediately before the OSV scan', () => {
  // Require a named step whose body contains `run: mkdir -p security-reports`,
  // with no other `- name:` step intervening before the OSV scan step.
  assert.match(
    workflow,
    /- name: [^\n]*\n(?:(?!\n\s*- name:)[\s\S])*?run: mkdir -p security-reports\b\n\s*- name: Scan the vulnerable fixture package/,
  );
});
