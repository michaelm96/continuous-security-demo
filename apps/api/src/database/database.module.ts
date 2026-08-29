// DatabaseModule stub for Task 4. Task 5 will replace this with the real
// callerClient(accessToken) provider and remove the direct PG_POOL export.
//
// Postgres.app adaptation: same pg.Pool serves both the `database` and
// `auth` probes (no separate Auth service on this dev host). The probe
// shape (Probe = { name, run(): Promise<void> }) is preserved so the
// HealthService doesn't change when real Supabase Auth lands.

import {
  Inject,
  Module,
  OnApplicationShutdown,
  Provider,
} from '@nestjs/common';
import { Pool } from 'pg';

import { ConfigModule } from '../config/config.module';
import type { Env } from '../config/env';

export const PG_POOL = 'PG_POOL';

const pgPoolProvider: Provider = {
  provide: PG_POOL,
  useFactory: (env: Env) =>
    new Pool({
      connectionString: env.DATABASE_URL,
      // brief: probes use 2-second timeout
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10_000,
      max: 10,
    }),
  inject: ['ENV'],
};

class PoolHolder implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end().catch(() => {});
  }
}

@Module({
  imports: [ConfigModule],
  providers: [pgPoolProvider, PoolHolder],
  exports: [PG_POOL],
})
export class DatabaseModule {}
