// Server actions for the four domain mutations. Each one has the exact
// (previous: ActionState, formData: FormData) => Promise<ActionState>
// signature that React 19's useActionState expects. Each builds a strict
// JSON body from only the allowlisted fields, calls apiFetch, and either
// returns { success: true } after revalidatePath or returns the
// ProblemDetails object that apiFetch threw. Unexpected errors are
// rethrown so the Next.js error boundary can handle them.

'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch } from './api';
import type { ActionState, ProblemDetails } from './types';

export type { ActionState } from './types';

function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ProblemDetails).title === 'string' &&
    typeof (value as ProblemDetails).status === 'number' &&
    typeof (value as ProblemDetails).code === 'string' &&
    typeof (value as ProblemDetails).requestId === 'string'
  );
}

export async function createInvoiceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const body = {
    customerId: String(formData.get('customerId') ?? ''),
    description: String(formData.get('description') ?? ''),
    amountMinor: Number(formData.get('amountMinor') ?? 0),
    currency: String(formData.get('currency') ?? ''),
  };
  try {
    await apiFetch(`/organizations/${organizationId}/invoices`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    revalidatePath(`/organizations/${organizationId}/invoices`);
    return { success: true };
  } catch (error) {
    if (isProblemDetails(error)) return { error };
    throw error;
  }
}

export async function updateInvoiceStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const invoiceId = String(formData.get('invoiceId') ?? '');
  const body = {
    status: String(formData.get('status') ?? ''),
  };
  try {
    await apiFetch(
      `/organizations/${organizationId}/invoices/${invoiceId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
    revalidatePath(`/organizations/${organizationId}/invoices/${invoiceId}`);
    return { success: true };
  } catch (error) {
    if (isProblemDetails(error)) return { error };
    throw error;
  }
}

export async function createRefundAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const invoiceId = String(formData.get('invoiceId') ?? '');
  const body = {
    amountMinor: Number(formData.get('amountMinor') ?? 0),
    currency: String(formData.get('currency') ?? ''),
    reason: String(formData.get('reason') ?? ''),
    idempotencyKey: String(formData.get('idempotencyKey') ?? ''),
  };
  try {
    await apiFetch(
      `/organizations/${organizationId}/invoices/${invoiceId}/refunds`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    revalidatePath(`/organizations/${organizationId}/invoices/${invoiceId}`);
    return { success: true };
  } catch (error) {
    if (isProblemDetails(error)) return { error };
    throw error;
  }
}

export async function updateMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const body: { role?: string; status?: string } = {};
  const role = formData.get('role');
  if (typeof role === 'string' && role.length > 0) body.role = role;
  const status = formData.get('status');
  if (typeof status === 'string' && status.length > 0) body.status = status;
  try {
    await apiFetch(
      `/organizations/${organizationId}/members/${userId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
    revalidatePath(`/organizations/${organizationId}/members`);
    return { success: true };
  } catch (error) {
    if (isProblemDetails(error)) return { error };
    throw error;
  }
}
