// DatabaseModule — exports only the caller-scoped client factory
// (CALLER_CLIENT). No direct database pool or elevated-privilege client.

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
