// Real GoTrue sign-in helpers for e2e tests.
//
// signIn uses a fresh no-persistence/no-refresh anon Supabase client and
// auth.signInWithPassword({ email, password }). Requires a session token.
// callerClient creates a Supabase client with the caller's access token.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SeedIdentity } from './seed-identities';

export async function signIn(identity: SeedIdentity): Promise<string> {
  const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: identity.email,
    password: identity.password,
  });
  if (error || !data.session?.access_token) {
    throw new Error(`signIn failed: ${error?.message ?? 'no session'}`);
  }
  return data.session.access_token;
}

export function callerClient(accessToken: string): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

// Deprecated: RLS tests should use callerClient() or withPrivilegedTransaction()
export async function visibleInvoiceIds(token: string): Promise<string[]> {
  const client = callerClient(token);
  const { data, error } = await client.from('invoices').select('id');
  if (error) throw new Error(`visibleInvoiceIds failed: ${error.message}`);
  return (data ?? []).map((r: { id: string }) => r.id);
}

// Deprecated: RLS tests should use callerClient().auth.getUser()
export async function decodeAccessToken(token: string): Promise<{ sub: string; role: string; aud: string }> {
  const client = callerClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error) throw new Error(`decodeAccessToken failed: ${error.message}`);
  return { sub: data.user.id, role: data.user.role ?? 'authenticated', aud: 'authenticated' };
}
