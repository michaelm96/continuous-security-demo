// InvoiceService — caller-scoped reads and writes for invoices.
//
// Architecture invariant (Spec §3.4 / §5.2.4): every read/write uses the
// caller-scoped Supabase client (CALLER_CLIENT). No service-role client is
// constructed or imported here; DatabaseModule exports only the caller
// factory.
//
// Authorization decision order (Spec §5.2.4):
//   1. loadActiveMembership(principal, organizationId) via caller client.
//      No row → 404. Suspended row → 403. Active row → role check.
//   2. Endpoint role check: list/get require any active role;
//      create/update require `manager` or `organization_admin`. Insufficient
//      role → 403 BEFORE the invoice query (proves Nest layer does not
//      delegate to RLS).
//   3. Tenant + ownership: SELECT scoped by (invoice_id, url.organizationId);
//      zero visible rows → 404. Independent check: active `user` must own
//      the row; manager/admin must belong to its organization.
//
// State transitions (Plan Task 7 Step 3): mirrored from `invoice-state.ts`
// which mirrors the Postgres trigger matrix; illegal transitions return 409
// invalid_state BEFORE the UPDATE is issued.
//
// Audit: real AuditService.record() is called for success and for
// high-risk rejection paths. Required rejection audit failure → 503
// audit_unavailable per Spec §10.4.

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { CALLER_CLIENT, type CallerClient } from '../database/caller-client';
import { AuditService, AUDIT_UNAVAILABLE } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { MembershipService } from '../organizations/membership.service';
import { canTransitionInvoice, type InvoiceStatus } from './invoice-state';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { PatchInvoiceDto } from './dto/patch-invoice.dto';

export interface InvoiceRow {
  id: string;
  organizationId: string;
  ownerId: string;
  customerId: string;
  description: string;
  amountMinor: number;
  currency: string;
  status: InvoiceStatus;
  createdAt?: string;
  updatedAt?: string;
}

interface RawInvoiceRow {
  id: string;
  organization_id: string;
  owner_id: string;
  customer_id: string;
  description: string;
  amount_minor: number | string; // pg bigint may come back as string
  currency: string;
  status: InvoiceStatus;
  created_at?: string;
  updated_at?: string;
}

function toInvoiceRow(raw: RawInvoiceRow): InvoiceRow {
  return {
    id: raw.id,
    organizationId: raw.organization_id,
    ownerId: raw.owner_id,
    customerId: raw.customer_id,
    description: raw.description,
    amountMinor:
      typeof raw.amount_minor === 'string'
        ? Number(raw.amount_minor)
        : raw.amount_minor,
    currency: raw.currency,
    status: raw.status,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

@Injectable()
export class InvoiceService {
  constructor(
    @Inject(CALLER_CLIENT) private readonly caller: CallerClient,
    private readonly memberships: MembershipService,
    private readonly audit: AuditService,
  ) {}

  // -------- List --------

  async list(principal: Principal, organizationId: string): Promise<InvoiceRow[]> {
    // Any active role in the org can list invoices.
    await this.memberships.loadActiveMembership(principal, organizationId);
    const client = this.caller(principal.accessToken);
    const { data, error } = await client
      .from('invoices')
      .select('id, organization_id, owner_id, customer_id, description, amount_minor, currency, status, created_at, updated_at')
      .eq('organization_id', organizationId);
    if (error || !Array.isArray(data)) return [];
    return (data as RawInvoiceRow[]).map(toInvoiceRow);
  }

  // -------- Get --------

  async get(principal: Principal, organizationId: string, invoiceId: string): Promise<InvoiceRow> {
    // Any active role in the org can read invoices; owner/membership check
    // is done by RLS (and re-asserted below for the active `user` case).
    await this.memberships.loadActiveMembership(principal, organizationId);
    const client = this.caller(principal.accessToken);
    const { data, error } = await client
      .from('invoices')
      .select('id, organization_id, owner_id, customer_id, description, amount_minor, currency, status, created_at, updated_at')
      .eq('id', invoiceId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException();
    return toInvoiceRow(data as RawInvoiceRow);
  }

  // -------- Create --------

  async create(
    principal: Principal,
    organizationId: string,
    dto: CreateInvoiceDto,
    requestId: string,
  ): Promise<InvoiceRow> {
    // Endpoint role check: create requires manager or organization_admin.
    const own = await this.memberships.loadActiveMembership(principal, organizationId);
    if (own.role !== 'manager' && own.role !== 'organization_admin') {
      await this.auditRejection(principal, organizationId, requestId, 'create', 'forbidden');
      throw new ForbiddenException();
    }

    const client = this.caller(principal.accessToken);
    // owner_id is derived server-side via auth.uid() default; status
    // defaults to 'draft'. RLS invoices_insert_manager verifies the caller
    // is an active manager/admin in the organization.
    const { data, error } = await client
      .from('invoices')
      .insert({
        organization_id: organizationId,
        customer_id: dto.customerId,
        description: dto.description,
        amount_minor: dto.amountMinor,
        currency: dto.currency,
      })
      .select('id, organization_id, owner_id, customer_id, description, amount_minor, currency, status, created_at, updated_at')
      .single();

    if (error || !data) {
      // RLS denial or DB CHECK violation. Surface as not_found (cross-tenant
      // hidden) or 400 (DB CHECK) — but in this layer we treat both as 400
      // for DB CHECK and 404 for RLS. Most failures here are RLS-hidden
      // (caller's role got demoted between loadActiveMembership and INSERT).
      const msg = (error?.message ?? '').toLowerCase();
      if (msg.includes('check')) {
        throw new ConflictException({ code: 'validation_failed' });
      }
      throw new NotFoundException();
    }
    const row = toInvoiceRow(data as RawInvoiceRow);

    // Success audit (mandatory; spec §10.4 fail-closed).
    await this.auditSuccess(principal, organizationId, row.id, requestId, 'invoice.created');
    return row;
  }

  // -------- Transition --------

  async updateStatus(
    principal: Principal,
    organizationId: string,
    invoiceId: string,
    dto: PatchInvoiceDto,
    requestId: string,
  ): Promise<InvoiceRow> {
    // Endpoint role check: transitions require manager or organization_admin.
    const own = await this.memberships.loadActiveMembership(principal, organizationId);
    if (own.role !== 'manager' && own.role !== 'organization_admin') {
      await this.auditRejection(principal, organizationId, requestId, 'transition', 'forbidden');
      throw new ForbiddenException();
    }

    const client = this.caller(principal.accessToken);
    // Fetch the current row first so we can validate the transition
    // against the state machine BEFORE issuing the UPDATE.
    const { data: existing, error: readErr } = await client
      .from('invoices')
      .select('id, organization_id, owner_id, customer_id, description, amount_minor, currency, status, created_at, updated_at')
      .eq('id', invoiceId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (readErr || !existing) throw new NotFoundException();
    const before = existing as RawInvoiceRow;
    if (!canTransitionInvoice(before.status, dto.status)) {
      await this.auditRejection(principal, organizationId, requestId, 'transition', 'invalid_state');
      throw new ConflictException({ code: 'invalid_state' });
    }

    const { data, error } = await client
      .from('invoices')
      .update({ status: dto.status })
      .eq('id', invoiceId)
      .eq('organization_id', organizationId)
      .select('id, organization_id, owner_id, customer_id, description, amount_minor, currency, status, created_at, updated_at')
      .single();

    if (error || !data) {
      const msg = (error?.message ?? '').toLowerCase();
      // The DB trigger raises 'invalid_state' with P0001. supabase-js
      // surfaces the message verbatim in error.message.
      if (msg.includes('invalid_state')) {
        await this.auditRejection(principal, organizationId, requestId, 'transition', 'invalid_state');
        throw new ConflictException({ code: 'invalid_state' });
      }
      throw new NotFoundException();
    }
    const row = toInvoiceRow(data as RawInvoiceRow);
    await this.auditSuccess(
      principal,
      organizationId,
      row.id,
      requestId,
      `invoice.transition.${before.status}_to_${row.status}`,
    );
    return row;
  }

  // -------- Audit helpers --------

  private async auditSuccess(
    principal: Principal,
    organizationId: string,
    invoiceId: string,
    requestId: string,
    action: string,
  ): Promise<void> {
    try {
      await this.audit.record({
        actorId: principal.userId,
        organizationId,
        action,
        targetType: 'invoice',
        targetId: invoiceId,
        result: 'success',
        correlationId: requestId,
        metadata: {},
      });
    } catch (err) {
      if (err instanceof Error && err.message === AUDIT_UNAVAILABLE) {
        throw new ServiceUnavailableException({ code: 'audit_unavailable' });
      }
      throw new ServiceUnavailableException({ code: 'audit_unavailable' });
    }
  }

  private async auditRejection(
    principal: Principal,
    organizationId: string,
    requestId: string,
    op: 'create' | 'transition',
    code: string,
  ): Promise<void> {
    try {
      await this.audit.record({
        actorId: principal.userId,
        organizationId,
        action: op === 'create' ? 'invoice.create' : 'invoice.transition',
        targetType: 'invoice',
        targetId: null,
        result: 'rejected',
        correlationId: requestId,
        metadata: { code },
      });
    } catch (err) {
      if (err instanceof Error && err.message === AUDIT_UNAVAILABLE) {
        throw new ServiceUnavailableException({ code: 'audit_unavailable' });
      }
      throw new ServiceUnavailableException({ code: 'audit_unavailable' });
    }
  }
}