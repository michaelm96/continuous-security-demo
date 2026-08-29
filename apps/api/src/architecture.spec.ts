// Architecture tests. Step 1 RED — failing architecture tests. Step 2 makes
// them pass by creating audit/audit.module.ts (the only domain-module reader
// of the service role literal) and removing any service-role reference from
// database module.
//
// Spec §3.4 / §5.2.6 invariant: the Supabase service-role environment key
// may be read by exactly one DOMAIN module: apps/api/src/audit/audit.module.ts. The typed
// Env boundary (config/) is exempt — it must reference every env var name
// for validation. DatabaseModule must not export a service-role client
// (no provider leaks the key, no regex match for `service-role` /
// `service_role` / `serviceRole`).

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_ROOT = path.resolve(__dirname);
const REPO_ROOT = path.resolve(SRC_ROOT, '../../..');
const SERVICE_ROLE_KEY = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');

// config/ is the typed env boundary and is exempt from the
// service-role-literal scan (it must reference every env var name for
// validation). The intent of the invariant is "no domain module constructs
// a service-role client"; the env loader does not. Any new domain module
// is automatically covered by the walk — the test does NOT depend on a
// hardcoded list of child directories.
const EXCLUDED_DIRS = new Set(['config', 'node_modules', 'dist']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(p, out);
    } else if (entry.isFile() && p.endsWith('.ts') && !p.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

// All .ts files under src/, excluding config/, *.spec.ts, node_modules, dist.
const DOMAIN_TS = walk(SRC_ROOT);

it('service-role key appears in exactly the five approved boundary files', () => {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((file) => file.endsWith('.ts'));
  const offenders = files
    .filter((file) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').includes(SERVICE_ROLE_KEY))
    .sort();
  expect(offenders).toEqual([
    'apps/api/src/audit/audit.module.ts',
    'apps/api/src/config/config.module.ts',
    'apps/api/src/config/env.spec.ts',
    'apps/api/src/config/env.ts',
    'apps/api/test/setup-env.ts',
  ]);
});

it('service-role key appears only in audit module across the domain tree', () => {
  const offenders = DOMAIN_TS.filter((p) =>
    fs.readFileSync(p, 'utf8').includes(SERVICE_ROLE_KEY),
  );
  expect(offenders).toEqual([path.join(SRC_ROOT, 'audit', 'audit.module.ts')]);
});

it('DatabaseModule does not reference or export a service-role client', () => {
  const dbModule = fs.readFileSync(
    path.join(SRC_ROOT, 'database', 'database.module.ts'),
    'utf8',
  );
  expect(dbModule).not.toContain(SERVICE_ROLE_KEY);
  expect(dbModule).not.toMatch(/service[_-]?role/i);
});

it('AuditModule exports only AuditService (AUDIT_CLIENT token is module-private)', () => {
  const auditModule = fs.readFileSync(
    path.join(SRC_ROOT, 'audit', 'audit.module.ts'),
    'utf8',
  );
  // Parse the @Module({ ... }) body. The exports array, if present, must
  // contain exactly `AuditService` and nothing else. Split on commas and
  // ignore whitespace / trailing commas so the test is robust to
  // formatting drift.
  const exportsMatch = auditModule.match(/exports\s*:\s*\[([^\]]*)\]/);
  if (exportsMatch) {
    const inside = exportsMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(inside).toEqual(['AuditService']);
  } else {
    // No exports key at all → no public surface beyond providers registered
    // in this module. Acceptable: still assert no module-private token leaks
    // through `providers` array either, by checking the file does not re-export
    // the AUDIT_CLIENT symbol.
    expect(auditModule).not.toMatch(/exports\s*:\s*\[?\s*['"`]AUDIT_CLIENT['"`]/);
  }
});

it('no domain file (other than audit/) references the AUDIT_CLIENT token string', () => {
  // The token `AUDIT_CLIENT` (with any quote style: single, double, or
  // backtick) is defined in audit.module.ts and injected in
  // audit.service.ts. No other file may reference it — neither through
  // import, nor through @Inject, nor through a string-literal config
  // value. The check matches quoted or backtick-wrapped forms so that
  // `@Inject("AUDIT_CLIENT")`, `@Inject('AUDIT_CLIENT')`, and
  // `@Inject(`AUDIT_CLIENT`)` all trip the test.
  const allowed = new Set([
    path.join(SRC_ROOT, 'audit', 'audit.module.ts'),
    path.join(SRC_ROOT, 'audit', 'audit.service.ts'),
  ]);
  const offenders = DOMAIN_TS.filter(
    (p) => !allowed.has(p) && /\bAUDIT_CLIENT\b/.test(fs.readFileSync(p, 'utf8')),
  );
  expect(offenders).toEqual([]);
});

it('no non-audit domain file constructs or imports a service-role client', () => {
  // Extension of test 2 to ALL non-audit domain files. The brief's literal
  // wording ("service-role / service_role / serviceRole case-insensitive")
  // would false-positive on documentation comments in membership.service.ts
  // and invoice.service.ts that explain what these services do NOT use.
  // We strip line and block comments first so the test reflects the actual
  // invariant (no code constructs a service-role client) rather than the
  // presence of explanatory prose.
  const offenders = DOMAIN_TS.filter((p) => {
    if (p.includes(`${path.sep}audit${path.sep}`)) return false;
    const raw = fs.readFileSync(p, 'utf8');
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '') // /* ... */ block comments
      .replace(/^\s*\/\/.*$/gm, '') // whole-line // comments
      .replace(/\s+\/\/.*$/gm, ''); // trailing // comments
    return new RegExp(`${SERVICE_ROLE_KEY}|service[_-]?role`, 'i').test(stripped);
  });
  expect(offenders).toEqual([]);
});
