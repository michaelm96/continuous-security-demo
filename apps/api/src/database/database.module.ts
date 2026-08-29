// DatabaseModule — exports only the caller-scoped client factory
// (CALLER_CLIENT). No PG_POOL, no elevated-privilege client. The HealthService
// pg.Pool probe from Task 4 was relocated to HealthModule (its sole
// consumer) so this module is exclusively the caller boundary.

import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { CALLER_CLIENT, createCallerClient } from './caller-client';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CALLER_CLIENT,
      inject: [ENV],
      useFactory: (env: Env) => createCallerClient(env),
    },
  ],
  exports: [CALLER_CLIENT],
})
export class DatabaseModule {}
