import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type {
  InvoiceRow,
  InvoiceStatus,
  MeResponse,
  OrganizationView,
  RefundRow,
} from '@/lib/types';
import { OrgHeader } from '@/components/org-header';
import { UpdateInvoiceStatusForm } from '@/components/update-invoice-status-form';
import { CreateRefundForm } from '@/components/create-refund-form';

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

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string; invoiceId: string }>;
}) {
  const { organizationId, invoiceId } = await params;
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
  const canManage =
    membership.role === 'manager' ||
    membership.role === 'organization_admin';

  const invoice = await apiFetch<InvoiceRow>(
    `/organizations/${organizationId}/invoices/${invoiceId}`,
  );
  let refunds: RefundRow[] = [];
  try {
    refunds = await apiFetch<RefundRow[]>(
      `/organizations/${organizationId}/invoices/${invoiceId}/refunds`,
    );
  } catch {
    refunds = [];
  }

  const orgLabel =
    orgs.find((o) => o.id === organizationId)?.name ?? 'Organization';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <OrgHeader orgLabel={orgLabel} organizationId={organizationId} />
      <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
        <nav className="text-sm text-slate-600 dark:text-slate-400">
          <Link
            href={`/organizations/${organizationId}/invoices`}
            className="hover:text-slate-900 dark:hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            ← Back to invoices
          </Link>
        </nav>

        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {invoice.description}
          </h1>
          <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
            {invoice.id}
          </p>
        </header>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <dl className="divide-y divide-slate-200 dark:divide-slate-800">
            <Row label="Amount" value={formatMoney(invoice.amountMinor, invoice.currency)} />
            <Row label="Status">
              <span
                className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_PALETTE[invoice.status]}`}
              >
                {invoice.status}
              </span>
            </Row>
            <Row label="Customer" value={invoice.customerId} mono />
            <Row label="Owner" value={invoice.ownerId} mono />
          </dl>
        </section>

        {canManage && invoice.status === 'issued' && (
          <UpdateInvoiceStatusForm
            organizationId={organizationId}
            invoiceId={invoiceId}
          />
        )}

        {canManage && (
          <CreateRefundForm
            organizationId={organizationId}
            invoiceId={invoiceId}
            defaultCurrency={invoice.currency}
          />
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Refunds ({refunds.length})
          </h2>
          {refunds.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              No refunds yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {refunds.map((r) => (
                <li
                  key={r.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-base font-semibold">
                        {formatMoney(r.amountMinor, r.currency)}
                      </p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        {r.reason}
                      </p>
                      <p className="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                        key: {r.idempotencyKey}
                      </p>
                    </div>
                    <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                      {new Date(r.createdAt).toLocaleString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-4 px-5 py-3">
      <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd
        className={
          mono
            ? 'font-mono text-xs'
            : 'text-sm font-medium'
        }
      >
        {children ?? value}
      </dd>
    </div>
  );
}
