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

it('AuditModule exports only AuditService (AUDIT_CLIENT token is module-private)', () => {
  const auditModule = fs.readFileSync(
    path.join(SRC_ROOT, 'audit', 'audit.module.ts'),
    'utf8',
  );
  // Parse the @Module({ ... }) body. The exports array, if present, must
  // contain exactly `AuditService` and nothing else. A bare `@Module({})`
  // (no exports key) is also acceptable (only AuditService is implicitly
  // available to importers that need it via providers — but here we
  // assert the explicit case).
  const exportsMatch = auditModule.match(/exports\s*:\s*\[([^\]]*)\]/);
  if (exportsMatch) {
    const inside = exportsMatch[1].trim();
    // Must be exactly `AuditService` (no `'AUDIT_CLIENT'`, no SupabaseClient
    // type alias, no other symbol).
    expect(inside).toBe('AuditService');
  } else {
    // No exports key at all → no public surface beyond providers registered
    // in this module. Acceptable: still assert no module-private token leaks
    // through `providers` array either, by checking the file does not re-export
    // the AUDIT_CLIENT symbol.
    expect(auditModule).not.toMatch(/exports\s*:\s*\[?\s*['"]AUDIT_CLIENT['"]/);
  }
});

it("no domain module other than audit/{module,service} references the 'AUDIT_CLIENT' token string", () => {
  // The token `'AUDIT_CLIENT'` (with quotes) is defined in audit.module.ts and
  // injected in audit.service.ts. No other file may reference it — neither
  // through import, nor through @Inject, nor through a string-literal config
  // value. The check is the literal string `'AUDIT_CLIENT'` so that comments
  // describing the token (without quotes) do not trip the test.
  const tokenLiteral = "'AUDIT_CLIENT'";
  const allowed = new Set([
    path.join(SRC_ROOT, 'audit', 'audit.module.ts'),
    path.join(SRC_ROOT, 'audit', 'audit.service.ts'),
  ]);
  const offenders = DOMAIN_TS.filter(
    (p) => !allowed.has(p) && fs.readFileSync(p, 'utf8').includes(tokenLiteral),
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
    return /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role/i.test(stripped);
  });
  expect(offenders).toEqual([]);
});
