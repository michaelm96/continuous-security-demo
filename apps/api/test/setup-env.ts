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

// Provide deterministic defaults for the test suite. These keep the test
// environment self-contained without requiring the developer to export every
// variable manually.
const DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  API_PORT: '3001',
  WEB_ORIGIN: 'http://localhost:3000',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'test-anon-key-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-placeholder',
  SUPABASE_JWT_SECRET: 'test-only-jwt-secret-32-bytes-min-len-please',
  SUPABASE_JWT_AUDIENCE: 'authenticated',
  SUPABASE_JWT_ISSUER: 'http://127.0.0.1:54321',
  LOG_LEVEL: 'silent',
  RATE_LIMIT_WINDOW_MS: '60000',
  RATE_LIMIT_AUTH_PER_MIN: '60',
  RATE_LIMIT_ANON_PER_MIN: '20',
  BODY_LIMIT_KB: '100',
  JSON_DEPTH_LIMIT: '20',
  OPENAPI_ENABLED: 'true',
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgresql:///continuous_security_demo?host=/tmp',
};
for (const [k, v] of Object.entries(DEFAULTS)) {
  if (process.env[k] === undefined) process.env[k] = v;
}
