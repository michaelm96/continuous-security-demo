import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, 'install-gitleaks.sh');
const SCRIPT_TEXT = readFileSync(SCRIPT_PATH, 'utf8');

const EXPECTED_VERSION = '8.30.1';
const EXPECTED_SHA = '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb';
const EXPECTED_URL =
  'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz';
const GITLEAKS_BIN = process.env.GITLEAKS_BIN || 'gitleaks';

test('installer pins the exact version literal 8.30.1', () => {
  assert.match(SCRIPT_TEXT, new RegExp(`\\b${EXPECTED_VERSION.replace(/\./g, '\\.')}\\b`));
});

test('installer pins the exact SHA-256 digest', () => {
  assert.ok(
    SCRIPT_TEXT.includes(EXPECTED_SHA),
    'install-gitleaks.sh must contain the expected SHA-256 literal'
  );
});

test('installer verifies the archive before extraction (sha256sum -c)', () => {
  assert.match(SCRIPT_TEXT, /sha256sum\s+-c/);
});

test('installer uses curl --fail --show-error --location', () => {
  assert.match(SCRIPT_TEXT, /curl\b[^\n]*--fail[^\n]*--show-error[^\n]*--location/s);
});

test('installer pins the exact immutable GitHub release URL', () => {
  assert.ok(
    SCRIPT_TEXT.includes(EXPECTED_URL),
    'install-gitleaks.sh must reference the exact pinned GitHub release URL'
  );
});

test('installer never pipes curl into a shell', () => {
  assert.doesNotMatch(
    SCRIPT_TEXT,
    /\bcurl\b[^\n|]*\|\s*(sh|bash)\b/,
    'curl|sh / curl|bash are forbidden — always verify before executing'
  );
});

test('installer references no mutable release paths (latest, main, master, HEAD)', () => {
  for (const mutable of ['latest', 'main', 'master', 'HEAD']) {
    assert.doesNotMatch(
      SCRIPT_TEXT,
      new RegExp(`/${mutable}/`),
      `installer must not reference /${mutable}/ as a release ref`
    );
  }
});

test('installer creates a temp directory with mktemp and cleans it via trap', () => {
  assert.match(SCRIPT_TEXT, /\bmktemp\b/);
  assert.match(SCRIPT_TEXT, /\btrap\b[^\n]*\brm\b/);
});

test('installer writes the binary to a caller-supplied dir (default $HOME/.local/bin)', () => {
  assert.match(SCRIPT_TEXT, /\$\{?1(:-|\?:=)\}?/);
  assert.ok(
    SCRIPT_TEXT.includes('$HOME/.local/bin'),
    'install-gitleaks.sh must default the install dir to $HOME/.local/bin'
  );
});

test('installer prints gitleaks version after install', () => {
  assert.match(SCRIPT_TEXT, /\bgitleaks\b[^\n]*\bversion\b/);
});

// ---- Runtime: synthetic-secret sanitization test (runs only when gitleaks is installed) ----

function gitleaksAvailable() {
  const r = spawnSync(GITLEAKS_BIN, ['version'], { stdio: 'pipe' });
  return r.status === 0;
}

test(
  'runtime: gitleaks detects a synthetic secret, exits nonzero, and never leaks plaintext',
  { skip: !gitleaksAvailable() && 'gitleaks not installed (run scripts/security/install-gitleaks.sh)' },
  async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmp = mkdtempSync(join(tmpdir(), 'gitleaks-fixture-'));
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const sarifPath = join(tmp, 'report.sarif');

    try {
      execFileSync('git', ['init', '-q', '-b', 'main', tmp]);
      writeFileSync(join(tmp, 'sample.env'), `aws_access_key_id="${secret}"\n`);
      execFileSync('git', ['-C', tmp, 'add', 'sample.env']);
      execFileSync('git', ['-C', tmp, 'config', 'user.email', 't@t']);
      execFileSync('git', ['-C', tmp, 'config', 'user.name', 't']);
      execFileSync('git', ['-C', tmp, 'commit', '-q', '-m', 'fixture']);

      const proc = spawnSync(
        GITLEAKS_BIN,
        [
          'git',
          '--source', tmp,
          '--config', resolve(__dirname, '..', '..', '.gitleaks.toml'),
          '--report-format', 'sarif',
          '--report-path', sarifPath,
          '--redact=100',
          '--no-banner',
        ],
        { encoding: 'utf8' }
      );

      assert.notEqual(proc.status, 0, 'gitleaks must exit nonzero when secrets are found');
      assert.ok(proc.stderr || proc.stdout, 'gitleaks should emit a summary');

      const sarif = readFileSync(sarifPath, 'utf8');
      assert.ok(!sarif.includes(secret), 'SARIF report leaked plaintext secret');

      const stdout = proc.stdout || '';
      const stderr = proc.stderr || '';
      assert.ok(!stdout.includes(secret), 'stdout leaked plaintext secret');
      assert.ok(!stderr.includes(secret), 'stderr leaked plaintext secret');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
);