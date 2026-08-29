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
      className="rounded bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
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
          className="block text-xs font-medium"
        >
          Role
        </label>
        <select
          id={`role-${userId}`}
          name="role"
          defaultValue={currentRole}
          className="rounded border px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <option value="user">user</option>
          <option value="manager">manager</option>
          <option value="organization_admin">organization_admin</option>
        </select>
      </div>
      <div className="space-y-1">
        <label
          htmlFor={`status-${userId}`}
          className="block text-xs font-medium"
        >
          Status
        </label>
        <select
          id={`status-${userId}`}
          name="status"
          defaultValue={currentStatus}
          className="rounded border px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <option value="active">active</option>
          <option value="suspended">suspended</option>
        </select>
      </div>
      {state.error && (
        <div
          role="alert"
          className="basis-full rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900"
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
