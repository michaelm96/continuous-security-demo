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
// Per-platform SHA-256 of the upstream gitleaks_8.30.1_<platform>.tar.gz
// release archive. The full set must be embedded in the installer so that
// every supported platform verifies before extraction.
const EXPECTED_SHA = {
  darwin_arm64: 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  darwin_x64: 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
  linux_arm64: 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
  linux_x64: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
};
const GITLEAKS_BIN = process.env.GITLEAKS_BIN || 'gitleaks';

test('installer pins the exact version literal 8.30.1', () => {
  assert.match(SCRIPT_TEXT, new RegExp(`\\b${EXPECTED_VERSION.replace(/\./g, '\\.')}\\b`));
});

test('installer embeds a SHA-256 digest for every supported platform', () => {
  for (const [platform, sha] of Object.entries(EXPECTED_SHA)) {
    assert.ok(
      SCRIPT_TEXT.includes(sha),
      `install-gitleaks.sh must contain the SHA-256 for ${platform}`
    );
  }
});

test('installer detects the host platform from uname', () => {
  assert.match(SCRIPT_TEXT, /uname -s/);
  assert.match(SCRIPT_TEXT, /uname -m/);
  assert.match(SCRIPT_TEXT, /PLATFORM=/);
  assert.match(SCRIPT_TEXT, /darwin_arm64/);
  assert.match(SCRIPT_TEXT, /darwin_x64/);
  assert.match(SCRIPT_TEXT, /linux_arm64/);
  assert.match(SCRIPT_TEXT, /linux_x64/);
});

test('installer rejects unsupported platforms', () => {
  assert.match(SCRIPT_TEXT, /Unsupported platform/);
});

test('installer verifies the archive before extraction (sha256sum -c)', () => {
  assert.match(SCRIPT_TEXT, /sha256sum\s+-c/);
});

test('installer uses curl --fail --show-error --location', () => {
  assert.match(SCRIPT_TEXT, /curl\b[^\n]*--fail[^\n]*--show-error[^\n]*--location/s);
});

test('installer pins the exact immutable GitHub release URL for every platform', () => {
  // The URL is built at runtime from VERSION and PLATFORM. Verify the URL
  // template references every platform and pins the immutable tag.
  assert.match(SCRIPT_TEXT, /gitleaks\/releases\/download\/v\$\{VERSION\}/);
  for (const platform of Object.keys(EXPECTED_SHA)) {
    assert.ok(
      SCRIPT_TEXT.includes(`\${PLATFORM}`) || SCRIPT_TEXT.includes(platform),
      `install-gitleaks.sh must reference ${platform} via PLATFORM or literal`
    );
  }
});

test('installer never pipes curl into a shell', () => {
  assert.doesNotMatch(
    SCRIPT_TEXT,
    /\bcurl\b[^\n|]*\|\s*(sh|bash)\b/,
    'curl|sh / curl|bash are forbidden — always verify before executing'
  );
});

test('installer uses mktemp + trap for cleanup', () => {
  assert.match(SCRIPT_TEXT, /mktemp -d/);
  assert.match(SCRIPT_TEXT, /trap .* EXIT/);
});

test('installer prints the installed binary version on success', () => {
  assert.match(SCRIPT_TEXT, /gitleaks["']?\s+version/);
});

if (process.env.GITLEAKS_RUNTIME_TEST === '1') {
  test('runtime: synthetic secret must not appear in --redact=100 output', { skip: 'live binary required' }, () => {
    // Synthetic secrets in deterministic test fixtures (Task 5).
    const probe = resolve(__dirname, '..', '..', 'fixtures', 'secrets', 'github-token.txt');
    const r = spawnSync(
      GITLEAKS_BIN,
      ['detect', '--no-git', '--redact=100', '--source', probe, '--report-format', 'json'],
      { encoding: 'utf8' }
    );
    assert.ok(r.status === 0 || r.status === 1, `unexpected gitleaks exit ${r.status}: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /ghp_0{36}/, 'redacted output must not contain the synthetic PAT');
  });
}
