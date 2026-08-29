import {
  Inject,
  Module,
  OnApplicationShutdown,
  Provider,
} from '@nestjs/common';
import { Pool } from 'pg';

import { ConfigModule } from '../config/config.module';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PG_POOL } from './pg-pool.token';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

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
  inject: [ENV],
};

class PoolHolder implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end().catch(() => {});
  }
}

@Module({
  imports: [ConfigModule],
  providers: [pgPoolProvider, PoolHolder, HealthService],
  controllers: [HealthController],
})
export class HealthModule {}
