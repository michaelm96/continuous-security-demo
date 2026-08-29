'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { updateMemberAction, type ActionState } from '@/lib/actions';

const initial: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

export function UpdateMemberForm({
  organizationId,
  userId,
  currentRole,
  currentStatus,
}: {
  organizationId: string;
  userId: string;
  currentRole: string;
  currentStatus: string;
}) {
  const [state, formAction] = useActionState(updateMemberAction, initial);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="userId" value={userId} />
      <div className="space-y-1">
        <label
          htmlFor={`role-${userId}`}
          className="block text-xs font-medium text-slate-600 dark:text-slate-400"
        >
          Role
        </label>
        <select
          id={`role-${userId}`}
          name="role"
          defaultValue={currentRole}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-slate-700 dark:bg-slate-950"
        >
          <option value="user">user</option>
          <option value="manager">manager</option>
          <option value="organization_admin">organization_admin</option>
        </select>
      </div>
      <div className="space-y-1">
        <label
          htmlFor={`status-${userId}`}
          className="block text-xs font-medium text-slate-600 dark:text-slate-400"
        >
          Status
        </label>
        <select
          id={`status-${userId}`}
          name="status"
          defaultValue={currentStatus}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-slate-700 dark:bg-slate-950"
        >
          <option value="active">active</option>
          <option value="suspended">suspended</option>
        </select>
      </div>
      <SubmitButton />
      {state.error && (
        <div
          role="alert"
          className="basis-full rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
        >
          <span className="font-semibold">{state.error.title}</span>{' '}
          <span className="font-mono">[{state.error.code}]</span>
        </div>
      )}
    </form>
  );
}
