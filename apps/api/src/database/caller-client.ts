// CallerClient — caller-scoped Supabase client factory. Each HTTP request
// that holds a verified JWT gets its own client instance whose Authorization
// header is the caller's bearer token; Postgres runs as `authenticated` with
// `auth.uid()` derived from the verified JWT, so RLS is enforced.
//
// Spec §3.4 / §5.1 / §5.2.2: DatabaseModule exports only this factory and
// nothing else. No provider leaks the elevated Supabase key — it is the sole
// province of AuditModule (audit/audit.module.ts).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../config/env';

export type CallerClient = (accessToken: string) => SupabaseClient;
export const CALLER_CLIENT = Symbol('CALLER_CLIENT');

export function createCallerClient(env: Env): CallerClient {
  return (accessToken) =>
    createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
}
