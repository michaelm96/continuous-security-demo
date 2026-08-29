// Next.js 16 proxy (formerly middleware.ts). Refreshes the Supabase session
// cookie on every request that touches a protected route and redirects
// unauthenticated users to /login. The proxy is the ONLY place that
// performs cookie writes for Supabase on the server side.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          for (const { name, value } of values) {
            request.cookies.set(name, value);
            response.cookies.set(name, value);
          }
        },
      },
    },
  );

  // Validate (and refresh if needed) the current session.
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected =
    pathname === '/dashboard' || pathname.startsWith('/dashboard/') ||
    pathname === '/organizations' || pathname.startsWith('/organizations/');

  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ['/dashboard/:path*', '/organizations/:path*'],
};
