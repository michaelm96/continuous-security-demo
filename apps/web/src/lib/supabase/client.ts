// Browser-side Supabase client. Used by the login form to call
// signInWithPassword. Uses @supabase/ssr's createBrowserClient which
// transparently persists the session to document.cookie.

import { createBrowserClient as ssrCreateBrowserClient } from '@supabase/ssr';

export function createBrowserClient() {
  return ssrCreateBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
