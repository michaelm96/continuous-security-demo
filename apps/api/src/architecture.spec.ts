// Step 1 RED — failing architecture tests. Step 2 makes them pass by
// creating audit/audit.module.ts (the only domain-module reader of the
// service role literal) and removing any service-role reference from
// database module.
//
// Spec §3.4 / §5.2.6 invariant: SUPABASE_SERVICE_ROLE_KEY may be read by
// exactly one DOMAIN module: apps/api/src/audit/audit.module.ts. The typed
// Env boundary (config/) is exempt — it must reference every env var name
// for validation. DatabaseModule must not export a service-role client
// (no provider leaks the key, no regex match for `service-role` /
// `service_role` / `serviceRole`).

import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_ROOT = path.resolve(__dirname);

// Domain-tree only. config/ is the typed env boundary and is exempt from
// the service-role-literal scan (it must reference every env var name for
// validation). The intent of the invariant is "no domain module constructs
// a service-role client"; the env loader does not.
const DOMAIN_CHILDREN = [
  'audit',
  'auth',
  'common',
  'database',
  'health',
  'invoices',
  'organizations',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(p, out);
    } else if (entry.isFile() && p.endsWith('.ts') && !p.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

const DOMAIN_TS: string[] = [];
for (const child of DOMAIN_CHILDREN) {
  const dir = path.join(SRC_ROOT, child);
  if (fs.existsSync(dir)) walk(dir, DOMAIN_TS);
}

it('service-role literal appears only in audit module (across domain tree)', () => {
  const literal = 'SUPABASE_SERVICE_ROLE_KEY';
  const offenders = DOMAIN_TS.filter((p) =>
    fs.readFileSync(p, 'utf8').includes(literal),
  );
  expect(offenders).toEqual([path.join(SRC_ROOT, 'audit', 'audit.module.ts')]);
});

it('DatabaseModule does not reference or export a service-role client', () => {
  const dbModule = fs.readFileSync(
    path.join(SRC_ROOT, 'database', 'database.module.ts'),
    'utf8',
  );
  expect(dbModule).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  expect(dbModule).not.toMatch(/service[_-]?role/i);
});
