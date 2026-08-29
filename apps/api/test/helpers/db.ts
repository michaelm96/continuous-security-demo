// Shared `pg.Pool` and `withTransaction` helper for RLS boundary tests.
// Reads DATABASE_URL (set in .env.example; populated by db:setup).

import { Pool, type PoolClient } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    try {
      const result = await fn(client);
      await client.query('rollback');
      return result;
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    }
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
