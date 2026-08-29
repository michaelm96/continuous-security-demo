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
      className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-base font-semibold">Create refund</h2>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="amountMinor"
            label="Amount (minor units)"
            type="number"
            required
            min={1}
            max={9007199254740991}
          />
          <Field
            id="currency"
            label="Currency"
            required
            pattern="[A-Z]{3}"
            maxLength={3}
            defaultValue={defaultCurrency}
            className="uppercase"
          />
        </div>
        <Field id="reason" label="Reason" required minLength={1} maxLength={512} />
        <Field
          id="idempotencyKey"
          label="Idempotency key"
          required
          minLength={1}
          maxLength={128}
          mono
        />
        {state.error && <ErrorAlert problem={state.error} />}
        <SubmitButton />
      </form>
    </section>
  );
}

function Field({
  id,
  label,
  type = 'text',
  defaultValue,
  mono = false,
  ...rest
}: {
  id: string;
  label: string;
  type?: string;
  defaultValue?: string;
  mono?: boolean;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  className?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        defaultValue={defaultValue}
        {...rest}
        className={`w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-slate-700 dark:bg-slate-950 ${mono ? 'font-mono text-xs' : ''} ${rest.className ?? ''}`}
      />
    </div>
  );
}

function ErrorAlert({ problem }: { problem: { title: string; status: number; code: string; detail?: string } }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
    >
      <p className="font-semibold">{problem.title}</p>
      <p className="mt-0.5 text-xs">
        code <code className="font-mono">{problem.code}</code> · status {problem.status}
      </p>
      {problem.detail && <p className="mt-2 text-sm">{problem.detail}</p>}
    </div>
  );
}
