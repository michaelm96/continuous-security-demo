import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { InvoiceRow, MeResponse, RefundRow } from '@/lib/types';
import { UpdateInvoiceStatusForm } from '@/components/update-invoice-status-form';
import { CreateRefundForm } from '@/components/create-refund-form';

export const dynamic = 'force-dynamic';

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string; invoiceId: string }>;
}) {
  const { organizationId, invoiceId } = await params;
  const me = await apiFetch<MeResponse>('/me');
  const membership = me.memberships.find(
    (m) => m.organizationId === organizationId,
  );
  if (!membership || membership.status !== 'active') {
    redirect(`/dashboard`);
  }
  const canManage =
    membership.role === 'manager' || membership.role === 'organization_admin';

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

  return (
    <main className="mx-auto mt-12 max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Invoice</h1>
      <p className="font-mono text-xs">{invoice.id}</p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="font-medium">Description</dt>
        <dd>{invoice.description}</dd>
        <dt className="font-medium">Amount</dt>
        <dd>
          {invoice.amountMinor} {invoice.currency}
        </dd>
        <dt className="font-medium">Status</dt>
        <dd>{invoice.status}</dd>
        <dt className="font-medium">Customer</dt>
        <dd className="font-mono text-xs">{invoice.customerId}</dd>
      </dl>
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
      <section>
        <h2 className="mb-2 text-lg font-semibold">Refunds</h2>
        {refunds.length === 0 ? (
          <p className="text-sm text-gray-600">No refunds.</p>
        ) : (
          <ul className="space-y-2">
            {refunds.map((r) => (
              <li key={r.id} className="rounded border p-3 text-sm">
                <p className="font-mono text-xs">{r.id}</p>
                <p>
                  {r.amountMinor} {r.currency} — {r.reason}
                </p>
                <p className="text-xs text-gray-600">
                  key: <span className="font-mono">{r.idempotencyKey}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
