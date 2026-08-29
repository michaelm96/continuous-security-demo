// AuditService — sole application-tier writer to public.audit_events.
//
// Architecture invariant (Spec §3.4 / §5.2.6): AuditModule is the only module
// that may read the elevated Supabase key. The privileged client is
// constructed inside the module-private AUDIT_CLIENT provider; it is not
// exported as a DI token, and no other module can reach it.
//
// `record()` throws `audit_unavailable` on insert failure. AuthGuard
// converts that to 503 Problem Details per Spec §10.4.

import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AuditInput } from './audit.types';

export const AUDIT_UNAVAILABLE = 'audit_unavailable';

@Injectable()
export class AuditService {
  constructor(@Inject('AUDIT_CLIENT') private readonly client: SupabaseClient) {}

  async record(event: AuditInput): Promise<void> {
    const { error } = await this.client.from('audit_events').insert({
      actor_id: event.actorId,
      organization_id: event.organizationId,
      action: event.action,
      target_type: event.targetType,
      target_id: event.targetId,
      result: event.result,
      correlation_id: event.correlationId,
      metadata: event.metadata,
    });
    if (error) throw new Error(AUDIT_UNAVAILABLE);
  }
}
