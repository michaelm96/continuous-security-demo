import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { MeResponse } from '@/lib/types';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SignOutButton } from '@/components/sign-out-button';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');

  const me = await apiFetch<MeResponse>('/me');

  return (
    <main className="mx-auto mt-12 max-w-3xl space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <SignOutButton />
      </header>
      <p className="text-sm text-gray-700">
        Signed in as <span className="font-mono">{user.email}</span>
      </p>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Your organizations</h2>
        {me.memberships.length === 0 ? (
          <p className="text-sm text-gray-600">No memberships.</p>
        ) : (
          <ul className="space-y-2">
            {me.memberships.map((m) => (
              <li key={m.organizationId} className="rounded border p-3">
                <p className="font-mono text-xs">{m.organizationId}</p>
                <p className="text-sm">
                  Role: <strong>{m.role}</strong> · Status:{' '}
                  <strong>{m.status}</strong>
                </p>
                <div className="mt-2 flex gap-3 text-sm">
                  {(m.role === 'manager' || m.role === 'organization_admin') && (
                    <Link
                      className="text-blue-700 underline focus-visible:outline focus-visible:outline-2"
                      href={`/organizations/${m.organizationId}/invoices`}
                    >
                      Invoices
                    </Link>
                  )}
                  {m.role === 'organization_admin' && (
                    <Link
                      className="text-blue-700 underline focus-visible:outline focus-visible:outline-2"
                      href={`/organizations/${m.organizationId}/members`}
                    >
                      Members
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
