import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { MeResponse, MembershipRow } from '@/lib/types';
import { UpdateMemberForm } from '@/components/update-member-form';

export const dynamic = 'force-dynamic';

export default async function MembersPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const me = await apiFetch<MeResponse>('/me');
  const membership = me.memberships.find(
    (m) => m.organizationId === organizationId,
  );
  if (!membership || membership.status !== 'active') {
    redirect(`/dashboard`);
  }
  if (membership.role !== 'organization_admin') {
    return (
      <main className="mx-auto mt-12 max-w-2xl">
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="mt-4 text-sm text-gray-700">
          Only organization admins can manage members.
        </p>
      </main>
    );
  }
  const members = await apiFetch<MembershipRow[]>(
    `/organizations/${organizationId}/members`,
  );
  return (
    <main className="mx-auto mt-12 max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Members</h1>
      <p className="font-mono text-xs">{organizationId}</p>
      <ul className="divide-y rounded border">
        {members.map((m) => (
          <li key={m.id} className="space-y-2 p-3">
            <p className="font-mono text-xs">{m.userId}</p>
            <p className="text-sm">
              Role: <strong>{m.role}</strong> · Status:{' '}
              <strong>{m.status}</strong>
            </p>
            <UpdateMemberForm
              organizationId={organizationId}
              userId={m.userId}
              currentRole={m.role}
              currentStatus={m.status}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
