import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import { evaluateSarif, normalizeSarif, readSarif } from './sarif-policy.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, 'fixtures');

/**
 * Build a single SARIF result with severity on result.properties['security-severity']
 * (the OSV-Scanner convention used by this project).
 */
function sarifResult(severity, extra = {}) {
  const base = {
    ruleId: 'TEST-RULE',
    level: 'error',
    message: { text: 'demo finding' },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: 'package-lock.json' },
          region: { startLine: 1 },
        },
      },
    ],
    partialFingerprints: { primary: 'fp-' + Math.random().toString(36).slice(2) },
    properties: { 'security-severity': severity },
  };
  return { ...base, ...extra };
}

/**
 * Wrap a list of results in a minimal valid SARIF v2.1.0 log.
 */
function wrap(results, runsExtra = {}) {
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'test-tool', version: '0.0.0' } },
        results,
        ...runsExtra,
      },
    ],
  };
}

// ---------- core numeric threshold ----------

test('blocks a security-severity of 7.0 or higher', () => {
  const out = evaluateSarif([sarifResult('7.0')], 7);
  assert.equal(out.blocked.length, 1);
  assert.equal(out.reported.length, 0);
});

test('blocks a security-severity above 7.0', () => {
  assert.equal(evaluateSarif([sarifResult('9.5')], 7).blocked.length, 1);
});

test('reports but does not block severity below 7.0', () => {
  assert.equal(evaluateSarif([sarifResult('6.9')], 7).blocked.length, 0);
  assert.equal(evaluateSarif([sarifResult('6.9')], 7).reported.length, 1);
});

test('reports severity of exactly 0.0 (informational)', () => {
  const out = evaluateSarif([sarifResult('0.0')], 7);
  assert.equal(out.blocked.length, 0);
  assert.equal(out.reported.length, 1);
});

test('uses default threshold of 7.0', () => {
  const out = evaluateSarif([sarifResult('6.99')]);
  assert.equal(out.blocked.length, 0);
  assert.equal(out.reported.length, 1);
});

test('returns blocked, reported, and errors arrays', () => {
  assert.deepEqual(evaluateSarif([], 7), {
    blocked: [],
    reported: [],
    errors: [],
  });
});

// ---------- malformed input ----------

test('rejects malformed or missing SARIF instead of treating it as clean', () => {
  // Pass as SARIF log (object), not results array
  assert.throws(() => evaluateSarif({ version: '2.0.0' }, 7));
});

test('rejects SARIF log with wrong version', () => {
  assert.throws(() =>
    evaluateSarif({ version: '2.0.0', runs: [] }, 7),
  );
});

test('rejects SARIF log missing runs', () => {
  assert.throws(() => evaluateSarif({ version: '2.1.0' }, 7));
});

test('treats non-numeric severity as unknown', () => {
  // Non-numeric severity is treated as unknown, blocks when no classification
  const out = evaluateSarif([sarifResult('not-a-number')], 7);
  // Without classification, unknown severity blocks
  assert.equal(out.blocked.length, 1);
  assert.equal(out.errors.length, 1);
});

test('rejects negative severity', () => {
  assert.throws(() => evaluateSarif([sarifResult('-1')], 7));
});

test('rejects severity above 10', () => {
  assert.throws(() => evaluateSarif([sarifResult('11')], 7));
});

// ---------- severity lookup ----------

test('reads severity from result.properties["security-severity"]', () => {
  const result = sarifResult('8.5');
  const out = evaluateSarif([result], 7);
  assert.equal(out.blocked.length, 1);
  assert.equal(out.blocked[0].severity, 8.5);
});

test('reads severity from referenced rule properties when result lacks it', () => {
  const sarif = {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'test',
            rules: [
              { id: 'R1', properties: { 'security-severity': '9.0' } },
            ],
          },
        },
        results: [{ ruleId: 'R1', message: { text: 'm' } }],
      },
    ],
  };
  const out = evaluateSarif(normalizeSarif(sarif), 7);
  assert.equal(out.blocked.length, 1);
});

// ---------- unknown severity with classification ----------

test('blocks unknown-severity results for production dependencies', () => {
  const result = sarifResult(null);
  // Implementation uses classification[location] - pass as object
  const out = evaluateSarif([result], 7, {
    classification: { 'package-lock.json': 'production' },
  });
  assert.equal(out.blocked.length, 1);
});

test('reports but does not block unknown-severity results for dev dependencies', () => {
  const result = sarifResult(null);
  // Implementation uses classification[location] - pass as object
  const out = evaluateSarif([result], 7, {
    classification: { 'package-lock.json': 'development' },
  });
  assert.equal(out.blocked.length, 0);
  assert.equal(out.reported.length, 1);
});

// ---------- Checkov missing severity ----------

test('blocks Checkov results without trustworthy severity', () => {
  const result = {
    ruleId: 'CKV_GHA_2',
    level: 'error',
    message: { text: 'unsafe workflow' },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: '.github/workflows/x.yml' },
          region: { startLine: 12 },
        },
      },
    ],
    properties: {},
  };
  const out = evaluateSarif([result], 7, { checkov: true });
  assert.equal(out.blocked.length, 1);
  assert.equal(out.blocked[0].scanner, 'checkov');
});

// ---------- fixtures ----------

test('blocks a high-severity fixture result', () => {
  const log = JSON.parse(
    readFileSync(resolve(FIXTURES, 'sarif-high-severity.json'), 'utf8'),
  );
  const out = evaluateSarif(normalizeSarif(log), 7);
  assert.equal(out.blocked.length, 1);
  assert.equal(out.blocked[0].ruleId, 'OSV-VULN-2024-1234');
});

test('reports a moderate-severity fixture result', () => {
  const log = JSON.parse(
    readFileSync(resolve(FIXTURES, 'sarif-moderate.json'), 'utf8'),
  );
  const out = evaluateSarif(normalizeSarif(log), 7);
  assert.equal(out.blocked.length, 0);
  assert.equal(out.reported.length, 1);
});

test('blocks an unknown-severity production fixture', () => {
  const log = JSON.parse(
    readFileSync(
      resolve(FIXTURES, 'sarif-unknown-production.json'),
      'utf8',
    ),
  );
  const out = evaluateSarif(normalizeSarif(log), 7, {
    classification: { 'package-lock.json': 'production' },
  });
  assert.equal(out.blocked.length, 1);
});

test('reports an unknown-severity dev fixture', () => {
  const log = JSON.parse(
    readFileSync(resolve(FIXTURES, 'sarif-unknown-dev.json'), 'utf8'),
  );
  const out = evaluateSarif(normalizeSarif(log), 7, {
    classification: { 'package-lock.json': 'development' },
  });
  assert.equal(out.blocked.length, 0);
  assert.equal(out.reported.length, 1);
});

test('blocks a Checkov missing-severity fixture', () => {
  const log = JSON.parse(
    readFileSync(
      resolve(FIXTURES, 'sarif-checkov-missing-severity.json'),
      'utf8',
    ),
  );
  const out = evaluateSarif(normalizeSarif(log), 7, { checkov: true });
  assert.equal(out.blocked.length, 1);
});

test('rejects malformed SARIF fixture', () => {
  const log = JSON.parse(
    readFileSync(resolve(FIXTURES, 'sarif-malformed.json'), 'utf8'),
  );
  assert.throws(() => normalizeSarif(log));
});

// ---------- I/O ----------

test('readSarif loads a SARIF file from disk and normalizes it', () => {
  const normalized = readSarif(
    resolve(FIXTURES, 'sarif-high-severity.json'),
  );
  assert.ok(Array.isArray(normalized));
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].severity, 9.8);
});

test('readSarif throws when file is missing', () => {
  assert.throws(() =>
    readSarif(resolve(FIXTURES, 'does-not-exist.json')),
  );
});

test('readSarif throws when JSON is malformed', () => {
  const tmp = resolve(FIXTURES, '..', '.tmp-not-json.sarif');
  writeFileSync(tmp, 'not-json{');
  try {
    assert.throws(() => readSarif(tmp));
  } finally {
    unlinkSync(tmp);
  }
});

// ---------- behavior ----------

test('deduplicates repeated results by fingerprint', () => {
  const fp = { partialFingerprints: { primary: 'shared-fp' } };
  const a = sarifResult('8.0', fp);
  const b = sarifResult('8.0', fp);
  const out = evaluateSarif([a, b], 7);
  assert.equal(out.blocked.length, 1);
});

test('preserves tool, rule, level, location, message, and fingerprint', () => {
  const sarif = {
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'demo-scanner', version: '1.2.3' } },
        results: [
          {
            ruleId: 'DEMO-1',
            level: 'warning',
            message: { text: 'demo issue' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'app.js' },
                  region: { startLine: 42 },
                },
              },
            ],
            partialFingerprints: { primary: 'fp-1' },
            properties: { 'security-severity': '8.5' },
          },
        ],
      },
    ],
  };
  const out = evaluateSarif(normalizeSarif(sarif), 7);
  assert.equal(out.blocked.length, 1);
  const finding = out.blocked[0];
  assert.equal(finding.scanner, 'demo-scanner');
  assert.equal(finding.ruleId, 'DEMO-1');
  assert.equal(finding.level, 'warning');
  assert.equal(finding.location, 'app.js');
  assert.equal(finding.line, 42);
  assert.equal(finding.message, 'demo issue');
  assert.equal(finding.fingerprint, 'fp-1');
});

test('handles SARIF with multiple runs', () => {
  const sarif = {
    version: '2.1.0',
    runs: [
      { tool: { driver: { name: 'a' } }, results: [sarifResult('8.0')] },
      { tool: { driver: { name: 'b' } }, results: [sarifResult('9.0')] },
    ],
  };
  const out = evaluateSarif(normalizeSarif(sarif), 7);
  assert.equal(out.blocked.length, 2);
});

// ---------- secret safety ----------

test('does not include secret-looking substrings in output', () => {
  const fakeSecret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz1234';
  const sarif = wrap([
    {
      ruleId: 'LEAK',
      level: 'error',
      message: { text: `token: ${fakeSecret}` },
      properties: { 'security-severity': '9.0' },
    },
  ]);
  const out = evaluateSarif(normalizeSarif(sarif), 7);
  const serialized = JSON.stringify(out);
  assert.equal(serialized.includes(fakeSecret), false);
});
