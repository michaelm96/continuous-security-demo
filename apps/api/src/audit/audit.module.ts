// AuditModule — THE ONLY MODULE that reads SUPABASE_SERVICE_ROLE_KEY.
// Architecture invariant: only audit/audit.module.ts may reference the
// service role literal; only AuditService is exported (the AUDIT_CLIENT
// provider is module-private and unreachable from any other module).
//
// Spec §5.2.6: Audit writes must succeed even when the calling user's RLS
// policies would deny access; the audit_events table has a dedicated insert
// policy restricted to the service-role client and rejects ordinary
// member-scoped writes.

import { Module } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { ConfigModule } from '../config/config.module';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuditService } from './audit.service';

const AUDIT_CLIENT = 'AUDIT_CLIENT';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: AUDIT_CLIENT,
      inject: [ENV],
      useFactory: (env: Env): SupabaseClient =>
        createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        }),
    },
    AuditService,
  ],
  exports: [AuditService],
})
export class AuditModule {}
