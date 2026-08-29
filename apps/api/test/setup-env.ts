// Manual .env loader for jest. Avoids adding dotenv as a dep.
// Reads `<repo-root>/.env` if it exists and sets any keys that are not already
// set in process.env. Test-only: writes back into the same process.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const envPath = join(__dirname, '..', '..', '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

// Bootstrap: derive real Supabase credentials from the local CLI.
// Parses only the four required values; ignores JWT_SECRET.
// Handles cases where the CLI exits non-zero but still outputs valid env vars.
let CLI_BOOTSTRAP: Record<string, string> = {};
try {
  const { execFileSync } = require('node:child_process');
  // Use shell:true to handle the Docker warning gracefully
  const out = String(execFileSync(
    'npx --yes supabase@2.116.0 status -o env 2>/dev/null',
    { cwd: require('node:path').resolve(__dirname, '../../..'), timeout: 15000, encoding: 'utf8', shell: true }
  ));
  for (const line of out.split('\n')) {
    const m = line.match(/^(POSTGRES_|SUPABASE_|API_URL|ANON_KEY|SERVICE_ROLE_KEY|DB_URL)="?([^"\n]*)"?/);
    if (m) {
      const key = m[1] === 'API_URL' ? 'SUPABASE_URL'
        : m[1] === 'ANON_KEY' ? 'SUPABASE_ANON_KEY'
        : m[1] === 'SERVICE_ROLE_KEY' ? 'SUPABASE_SERVICE_ROLE_KEY'
        : m[1] === 'DB_URL' ? 'SUPABASE_DB_URL' : m[1];
      CLI_BOOTSTRAP[key] = m[2];
    }
  }
} catch {}

// Provide deterministic defaults for the test suite. These keep the test
// environment self-contained without requiring the developer to export every
// variable manually.
const DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  API_PORT: '3001',
  WEB_ORIGIN: 'http://localhost:3000',
  SUPABASE_URL: CLI_BOOTSTRAP.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: CLI_BOOTSTRAP.SUPABASE_ANON_KEY ?? 'placeholder',
  SUPABASE_SERVICE_ROLE_KEY: CLI_BOOTSTRAP.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder',
  SUPABASE_DB_URL: CLI_BOOTSTRAP.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  SUPABASE_JWT_AUDIENCE: 'authenticated',
  SUPABASE_JWT_ISSUER: (CLI_BOOTSTRAP.SUPABASE_URL ?? 'http://127.0.0.1:54321') + '/auth/v1',
  LOG_LEVEL: 'silent',
  RATE_LIMIT_WINDOW_MS: '60000',
  RATE_LIMIT_AUTH_PER_MIN: '60',
  RATE_LIMIT_ANON_PER_MIN: '20',
  BODY_LIMIT_KB: '100',
  JSON_DEPTH_LIMIT: '20',
  OPENAPI_ENABLED: 'true',
};
for (const [k, v] of Object.entries(DEFAULTS)) {
  if (process.env[k] === undefined) process.env[k] = v;
}
