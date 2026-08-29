// Privileged PostgreSQL helpers for e2e tests.
// Uses the real local CLI DB URL for privileged operations (catalog assertions,
// fixture setup/cleanup, trigger/constraint checks).

import { Pool, type PoolClient } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const dbUrl = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    pool = new Pool({ connectionString: dbUrl });
  }
  return pool;
}

export async function withPrivilegedTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePrivilegedPool(): Promise<void> {
  await pool?.end();
  pool = null;
}

// Alias for backwards compatibility with schema.rls-spec.ts
export { closePrivilegedPool as closePool };
