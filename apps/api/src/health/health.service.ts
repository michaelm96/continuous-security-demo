// HealthService. Independent probes per Spec §3.4 / Plan Step 5.
//
// Postgres.app adaptation (forced deviation from plan, documented in report):
// - `database` probe: pg.Pool.query('SELECT public.health_check()')
// - `auth` probe: same query (no separate Auth service on Postgres.app dev host)
// - `jwks` probe: SUPABASE_JWT_SECRET length >= 32 (placeholder for real
//   RS256 JWKS endpoint when real Supabase Auth lands)
//
// Each probe runs in parallel under a 2-second timeout. Any failure throws
// `dependency_unavailable` for the global filter to convert to 503.

import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';

import { PG_POOL } from '../database/database.module';
import type { Env } from '../config/env';

export interface Probe {
  name: string;
  run(): Promise<void>;
  timeoutMs: number;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject('ENV') private readonly env: Env,
  ) {}

  private get probes(): Probe[] {
    const env = this.env;
    return [
      {
        name: 'database',
        run: async () => {
          await this.pool.query('SELECT public.health_check()');
        },
        timeoutMs: 2000,
      },
      {
        name: 'auth',
        run: async () => {
          // Postgres.app adaptation: same DB query — no separate Auth
          // service on this dev host. When real Supabase Auth lands, swap
          // this for a fetch against `${SUPABASE_URL}/auth/v1/health` with
          // AbortSignal.timeout(2000).
          await this.pool.query('SELECT public.health_check()');
        },
        timeoutMs: 2000,
      },
      {
        name: 'jwks',
        run: async () => {
          const secret = process.env.SUPABASE_JWT_SECRET;
          if (!secret || secret.length < 32) {
            throw new Error('jwks_secret_missing');
          }
        },
        timeoutMs: 2000,
      },
    ];
  }

  async check(): Promise<void> {
    try {
      await Promise.all(this.probes.map((p) => this.runProbe(p)));
    } catch (err) {
      throw new ServiceUnavailableException({
        code: 'dependency_unavailable',
        message: err instanceof Error ? err.message : 'probe_failed',
      });
    }
  }

  private async runProbe(p: Probe): Promise<void> {
    await Promise.race([
      p.run(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${p.name}_timeout`)),
          p.timeoutMs,
        ),
      ),
    ]);
  }
}
