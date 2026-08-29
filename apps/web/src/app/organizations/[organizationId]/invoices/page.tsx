import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { MeResponse, InvoiceRow } from '@/lib/types';
import { CreateInvoiceForm } from '@/components/create-invoice-form';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage({
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
  const canCreate =
    membership.role === 'manager' || membership.role === 'organization_admin';

  const invoices = await apiFetch<InvoiceRow[]>(
    `/organizations/${organizationId}/invoices`,
  );

  return (
    <main className="mx-auto mt-12 max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Invoices</h1>
      <p className="text-sm text-gray-700">
        Org: <span className="font-mono">{organizationId}</span>
      </p>
      {canCreate && <CreateInvoiceForm organizationId={organizationId} />}
      {invoices.length === 0 ? (
        <p className="text-sm text-gray-600">No invoices yet.</p>
      ) : (
        <ul className="divide-y rounded border">
          {invoices.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between p-3">
              <div>
                <p className="font-mono text-xs">{inv.id}</p>
                <p className="text-sm">
                  {inv.description} · {inv.amountMinor} {inv.currency} ·{' '}
                  <strong>{inv.status}</strong>
                </p>
              </div>
              <Link
                className="text-blue-700 underline focus-visible:outline focus-visible:outline-2"
                href={`/organizations/${organizationId}/invoices/${inv.id}`}
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
