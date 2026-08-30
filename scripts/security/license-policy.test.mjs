import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLicense, evaluatePackages } from './license-policy.mjs';

// Helper to create a package record similar to npm query output
function pkg(name, version, license, isDev = false) {
  return {
    name,
    version,
    license,
    dev: isDev
  };
}

test('MIT license is permitted', () => {
  const result = classifyLicense('MIT');
  assert.equal(result.classification, 'permitted');
});

test('Apache-2.0 license is permitted', () => {
  const result = classifyLicense('Apache-2.0');
  assert.equal(result.classification, 'permitted');
});

test('ISC license is permitted', () => {
  const result = classifyLicense('ISC');
  assert.equal(result.classification, 'permitted');
});

test('BSD-2-Clause license is permitted', () => {
  const result = classifyLicense('BSD-2-Clause');
  assert.equal(result.classification, 'permitted');
});

test('BSD-3-Clause license is permitted', () => {
  const result = classifyLicense('BSD-3-Clause');
  assert.equal(result.classification, 'permitted');
});

test('CC0-1.0 license is permitted', () => {
  const result = classifyLicense('CC0-1.0');
  assert.equal(result.classification, 'permitted');
});

test('Unlicense license is permitted', () => {
  const result = classifyLicense('Unlicense');
  assert.equal(result.classification, 'permitted');
});

test('WTFPL license is permitted', () => {
  const result = classifyLicense('WTFPL');
  assert.equal(result.classification, 'permitted');
});

test('0BSD license is permitted', () => {
  const result = classifyLicense('0BSD');
  assert.equal(result.classification, 'permitted');
});

test('AGPL-3.0 is reported as restricted', () => {
  const result = classifyLicense('AGPL-3.0');
  assert.equal(result.classification, 'restricted');
});

test('AGPL-3.0-only is reported as restricted', () => {
  const result = classifyLicense('AGPL-3.0-only');
  assert.equal(result.classification, 'restricted');
});

test('SSPL-1.0 is reported as restricted', () => {
  const result = classifyLicense('SSPL-1.0');
  assert.equal(result.classification, 'restricted');
});

test('BUSL-1.1 is reported as restricted', () => {
  const result = classifyLicense('BUSL-1.1');
  assert.equal(result.classification, 'restricted');
});

test('Elastic-2.0 is reported as restricted', () => {
  const result = classifyLicense('Elastic-2.0');
  assert.equal(result.classification, 'restricted');
});

test('Commons-Clause-1.0 is reported as restricted', () => {
  const result = classifyLicense('Commons-Clause-1.0');
  assert.equal(result.classification, 'restricted');
});

test('CC-BY-NC-4.0 is reported as non-commercial', () => {
  const result = classifyLicense('CC-BY-NC-4.0');
  assert.equal(result.classification, 'non-commercial');
});

test('license with Non-Commercial is reported', () => {
  const result = classifyLicense('SomeLicense AND Non-Commercial');
  assert.equal(result.classification, 'non-commercial');
});

test('string containing Non-Commercial blocks', () => {
  const result = classifyLicense('PolyForm Non-Commercial');
  assert.equal(result.classification, 'non-commercial');
});

test('unknown license is reported', () => {
  const result = classifyLicense('UNKNOWN-LICENSE-XYZ');
  assert.equal(result.classification, 'unknown');
});

test('null license is reported', () => {
  const result = classifyLicense(null);
  assert.equal(result.classification, 'unknown');
});

test('undefined license is reported', () => {
  const result = classifyLicense(undefined);
  assert.equal(result.classification, 'unknown');
});

test('empty string license is reported', () => {
  const result = classifyLicense('');
  assert.equal(result.classification, 'unknown');
});

test('MIT OR Apache-2.0 compound license is permitted', () => {
  const result = classifyLicense('(MIT OR Apache-2.0)');
  assert.equal(result.classification, 'permitted');
});

test('MIT AND Apache-2.0 compound license is permitted', () => {
  const result = classifyLicense('(MIT AND Apache-2.0)');
  assert.equal(result.classification, 'permitted');
});

test('GPL-3.0 is reported as restricted', () => {
  const result = classifyLicense('GPL-3.0');
  assert.equal(result.classification, 'restricted');
});

test('LGPL-3.0 is reported as restricted', () => {
  const result = classifyLicense('LGPL-3.0');
  assert.equal(result.classification, 'restricted');
});

test('MPL-2.0 is permitted', () => {
  const result = classifyLicense('MPL-2.0');
  assert.equal(result.classification, 'permitted');
});

test('returns source in result', () => {
  const result = classifyLicense('MIT');
  assert.ok(result.source);
});

test('evaluatePackages blocks restricted production deps', () => {
  const packages = [
    pkg('restricted-pkg', '1.0.0', 'AGPL-3.0', false)
  ];
  const result = evaluatePackages(packages, 'production');
  assert.equal(result.blocked.length, 1);
  assert.equal(result.reported.length, 0);
});

test('evaluatePackages reports restricted dev deps', () => {
  const packages = [
    pkg('restricted-pkg', '1.0.0', 'AGPL-3.0', true)
  ];
  const result = evaluatePackages(packages, 'production');
  assert.equal(result.blocked.length, 0);
  assert.equal(result.reported.length, 1);
});

test('evaluatePackages permits MIT production deps', () => {
  const packages = [
    pkg('mit-pkg', '1.0.0', 'MIT', false)
  ];
  const result = evaluatePackages(packages, 'production');
  assert.equal(result.blocked.length, 0);
  assert.equal(result.reported.length, 0);
});

test('evaluatePackages blocks unknown production deps', () => {
  const packages = [
    pkg('unknown-pkg', '1.0.0', null, false)
  ];
  const result = evaluatePackages(packages, 'production');
  assert.equal(result.blocked.length, 1);
});

test('evaluatePackages reports unknown dev deps', () => {
  const packages = [
    pkg('unknown-pkg', '1.0.0', null, true)
  ];
  const result = evaluatePackages(packages, 'production');
  assert.equal(result.blocked.length, 0);
  assert.equal(result.reported.length, 1);
});

test('evaluatePackages handles mixed licenses', () => {
  const packages = [
    pkg('mit-pkg', '1.0.0', 'MIT', false),
    pkg('agpl-pkg', '2.0.0', 'AGPL-3.0', false),
    pkg('unknown-pkg', '3.0.0', null, false)
  ];
  const result = evaluatePackages(packages, 'production');
  assert.equal(result.blocked.length, 2);
});

test('classifyLicense handles array input', () => {
  const result = classifyLicense(['MIT', 'Apache-2.0']);
  assert.equal(result.classification, 'permitted');
});

test('classifyLicense handles object with licenses array', () => {
  const result = classifyLicense({ licenses: 'MIT' });
  assert.equal(result.classification, 'permitted');
});

test('returns isProduction flag based on classification', () => {
  const permitted = classifyLicense('MIT');
  assert.equal(permitted.isProduction, true);
  
  const restricted = classifyLicense('AGPL-3.0');
  assert.equal(restricted.isProduction, false);
  
  const unknown = classifyLicense('RANDOM-LICENSE');
  assert.equal(unknown.isProduction, false);
});

test('private packages with no license default to MIT', () => {
  const result = classifyLicense({ type: 'private', license: undefined });
  // Private packages without explicit license should be treated as MIT
  assert.equal(result.classification, 'permitted');
});
