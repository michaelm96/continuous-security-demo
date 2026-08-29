// Invoice state machine. Pure data, no I/O.
//
// Spec §6.4 invariant #6 + Plan Task 7 Step 3: the only legal transitions
// are draft→{issued,cancelled}, issued→{paid,cancelled}; paid and cancelled
// are terminal. The Postgres trigger `enforce_invoice_state_transition()`
// (supabase/migrations/202608290002_invariants_rls.sql) is the authoritative
// race-safe gate; this constant mirrors that matrix so the Nest service
// layer can reject illegal transitions BEFORE the UPDATE statement.

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

export const ALLOWED_TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  draft: ['issued', 'cancelled'],
  issued: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}