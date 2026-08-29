// The only domain client. Pulls the access token from the current Supabase
// session and forwards every call to the NestJS API with the standard
// Authorization: Bearer header. The browser never calls PostgREST directly
// for domain data (Spec §3.4 invariant: frontend uses Supabase only for
// authentication).

import 'server-only';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from './supabase/server';
import type { ProblemDetails } from './types';

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect('/login');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${process.env.API_URL!}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    const problem = (await response.json()) as ProblemDetails;
    throw problem;
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
