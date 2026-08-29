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
      className="rounded bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
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
    <form action={formAction} className="space-y-2 rounded border p-4">
      <h2 className="text-lg font-semibold">Update status</h2>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="status" value="paid" />
      {state.error && (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          <p className="font-semibold">{state.error.title}</p>
          <p>
            {state.error.code} (status {state.error.status})
          </p>
        </div>
      )}
      <SubmitButton />
    </form>
  );
}
