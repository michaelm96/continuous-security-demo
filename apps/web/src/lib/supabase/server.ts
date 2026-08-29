// Server-side Supabase client. Reads the Next.js 16 async cookies() API
// and hands them to @supabase/ssr's createServerClient. Cookie writes from
// inside Server Components are intentionally swallowed because the proxy
// performs the refresh writes instead.

import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (values) => {
          try {
            for (const { name, value, options } of values) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies; the proxy performs refresh writes.
          }
        },
      },
    },
  );
}
