import { Module, type Provider } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

import { ConfigModule, ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { HealthController } from './health.controller';
import {
  HEALTH_CLIENT,
  HEALTH_FETCH,
  HealthService,
  type HealthClient,
} from './health.service';

const healthClientProvider: Provider = {
  provide: HEALTH_CLIENT,
  inject: [ENV],
  useFactory: (env: Env): HealthClient => {
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      rpc: () => client.rpc('health_check'),
    };
  },
};

@Module({
  imports: [ConfigModule],
  providers: [
    healthClientProvider,
    { provide: HEALTH_FETCH, useValue: fetch },
    HealthService,
  ],
  controllers: [HealthController],
})
export class HealthModule {}
