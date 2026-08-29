'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { updateInvoiceStatusAction, type ActionState } from '@/lib/actions';

const initial: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Updating…' : 'Mark as paid'}
    </button>
  );
}

export function UpdateInvoiceStatusForm({
  organizationId,
  invoiceId,
}: {
  organizationId: string;
  invoiceId: string;
}) {
  const [state, formAction] = useActionState(
    updateInvoiceStatusAction,
    initial,
  );
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <form action={formAction} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <input type="hidden" name="status" value="paid" />
        <div className="flex-1">
          <h2 className="text-base font-semibold">Update status</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Mark this issued invoice as paid.
          </p>
          {state.error && (
            <div
              role="alert"
              className="mt-3 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
            >
              <p className="font-semibold">{state.error.title}</p>
              <p className="mt-0.5 text-xs">
                code <code className="font-mono">{state.error.code}</code> · status {state.error.status}
              </p>
            </div>
          )}
        </div>
        <SubmitButton />
      </form>
    </section>
  );
}
