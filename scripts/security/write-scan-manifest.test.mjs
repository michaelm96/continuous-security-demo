import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_TOOLS,
  buildManifest,
  writeManifestFile,
} from './write-scan-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, 'write-scan-manifest.mjs');

const DIGESTS = {
  osv: 'a'.repeat(64),
  gitleaks: 'b'.repeat(64),
  checkov: 'c'.repeat(64),
  licenses: 'd'.repeat(64),
  sbom: 'e'.repeat(64),
};

function report(tool, overrides = {}) {
  return {
    tool,
    category: 'production',
    path: `security-reports/${tool}.json`,
    status: 'success',
    digest: DIGESTS[tool],
    bytes: 512,
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    headSha: '9'.repeat(40),
    ref: 'refs/heads/master',
    runId: '1234567890',
    toolVersions: {
      osv: '2.5.1',
      gitleaks: '8.30.1',
      checkov: '3.3.16',
      cyclonedx: '6.0.1',
    },
    generationTime: '2026-08-29T04:17:00.000Z',
    reports: REQUIRED_TOOLS.map((tool) => report(tool)),
    policy: { verdict: 'clean', blockedCount: 0, reportedCount: 3 },
    ...overrides,
  };
}

function withoutTool(tool, overrides = {}) {
  return baseInput({
    reports: REQUIRED_TOOLS.filter((t) => t !== tool).map((t) => report(t)),
    ...overrides,
  });
}

function replaceTool(tool, patch) {
  return baseInput({
    reports: REQUIRED_TOOLS.map((t) => (t === tool ? report(t, patch) : report(t))),
  });
}

function reasonsFor(manifest, tool) {
  return manifest.incompleteReason.filter((reason) => reason.startsWith(`${tool}:`));
}

// ---------------------------------------------------------------------------
// Required scanner coverage
// ---------------------------------------------------------------------------

test('requires statuses for osv, gitleaks, checkov, licenses and sbom', () => {
  assert.deepEqual([...REQUIRED_TOOLS], ['osv', 'gitleaks', 'checkov', 'licenses', 'sbom']);
});

test('a fully successful production run is complete with no reasons', () => {
  const manifest = buildManifest(baseInput());
  assert.equal(manifest.complete, true);
  assert.deepEqual(manifest.incompleteReason, []);
});

for (const tool of ['osv', 'gitleaks', 'checkov', 'licenses', 'sbom']) {
  test(`a missing ${tool} report blocks completeness`, () => {
    const manifest = buildManifest(withoutTool(tool));
    assert.equal(manifest.complete, false);
    assert.ok(reasonsFor(manifest, tool).length > 0, `expected a reason naming ${tool}`);
  });
}

test('records one entry per scanner with path, digest, category and expected flag', () => {
  const manifest = buildManifest(baseInput());
  assert.equal(manifest.scanners.length, REQUIRED_TOOLS.length);
  const osv = manifest.scanners.find((entry) => entry.tool === 'osv');
  assert.deepEqual(osv, {
    tool: 'osv',
    category: 'production',
    reportPath: 'security-reports/osv.json',
    status: 'success',
    digest: DIGESTS.osv,
    bytes: 512,
    fixture: false,
    expected: true,
  });
});

test('duplicate production reports for one tool block completeness', () => {
  const input = baseInput();
  input.reports.push(report('osv', { path: 'security-reports/osv-copy.sarif' }));
  const manifest = buildManifest(input);
  assert.equal(manifest.complete, false);
  assert.ok(manifest.incompleteReason.some((r) => r.includes('duplicate')));
});

test('an unknown extra tool is recorded but is not expected and does not block', () => {
  const input = baseInput();
  input.reports.push(report('trivy', { digest: 'f'.repeat(64) }));
  const manifest = buildManifest(input);
  assert.equal(manifest.complete, true);
  const trivy = manifest.scanners.find((entry) => entry.tool === 'trivy');
  assert.equal(trivy.expected, false);
});

// ---------------------------------------------------------------------------
// Rejected report states
// ---------------------------------------------------------------------------

test('a failed scanner blocks completeness', () => {
  const manifest = buildManifest(replaceTool('checkov', { status: 'failure' }));
  assert.equal(manifest.complete, false);
  assert.ok(reasonsFor(manifest, 'checkov').some((r) => r.includes('failure')));
});

test('a skipped scanner blocks completeness', () => {
  const manifest = buildManifest(replaceTool('gitleaks', { status: 'skipped' }));
  assert.equal(manifest.complete, false);
  assert.ok(reasonsFor(manifest, 'gitleaks').some((r) => r.includes('skipped')));
});

test('a cancelled scanner blocks completeness', () => {
  const manifest = buildManifest(replaceTool('osv', { status: 'cancelled' }));
  assert.equal(manifest.complete, false);
  assert.ok(reasonsFor(manifest, 'osv').some((r) => r.includes('cancelled')));
});

test('an empty report blocks completeness', () => {
  const manifest = buildManifest(replaceTool('sbom', { bytes: 0 }));
  assert.equal(manifest.complete, false);
  assert.ok(reasonsFor(manifest, 'sbom').some((r) => r.includes('empty')));
});

test('a malformed report blocks completeness', () => {
  const manifest = buildManifest(replaceTool('licenses', { malformed: true }));
  assert.equal(manifest.complete, false);
  assert.ok(reasonsFor(manifest, 'licenses').some((r) => r.includes('malformed')));
});

test('a report without a path blocks completeness', () => {
  const manifest = buildManifest(replaceTool('osv', { path: '' }));
  assert.equal(manifest.complete, false);
  assert.ok(reasonsFor(manifest, 'osv').some((r) => r.includes('path')));
});

// ---------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------

test('a missing digest blocks completeness', () => {
  const manifest = buildManifest(replaceTool('gitleaks', { digest: null }));
  assert.equal(manifest.complete, false);
  assert.ok(reasonsFor(manifest, 'gitleaks').some((r) => r.includes('digest')));
});

test('a non sha-256 digest blocks completeness', () => {
  const manifest = buildManifest(replaceTool('gitleaks', { digest: 'not-a-digest' }));
  assert.equal(manifest.complete, false);
  assert.ok(reasonsFor(manifest, 'gitleaks').some((r) => r.includes('digest')));
});

test('a declared digest that differs from the actual digest blocks completeness', () => {
  const manifest = buildManifest(
    replaceTool('checkov', { expectedDigest: '1'.repeat(64) }),
  );
  assert.equal(manifest.complete, false);
  assert.ok(reasonsFor(manifest, 'checkov').some((r) => r.includes('digest mismatch')));
});

test('a declared digest that matches (case-insensitively) keeps the run complete', () => {
  const manifest = buildManifest(
    replaceTool('checkov', { expectedDigest: DIGESTS.checkov.toUpperCase() }),
  );
  assert.equal(manifest.complete, true);
});

// ---------------------------------------------------------------------------
// Fixtures never prove production completeness
// ---------------------------------------------------------------------------

test('a fixture report cannot satisfy a required production scanner', () => {
  const manifest = buildManifest(
    baseInput({
      reports: REQUIRED_TOOLS.map((tool) =>
        tool === 'osv' ? report(tool, { fixture: true }) : report(tool),
      ),
    }),
  );
  assert.equal(manifest.complete, false);
  assert.ok(reasonsFor(manifest, 'osv').length > 0);
});

test('a fixture report is recorded with fixture: true, category fixture and expected: false', () => {
  const input = baseInput();
  input.reports.push(report('osv', { fixture: true, path: 'security-reports/fixture-osv.sarif' }));
  const manifest = buildManifest(input);
  const fixture = manifest.scanners.find((entry) => entry.fixture === true);
  assert.equal(fixture.category, 'fixture');
  assert.equal(fixture.expected, false);
  assert.equal(manifest.complete, true, 'an extra fixture report must not break a complete run');
});

test('category: fixture is treated as a fixture even without the fixture flag', () => {
  const manifest = buildManifest(replaceTool('sbom', { category: 'fixture' }));
  assert.equal(manifest.complete, false);
  const entry = manifest.scanners.find((s) => s.tool === 'sbom');
  assert.equal(entry.fixture, true);
  assert.equal(entry.expected, false);
});

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

test('records head SHA, ref, run id, tool versions and generation time', () => {
  const manifest = buildManifest(baseInput());
  assert.equal(manifest.headSha, '9'.repeat(40));
  assert.equal(manifest.ref, 'refs/heads/master');
  assert.equal(manifest.runId, '1234567890');
  assert.equal(manifest.generationTime, '2026-08-29T04:17:00.000Z');
  assert.deepEqual(manifest.toolVersions, {
    osv: '2.5.1',
    gitleaks: '8.30.1',
    checkov: '3.3.16',
    cyclonedx: '6.0.1',
  });
});

for (const field of ['headSha', 'ref', 'runId']) {
  test(`a missing ${field} blocks completeness`, () => {
    const manifest = buildManifest(baseInput({ [field]: '' }));
    assert.equal(manifest.complete, false);
    assert.ok(manifest.incompleteReason.some((r) => r.includes(field)));
  });
}

test('an unparseable generation time blocks completeness', () => {
  const manifest = buildManifest(baseInput({ generationTime: 'yesterday' }));
  assert.equal(manifest.complete, false);
  assert.ok(manifest.incompleteReason.some((r) => r.includes('generationTime')));
});

test('a missing tool version blocks completeness', () => {
  const manifest = buildManifest(
    baseInput({ toolVersions: { osv: '2.5.1', gitleaks: '8.30.1', checkov: '3.3.16' } }),
  );
  assert.equal(manifest.complete, false);
  assert.ok(manifest.incompleteReason.some((r) => r.includes('cyclonedx')));
});

// ---------------------------------------------------------------------------
// Policy verdict
// ---------------------------------------------------------------------------

test('a blocking verdict is recorded but does not make the manifest incomplete', () => {
  const manifest = buildManifest(
    baseInput({ policy: { verdict: 'blocking', blockedCount: 4, reportedCount: 11 } }),
  );
  assert.equal(manifest.complete, true);
  assert.deepEqual(manifest.policy, {
    verdict: 'blocking',
    blockedCount: 4,
    reportedCount: 11,
  });
});

test('a missing policy verdict blocks completeness', () => {
  const manifest = buildManifest(baseInput({ policy: undefined }));
  assert.equal(manifest.complete, false);
  assert.ok(manifest.incompleteReason.some((r) => r.startsWith('policy:')));
});

test('an unknown verdict blocks completeness', () => {
  const manifest = buildManifest(
    baseInput({ policy: { verdict: 'probably-fine', blockedCount: 0, reportedCount: 0 } }),
  );
  assert.equal(manifest.complete, false);
  assert.ok(manifest.incompleteReason.some((r) => r.startsWith('policy:')));
});

test('a clean verdict that contradicts a nonzero blocked count blocks completeness', () => {
  const manifest = buildManifest(
    baseInput({ policy: { verdict: 'clean', blockedCount: 2, reportedCount: 0 } }),
  );
  assert.equal(manifest.complete, false);
  assert.ok(manifest.incompleteReason.some((r) => r.startsWith('policy:')));
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

test('buildManifest does not mutate its input', () => {
  const input = baseInput();
  const snapshot = JSON.stringify(input);
  buildManifest(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('buildManifest throws on non-object input', () => {
  assert.throws(() => buildManifest(null), TypeError);
  assert.throws(() => buildManifest([]), TypeError);
});

test('buildManifest throws when a report has no tool name', () => {
  assert.throws(() => buildManifest(baseInput({ reports: [{ path: 'x' }] })), TypeError);
});

test('a missing reports array blocks completeness', () => {
  const manifest = buildManifest(baseInput({ reports: undefined }));
  assert.equal(manifest.complete, false);
  assert.deepEqual(manifest.scanners, []);
});

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

test('writeManifestFile writes atomically and leaves no temp file behind', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'manifest-write-'));
  const target = join(dir, 'nested', 'production-manifest.json');
  writeManifestFile(target, buildManifest(baseInput()));
  assert.deepEqual(fs.readdirSync(dirname(target)), ['production-manifest.json']);
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).complete, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const SARIF = JSON.stringify({ version: '2.1.0', runs: [] });

function makeWorkspace(files) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'manifest-cli-'));
  fs.mkdirSync(join(dir, 'security-reports'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(join(dir, 'security-reports', name), content);
  }
  return dir;
}

function defaultFiles() {
  return {
    'osv.sarif': SARIF,
    'gitleaks.sarif': SARIF,
    'checkov.sarif': SARIF,
    'license-policy.json': JSON.stringify({ blocked: [], reported: [] }),
    'sbom.cdx.json': JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6' }),
  };
}

const REPORT_FILES = {
  osv: 'osv.sarif',
  gitleaks: 'gitleaks.sarif',
  checkov: 'checkov.sarif',
  licenses: 'license-policy.json',
  sbom: 'sbom.cdx.json',
};

function runCli(dir, extraArgs = [], env = {}) {
  const args = [SCRIPT_PATH, '--output', 'security-reports/production-manifest.json'];
  for (const [tool, file] of Object.entries(REPORT_FILES)) {
    args.push('--report', `${tool}=security-reports/${file}`, '--status', `${tool}=success`);
  }
  args.push(
    '--tool-version', 'osv=2.5.1',
    '--tool-version', 'gitleaks=8.30.1',
    '--tool-version', 'checkov=3.3.16',
    '--tool-version', 'cyclonedx=6.0.1',
    '--verdict', 'clean',
    '--blocked', '0',
    '--reported', '0',
  );
  args.push(...extraArgs);
  const result = spawnSync(process.execPath, args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_SHA: '9'.repeat(40),
      GITHUB_REF: 'refs/heads/master',
      GITHUB_RUN_ID: '424242',
      ...env,
    },
  });
  const manifestPath = join(dir, 'security-reports', 'production-manifest.json');
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : null;
  return { ...result, manifest, dir };
}

test('CLI writes a complete manifest and exits 0 when every report is present', () => {
  const dir = makeWorkspace(defaultFiles());
  const { status, manifest } = runCli(dir);
  assert.equal(status, 0);
  assert.equal(manifest.complete, true);
  assert.deepEqual(manifest.incompleteReason, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI reads head SHA, ref and run id from the GitHub environment', () => {
  const dir = makeWorkspace(defaultFiles());
  const { manifest } = runCli(dir);
  assert.equal(manifest.headSha, '9'.repeat(40));
  assert.equal(manifest.ref, 'refs/heads/master');
  assert.equal(manifest.runId, '424242');
  assert.ok(!Number.isNaN(Date.parse(manifest.generationTime)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI computes the SHA-256 digest of every report it records', () => {
  const dir = makeWorkspace(defaultFiles());
  const { manifest } = runCli(dir);
  const expected = createHash('sha256').update(SARIF).digest('hex');
  const osv = manifest.scanners.find((entry) => entry.tool === 'osv');
  assert.equal(osv.digest, expected);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits nonzero and still writes the manifest when a report is missing', () => {
  const files = defaultFiles();
  delete files['gitleaks.sarif'];
  const dir = makeWorkspace(files);
  const { status, manifest } = runCli(dir);
  assert.notEqual(status, 0);
  assert.equal(manifest.complete, false);
  assert.ok(manifest.incompleteReason.some((r) => r.startsWith('gitleaks:')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits nonzero when a scanner job reported failure', () => {
  const dir = makeWorkspace(defaultFiles());
  const { status, manifest } = runCli(dir, ['--status', 'checkov=failure']);
  assert.notEqual(status, 0);
  assert.equal(manifest.complete, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI rejects an empty report file', () => {
  const files = defaultFiles();
  files['sbom.cdx.json'] = '';
  const dir = makeWorkspace(files);
  const { status, manifest } = runCli(dir);
  assert.notEqual(status, 0);
  assert.ok(manifest.incompleteReason.some((r) => r.includes('empty')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI rejects a malformed JSON report', () => {
  const files = defaultFiles();
  files['checkov.sarif'] = '{ "version": "2.1.0", ';
  const dir = makeWorkspace(files);
  const { status, manifest } = runCli(dir);
  assert.notEqual(status, 0);
  assert.ok(manifest.incompleteReason.some((r) => r.includes('malformed')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI fails when a declared digest does not match the report on disk', () => {
  const dir = makeWorkspace(defaultFiles());
  const { status, manifest } = runCli(dir, ['--digest', `osv=${'1'.repeat(64)}`]);
  assert.notEqual(status, 0);
  assert.ok(manifest.incompleteReason.some((r) => r.includes('digest mismatch')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI accepts a declared digest that matches the report on disk', () => {
  const dir = makeWorkspace(defaultFiles());
  const digest = createHash('sha256').update(SARIF).digest('hex');
  const { status, manifest } = runCli(dir, ['--digest', `osv=${digest}`]);
  assert.equal(status, 0);
  assert.equal(manifest.complete, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI marks a report as a fixture and refuses to call the run complete', () => {
  const dir = makeWorkspace(defaultFiles());
  const { status, manifest } = runCli(dir, ['--fixture', 'osv']);
  assert.notEqual(status, 0);
  const osv = manifest.scanners.find((entry) => entry.tool === 'osv');
  assert.equal(osv.fixture, true);
  assert.equal(osv.category, 'fixture');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI derives the policy verdict from evaluator summary files', () => {
  const files = defaultFiles();
  files['osv-policy.json'] = JSON.stringify({
    counts: { blocked: 2, reported: 5, errors: 0 },
  });
  files['license-summary.json'] = JSON.stringify({
    summary: { totalBlocked: 0, totalReported: 1 },
  });
  const dir = makeWorkspace(files);
  const { status, manifest } = runCli(dir, [
    '--policy', 'security-reports/osv-policy.json',
    '--policy', 'security-reports/license-summary.json',
  ]);
  assert.equal(status, 0, 'a blocking verdict must not make the evidence incomplete');
  assert.deepEqual(manifest.policy, {
    verdict: 'blocking',
    blockedCount: 2,
    reportedCount: 6,
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI leaves no temporary file next to the manifest', () => {
  const dir = makeWorkspace(defaultFiles());
  runCli(dir);
  const entries = fs.readdirSync(join(dir, 'security-reports'));
  assert.ok(!entries.some((name) => name.includes('.tmp')), entries.join(', '));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits nonzero when the GitHub environment is missing', () => {
  const dir = makeWorkspace(defaultFiles());
  const { status, manifest } = runCli(dir, [], { GITHUB_RUN_ID: '' });
  assert.notEqual(status, 0);
  assert.ok(manifest.incompleteReason.some((r) => r.includes('runId')));
  fs.rmSync(dir, { recursive: true, force: true });
});
