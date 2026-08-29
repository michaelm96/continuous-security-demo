// PatchInvoiceDto — strict allowlist for PATCH /organizations/:organizationId/invoices/:invoiceId.
// Only `status` is accepted. The legal transitions are also enforced by the
// Postgres trigger `enforce_invoice_state_transition()` and by
// `canTransitionInvoice(from, to)` in invoice-state.ts.

import { IsIn } from 'class-validator';

export type PatchableInvoiceStatus = 'issued' | 'paid' | 'cancelled';

export class PatchInvoiceDto {
  @IsIn(['issued', 'paid', 'cancelled'])
  status!: PatchableInvoiceStatus;
}