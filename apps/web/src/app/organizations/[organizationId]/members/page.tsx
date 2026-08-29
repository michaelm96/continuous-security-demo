import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type {
  MeResponse,
  MembershipRow,
  MembershipRole,
  MembershipStatus,
  OrganizationView,
} from '@/lib/types';
import { OrgHeader } from '@/components/org-header';
import { UpdateMemberForm } from '@/components/update-member-form';

export const dynamic = 'force-dynamic';

const ROLE_PALETTE: Record<MembershipRole, string> = {
  user: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  manager: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  organization_admin:
    'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
};

const STATUS_PALETTE: Record<MembershipStatus, string> = {
  active:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  suspended: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
};

export default async function MembersPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const [me, orgs] = await Promise.all([
    apiFetch<MeResponse>('/me'),
    apiFetch<OrganizationView[]>('/organizations').catch(() => []),
  ]);
  const membership = me.memberships.find(
    (m) => m.organizationId === organizationId && m.status === 'active',
  );
  if (!membership) {
    redirect('/dashboard');
  }
  const orgLabel =
    orgs.find((o) => o.id === organizationId)?.name ?? 'Organization';

  if (membership.role !== 'organization_admin') {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <OrgHeader orgLabel={orgLabel} organizationId={organizationId} />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Only organization admins can manage members.
          </div>
        </main>
      </div>
    );
  }

  const members = await apiFetch<MembershipRow[]>(
    `/organizations/${organizationId}/members`,
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <OrgHeader orgLabel={orgLabel} organizationId={organizationId} />
      <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {members.length} member{members.length === 1 ? '' : 's'}
          </p>
        </header>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {members.map((m) => (
                <tr
                  key={m.id}
                  className="align-top transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs">{m.userId}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${ROLE_PALETTE[m.role]}`}
                    >
                      {m.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_PALETTE[m.status]}`}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <UpdateMemberForm
                      organizationId={organizationId}
                      userId={m.userId}
                      currentRole={m.role}
                      currentStatus={m.status}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
