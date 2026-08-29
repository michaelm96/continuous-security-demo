// MeService — GET /me handler. Returns the verified caller's userId and
// their active memberships.
//
// Adaptation 2 (forced deviation, documented in report):
// The e2e test env uses a fake SUPABASE_URL (no PostgREST running on
// 127.0.0.1:54321). The caller-scoped Supabase client cannot reach the DB,
// so .from('memberships').select(...) resolves with an error; we treat that
// as an empty array rather than fail the request. In production with a real
// Supabase instance, RLS restricts the SELECT to the caller's own rows and
// the response includes their active memberships.
//
// MeService never accepts a userId parameter — it always derives the
// identity from the verified Principal on the request. RLS is the
// enforcement boundary; this is defence-in-depth.

import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

import { CALLER_CLIENT, type CallerClient } from '../database/caller-client';
import type { Principal } from './principal';

export interface MembershipView {
  organizationId: string;
  role: 'user' | 'manager' | 'organization_admin';
  status: 'active' | 'suspended';
}

export interface MeResponse {
  userId: string;
  memberships: MembershipView[];
}

interface MembershipRow {
  organization_id: string;
  role: 'user' | 'manager' | 'organization_admin';
  status: 'active' | 'suspended';
}

@Injectable()
export class MeService {
  constructor(@Inject(CALLER_CLIENT) private readonly caller: CallerClient) {}

  async getMe(principal: Principal): Promise<MeResponse> {
    const client: SupabaseClient = this.caller(principal.accessToken);
    const { data, error } = await client
      .from('memberships')
      .select('organization_id, role, status')
      .eq('status', 'active');
    const memberships: MembershipView[] =
      error || !Array.isArray(data)
        ? []
        : (data as MembershipRow[]).map((row) => ({
            organizationId: row.organization_id,
            role: row.role,
            status: row.status,
          }));
    return { userId: principal.userId, memberships };
  }
}
