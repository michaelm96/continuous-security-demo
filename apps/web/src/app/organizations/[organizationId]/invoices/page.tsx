import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type {
  InvoiceRow,
  InvoiceStatus,
  MeResponse,
  OrganizationView,
} from '@/lib/types';
import { CreateInvoiceForm } from '@/components/create-invoice-form';
import { OrgHeader } from '@/components/org-header';

export const dynamic = 'force-dynamic';

const STATUS_PALETTE: Record<InvoiceStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  issued: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  cancelled:
    'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 line-through',
};

function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  return `${major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default async function InvoicesPage({
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
  const canCreate =
    membership.role === 'manager' ||
    membership.role === 'organization_admin';

  const [invoices] = await Promise.all([
    apiFetch<InvoiceRow[]>(`/organizations/${organizationId}/invoices`),
  ]);

  const orgLabel =
    orgs.find((o) => o.id === organizationId)?.name ?? 'Organization';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <OrgHeader orgLabel={orgLabel} organizationId={organizationId} />
      <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
            </p>
          </div>
        </header>

        {canCreate && <CreateInvoiceForm organizationId={organizationId} />}

        <section>
          {invoices.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              No invoices yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{inv.description}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                          {inv.id}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                        {inv.customerId}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {formatMoney(inv.amountMinor, inv.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_PALETTE[inv.status]}`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          className="text-sm font-medium text-blue-700 hover:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-blue-400"
                          href={`/organizations/${organizationId}/invoices/${inv.id}`}
                        >
                          Open →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
