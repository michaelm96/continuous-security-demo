import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertFixtureEvidence } from './assert-fixtures.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, 'assert-fixtures.mjs');

const REQUIREMENTS = {
  expected: ['GHSA-xvch-5gv4-984h', 'github-pat', 'CKV_GHA_2', 'mutable-action-ref'],
};

function fullEvidence(overrides = {}) {
  return {
    osv: [{ id: 'GHSA-xvch-5gv4-984h' }],
    gitleaks: [{ ruleId: 'github-pat', props: { tags: ['secret'] } }],
    checkov: [{ ruleId: 'CKV_GHA_2' }],
    actions: [{ id: 'mutable-action-ref:unsafe-workflow.yml:21' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure function: assertFixtureEvidence
// ---------------------------------------------------------------------------

test('returns ok when every required stable identifier is detected', () => {
  const result = assertFixtureEvidence(fullEvidence(), REQUIREMENTS);
  assert.equal(result.ok, true);
  assert.deepEqual(result.detected, REQUIREMENTS.expected);
  assert.deepEqual(result.missing, []);
  assert.equal(result.fixture, true);
});

test('zero OSV findings marks the OSV requirement as missing', () => {
  const result = assertFixtureEvidence(fullEvidence({ osv: [] }), REQUIREMENTS);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['GHSA-xvch-5gv4-984h']);
  assert.deepEqual(result.detected, ['github-pat', 'CKV_GHA_2', 'mutable-action-ref']);
});

test('a missing gitleaks finding marks github-pat as missing', () => {
  const result = assertFixtureEvidence(fullEvidence({ gitleaks: [] }), REQUIREMENTS);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['github-pat']);
});

test('a missing checkov finding marks CKV_GHA_2 as missing', () => {
  const result = assertFixtureEvidence(fullEvidence({ checkov: [] }), REQUIREMENTS);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['CKV_GHA_2']);
});

test('a missing actions finding marks mutable-action-ref as missing', () => {
  const result = assertFixtureEvidence(fullEvidence({ actions: [] }), REQUIREMENTS);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['mutable-action-ref']);
});

test('a gitleaks rule whose only stable identifier is a tag still satisfies the requirement', () => {
  // Gitleaks sometimes reports a rule only via properties.tags when the
  // ruleId field is generic.
  const result = assertFixtureEvidence(
    fullEvidence({
      gitleaks: [{ ruleId: 'generic-rule', props: { tags: ['github-pat', 'secret'] } }],
    }),
    REQUIREMENTS,
  );
  assert.equal(result.ok, true);
});

test('extra findings do not block the gate and are reported as extra', () => {
  const result = assertFixtureEvidence(
    fullEvidence({
      osv: [
        { id: 'GHSA-xvch-5gv4-984h' },
        { id: 'GHSA-other-finding-1234' },
      ],
      checkov: [
        { ruleId: 'CKV_GHA_2' },
        { ruleId: 'CKV_GHA_99' },
      ],
    }),
    REQUIREMENTS,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.extra.sort(), ['CKV_GHA_99', 'GHSA-other-finding-1234']);
});

test('action evidence with extra IDs not starting with any requirement is reported as extra', () => {
  const result = assertFixtureEvidence(
    fullEvidence({
      actions: [
        { id: 'mutable-action-ref:unsafe-workflow.yml:21' },
        { id: 'some-other-rule:elsewhere.yml:3' },
      ],
    }),
    REQUIREMENTS,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.extra, ['some-other-rule:elsewhere.yml:3']);
});

test('every result is marked fixture: true', () => {
  const result = assertFixtureEvidence(fullEvidence(), REQUIREMENTS);
  assert.equal(result.fixture, true);
});

test('throws when evidence is missing or not an object', () => {
  assert.throws(() => assertFixtureEvidence(null, REQUIREMENTS), TypeError);
  assert.throws(() => assertFixtureEvidence([], REQUIREMENTS), TypeError);
});

test('throws when requirements has no expected array', () => {
  assert.throws(
    () => assertFixtureEvidence(fullEvidence(), { expected: 'not-an-array' }),
    TypeError,
  );
  assert.throws(
    () => assertFixtureEvidence(fullEvidence(), {}),
    TypeError,
  );
});

// ---------------------------------------------------------------------------
// CLI: missing files and malformed input
// ---------------------------------------------------------------------------

function makeWorkspace(files = {}) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'assert-fixtures-cli-'));
  fs.mkdirSync(join(dir, 'security-reports'), { recursive: true });
  fs.mkdirSync(join(dir, 'security', 'fixtures', 'vulnerable'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(join(dir, name), content);
  }
  return dir;
}

function sarifWith(results) {
  return JSON.stringify({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'test-tool' } },
        results,
      },
    ],
  });
}

function runCli(dir, extraArgs = [], env = {}) {
  const args = [
    SCRIPT_PATH,
    '--osv', 'security-reports/fixture-osv.sarif',
    '--gitleaks', 'security-reports/fixture-gitleaks.sarif',
    '--checkov', 'security-reports/fixture-checkov.sarif',
    '--actions', 'security-reports/fixture-actions.json',
    '--requirements', 'security/fixtures/vulnerable/expected-advisories.json',
    '--output', 'security-reports/fixture-summary.json',
    ...extraArgs,
  ];
  return spawnSync(process.execPath, args, {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function allReportsPresent() {
  return {
    'security-reports/fixture-osv.sarif': sarifWith([
      { ruleId: 'GHSA-xvch-5gv4-984h', message: { text: 'rce' } },
    ]),
    'security-reports/fixture-gitleaks.sarif': sarifWith([
      { ruleId: 'github-pat', properties: { tags: ['secret'] } },
    ]),
    'security-reports/fixture-checkov.sarif': sarifWith([
      { ruleId: 'CKV_GHA_2', message: { text: 'unsafe workflow' } },
    ]),
    'security-reports/fixture-actions.json': JSON.stringify({
      mutable: [
        {
          id: 'mutable-action-ref:unsafe-workflow.yml:21:0',
          ruleId: 'mutable-action-ref',
          file: 'unsafe-workflow.yml',
          line: 21,
        },
      ],
    }),
    'security/fixtures/vulnerable/expected-advisories.json': JSON.stringify(REQUIREMENTS),
  };
}

test('CLI exits 0 and writes a summary when every report is present and matches', () => {
  const dir = makeWorkspace(allReportsPresent());
  const { status, stdout } = runCli(dir);
  assert.equal(status, 0, stdout);
  const summaryPath = join(dir, 'security-reports', 'fixture-summary.json');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.ok, true);
  assert.equal(summary.fixture, true);
  assert.deepEqual(summary.detected, REQUIREMENTS.expected);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits 1 when a report file is missing', () => {
  const files = allReportsPresent();
  delete files['security-reports/fixture-checkov.sarif'];
  const dir = makeWorkspace(files);
  const { status, stderr } = runCli(dir);
  assert.notEqual(status, 0);
  assert.ok(
    stderr.includes('Fixture report unreadable') || stderr.includes('cannot read'),
    stderr,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits 1 and prints a clear error when a SARIF file is malformed', () => {
  const files = allReportsPresent();
  files['security-reports/fixture-osv.sarif'] = '{"version":"2.1.0","runs":[],"oops":';
  const dir = makeWorkspace(files);
  const { status, stderr } = runCli(dir);
  assert.notEqual(status, 0);
  assert.ok(stderr.includes('Fixture report unreadable'), stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits 1 and rejects a SARIF file with the wrong version', () => {
  const files = allReportsPresent();
  files['security-reports/fixture-osv.sarif'] = JSON.stringify({
    version: '2.0.0',
    runs: [{ tool: { driver: { name: 'x' } }, results: [] }],
  });
  const dir = makeWorkspace(files);
  const { status, stderr } = runCli(dir);
  assert.notEqual(status, 0);
  assert.ok(stderr.includes('Invalid SARIF version'), stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits 1 when the requirements file is missing', () => {
  const files = allReportsPresent();
  delete files['security/fixtures/vulnerable/expected-advisories.json'];
  const dir = makeWorkspace(files);
  const { status, stderr } = runCli(dir);
  assert.notEqual(status, 0);
  assert.ok(stderr.includes('Requirements file not found'), stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits 1 when the requirements file does not contain an expected array', () => {
  const files = allReportsPresent();
  files['security/fixtures/vulnerable/expected-advisories.json'] =
    JSON.stringify({ not_expected: [] });
  const dir = makeWorkspace(files);
  const { status, stderr } = runCli(dir);
  assert.notEqual(status, 0);
  assert.ok(stderr.includes('"expected" array'), stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits 1 when an expected finding is absent from the reports', () => {
  const files = allReportsPresent();
  files['security-reports/fixture-osv.sarif'] = sarifWith([]);
  const dir = makeWorkspace(files);
  const { status, stderr } = runCli(dir);
  assert.notEqual(status, 0);
  assert.ok(stderr.includes('Fixture inversion check FAILED'), stderr);
  assert.ok(stderr.includes('GHSA-xvch-5gv4-984h'), stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI writes the summary atomically and leaves no temp file behind', () => {
  const dir = makeWorkspace(allReportsPresent());
  const { status } = runCli(dir);
  assert.equal(status, 0);
  const entries = fs.readdirSync(join(dir, 'security-reports'));
  assert.ok(
    !entries.some((name) => name.includes('.tmp')),
    `temp file leaked: ${entries.join(', ')}`,
  );
  const summaryPath = join(dir, 'security-reports', 'fixture-summary.json');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI marks the summary fixture: true and lists extras without failing', () => {
  const files = allReportsPresent();
  files['security-reports/fixture-osv.sarif'] = sarifWith([
    { ruleId: 'GHSA-xvch-5gv4-984h' },
    { ruleId: 'GHSA-extra-1' },
  ]);
  const dir = makeWorkspace(files);
  const { status } = runCli(dir);
  assert.equal(status, 0);
  const summary = JSON.parse(
    fs.readFileSync(join(dir, 'security-reports', 'fixture-summary.json'), 'utf8'),
  );
  assert.equal(summary.fixture, true);
  assert.deepEqual(summary.extra, ['GHSA-extra-1']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits 2 when required arguments are missing', () => {
  const dir = makeWorkspace(allReportsPresent());
  const { status, stderr } = spawnSync(
    process.execPath,
    [SCRIPT_PATH, '--osv', 'security-reports/fixture-osv.sarif'],
    { cwd: dir, encoding: 'utf8' },
  );
  assert.equal(status, 2);
  assert.ok(stderr.includes('Usage:'), stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI accepts an action JSON without an explicit id and synthesizes one', () => {
  const files = allReportsPresent();
  files['security-reports/fixture-actions.json'] = JSON.stringify({
    mutable: [{ file: 'unsafe-workflow.yml', line: 21 }],
  });
  const dir = makeWorkspace(files);
  const { status } = runCli(dir);
  assert.equal(status, 0, 'synthesized id should still start with mutable-action-ref:');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// OSV SARIF alias extraction from result.message (run 33320910062)
// ---------------------------------------------------------------------------

// Regression guard for GitHub Actions run 33320910062: osv-scanner 2.5.1
// emits the advisory's GHSA alias inside `result.message.text` rather than
// `result.ruleId`, so an inversion check that only reads `ruleId` cannot
// satisfy a requirement that names the GHSA. The CLI must extract
// `GHSA-[A-Za-z0-9-]+` aliases from the message and expose them as
// additional OSV evidence IDs alongside the primary ruleId.
test('CLI exits 0 when the OSV requirement is satisfied by a GHSA alias extracted from result.message (not ruleId)', () => {
  const files = allReportsPresent();
  // Mirror the real OSV SARIF: ruleId is the CVE primary, the GHSA alias
  // appears inside the message text in the exact format osv-scanner uses.
  files['security-reports/fixture-osv.sarif'] = sarifWith([
    {
      ruleId: 'CVE-2020-7598',
      message: {
        text: "Package 'minimist@0.0.8' is vulnerable to 'CVE-2020-7598' (also known as 'GHSA-vh95-rmgr-6w4m').",
      },
    },
    {
      ruleId: 'CVE-2021-44906',
      message: {
        text: "Package 'minimist@0.0.8' is vulnerable to 'CVE-2021-44906' (also known as 'GHSA-xvch-5gv4-984h').",
      },
    },
  ]);
  const dir = makeWorkspace(files);
  const { status, stdout, stderr } = runCli(dir);
  assert.equal(status, 0, `stdout=${stdout} stderr=${stderr}`);
  const summary = JSON.parse(
    fs.readFileSync(join(dir, 'security-reports', 'fixture-summary.json'), 'utf8'),
  );
  assert.equal(summary.ok, true);
  assert.ok(
    summary.detected.includes('GHSA-xvch-5gv4-984h'),
    `GHSA alias must satisfy the OSV requirement: ${JSON.stringify(summary.detected)}`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

// Guard against the alias extractor accepting arbitrary message text. Only
// strings that match the strict `GHSA-[A-Za-z0-9-]+` shape are promoted to
// evidence IDs; bare words or non-GHSA tokens must not appear as ids.
test('CLI does not promote arbitrary message tokens to OSV evidence IDs', () => {
  const files = allReportsPresent();
  // Same shape as the real OSV SARIF plus an extra non-GHSA token in the
  // message; only the GHSA alias should reach the evidence set.
  files['security-reports/fixture-osv.sarif'] = sarifWith([
    {
      ruleId: 'CVE-2021-44906',
      message: {
        text: "Package 'minimist@0.0.8' is vulnerable to 'CVE-2021-44906' (also known as 'GHSA-xvch-5gv4-984h') [see also CVE-9999-0000].",
      },
    },
  ]);
  const dir = makeWorkspace(files);
  const { status } = runCli(dir);
  assert.equal(status, 0);
  const summary = JSON.parse(
    fs.readFileSync(join(dir, 'security-reports', 'fixture-summary.json'), 'utf8'),
  );
  // GHSA alias satisfies the OSV requirement; the unrelated CVE-9999-0000
  // must NOT be promoted (it is not a GHSA and not the ruleId), and the
  // ruleId CVE-2021-44906 reaches `extras` (it is not in the expected list)
  // but does not block the gate.
  assert.ok(summary.detected.includes('GHSA-xvch-5gv4-984h'));
  assert.ok(summary.extra.includes('CVE-2021-44906'));
  assert.ok(
    !summary.detected.includes('CVE-9999-0000') &&
      !summary.extra.includes('CVE-9999-0000'),
    'CVE-9999-0000 is neither a GHSA alias nor the ruleId and must not leak',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
