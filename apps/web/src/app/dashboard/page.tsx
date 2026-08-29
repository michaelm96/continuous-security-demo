import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type {
  MeResponse,
  MembershipView,
  OrganizationView,
  MembershipRole,
} from '@/lib/types';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SignOutButton } from '@/components/sign-out-button';

export const dynamic = 'force-dynamic';

const ROLE_RANK: Record<MembershipRole, number> = {
  user: 0,
  manager: 1,
  organization_admin: 2,
};

function pickPrimaryRole(roles: MembershipRole[]): MembershipRole {
  return roles.reduce((best, role) =>
    ROLE_RANK[role] > ROLE_RANK[best] ? role : best,
  );
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');

  const [me, orgs] = await Promise.all([
    apiFetch<MeResponse>('/me'),
    apiFetch<OrganizationView[]>('/organizations').catch(() => []),
  ]);

  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  const grouped = me.memberships.reduce<Map<string, MembershipView[]>>(
    (acc, m) => {
      const list = acc.get(m.organizationId) ?? [];
      list.push(m);
      acc.set(m.organizationId, list);
      return acc;
    },
    new Map(),
  );

  const orgsSorted = Array.from(grouped.entries()).sort(([, a], [, b]) => {
    const aActive = a.some((m) => m.status === 'active');
    const bActive = b.some((m) => m.status === 'active');
    return Number(bActive) - Number(aActive);
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
              CS
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">
                Continuous Security Demo
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Multi-tenant invoice + refund
              </p>
            </div>
          </div>
          <SignOutButton />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Signed in as{' '}
            <span className="font-mono text-xs">{user.email}</span>
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Your organizations ({orgsSorted.length})
          </h2>
          {orgsSorted.length === 0 ? (
            <EmptyState message="You have no active memberships." />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {orgsSorted.map(([organizationId, memberships]) => {
                const primary = pickPrimaryRole(
                  memberships.map((m) => m.role),
                );
                const isActive = memberships.some(
                  (m) => m.status === 'active',
                );
                const orgLabel = orgName.get(organizationId) ?? 'Unknown org';
                return (
                  <li
                    key={organizationId}
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-base font-semibold">{orgLabel}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                          {organizationId}
                        </p>
                      </div>
                      <StatusBadge active={isActive} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {memberships.map((m) => (
                        <RolePill
                          key={m.role + m.status}
                          role={m.role}
                          status={m.status}
                          primary={m.role === primary && m.status === 'active'}
                        />
                      ))}
                    </div>
                    {isActive && (
                      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                        <ActionLink
                          href={`/organizations/${organizationId}/invoices`}
                          label="Invoices"
                        />
                        {primary === 'organization_admin' && (
                          <ActionLink
                            href={`/organizations/${organizationId}/members`}
                            label="Members"
                            variant="secondary"
                          />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ' +
        (active
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300')
      }
    >
      <span
        className={
          'h-1.5 w-1.5 rounded-full ' +
          (active ? 'bg-emerald-500' : 'bg-slate-400')
        }
      />
      {active ? 'Active' : 'Suspended'}
    </span>
  );
}

function RolePill({
  role,
  status,
  primary,
}: {
  role: MembershipRole;
  status: 'active' | 'suspended';
  primary: boolean;
}) {
  const label = role.replace('_', ' ');
  const palette =
    status === 'suspended'
      ? 'bg-slate-100 text-slate-500 line-through dark:bg-slate-800 dark:text-slate-500'
      : primary
        ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${palette}`}
    >
      {label}
    </span>
  );
}

function ActionLink({
  href,
  label,
  variant = 'primary',
}: {
  href: string;
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  const cls =
    variant === 'primary'
      ? 'bg-blue-600 text-white hover:bg-blue-700'
      : 'border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800';
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${cls}`}
    >
      {label}
    </Link>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
      {message}
    </div>
  );
}
