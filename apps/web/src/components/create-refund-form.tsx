'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createRefundAction, type ActionState } from '@/lib/actions';

const initial: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
    >
      {pending ? 'Creating…' : 'Create refund'}
    </button>
  );
}

export function CreateRefundForm({
  organizationId,
  invoiceId,
  defaultCurrency,
}: {
  organizationId: string;
  invoiceId: string;
  defaultCurrency: string;
}) {
  const [state, formAction] = useActionState(createRefundAction, initial);
  return (
    <form action={formAction} className="space-y-3 rounded border p-4">
      <h2 className="text-lg font-semibold">Create refund</h2>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="amountMinor" className="block text-sm font-medium">
            Amount (minor units)
          </label>
          <input
            id="amountMinor"
            name="amountMinor"
            type="number"
            required
            min={1}
            max={9007199254740991}
            className="w-full rounded border px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="currency" className="block text-sm font-medium">
            Currency
          </label>
          <input
            id="currency"
            name="currency"
            required
            pattern="[A-Z]{3}"
            maxLength={3}
            defaultValue={defaultCurrency}
            className="w-full rounded border px-3 py-2 uppercase focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="reason" className="block text-sm font-medium">
          Reason
        </label>
        <input
          id="reason"
          name="reason"
          required
          minLength={1}
          maxLength={512}
          className="w-full rounded border px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="idempotencyKey" className="block text-sm font-medium">
          Idempotency key
        </label>
        <input
          id="idempotencyKey"
          name="idempotencyKey"
          required
          minLength={1}
          maxLength={128}
          className="w-full rounded border px-3 py-2 font-mono focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </div>
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
