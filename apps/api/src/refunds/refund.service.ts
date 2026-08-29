// RefundService — caller-scoped atomic, idempotent refund creation via the
// `public.create_refund` SQL function.
//
// Architecture invariant (Spec §3.4 / §5.2.4): every read uses the
// caller-scoped Supabase client (CALLER_CLIENT). No elevated-privilege
// client is constructed or imported here; DatabaseModule exports only the
// caller factory. RefundService does NOT reference the elevated key.
//
// Authorization decision order (Spec §5.2.4):
//   1. loadActiveMembership(principal, organizationId) via caller client.
//      No row → 404. Suspended row → 403. Active row → role check.
//   2. Endpoint role check: refund creation requires `manager` or
//      `organization_admin`. Insufficient role → 403 BEFORE the RPC
//      (proves Nest layer does not delegate to the DB trigger).
//   3. RPC: `create_refund(...)`. The function independently re-derives
//      tenant + role from the locked invoice row, so the application-layer
//      role check is defense-in-depth and not load-bearing for safety.
//   4. SQL `error.message` substrings → HTTP status + code per Spec §10.1.
//
// Audit (Spec §10.4):
//   * Pre-RPC role rejection: mandatory rejection audit. Failure →
//     503 audit_unavailable (fail-closed).
//   * RPC rejections (not_found, invalid_state, invalid_amount,
//     currency_mismatch, over_refund, idempotency_conflict): mandatory
//     rejection audit correlated to the NEW requestId. Failure → 503.
//   * loadActiveMembership failures (404 no-org-membership, 403 suspended):
//     NOT audited here — they predate the refund-specific decision and
//     route through the global ProblemDetailsFilter without refund
//     metadata; auditing them again would double-log.
//   * Success: NOT audited here. The SQL function appends the success
//     audit in-transaction with `correlation_id = p_request_id`; the
//     service MUST NOT call `audit.record` on success.
//
// Double-audit prevention: every HttpException the service throws
// AFTER calling `auditRejection(...)` is marked with
// `error.auditRecorded = true`. ProblemDetailsFilter checks this
// flag (in addition to `req.auditRecorded`) and skips its own
// mandatory audit-on-400 row when set. The service-side record is
// the canonical audit for refund rejections.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';

import { CALLER_CLIENT, type CallerClient } from '../database/caller-client';
import { AuditService, AUDIT_UNAVAILABLE } from '../audit/audit.service';
import { PINO_LOGGER } from '../config/config.module';
import type { Principal } from '../auth/principal';
import { MembershipService } from '../organizations/membership.service';
import type { CreateRefundDto } from './dto/create-refund.dto';

export interface RefundRow {
  id: string;
  invoiceId: string;
  organizationId: string;
  createdBy: string;
  amountMinor: number;
  currency: string;
  reason: string;
  idempotencyKey: string;
  createdAt: string;
}

interface RawRefundRow {
  id: string;
  invoice_id: string;
  organization_id: string;
  created_by: string;
  amount_minor: number | string; // pg bigint may come back as string
  currency: string;
  reason: string;
  idempotency_key: string;
  created_at?: string;
}

function toRefundRow(raw: RawRefundRow): RefundRow {
  return {
    id: raw.id,
    invoiceId: raw.invoice_id,
    organizationId: raw.organization_id,
    createdBy: raw.created_by,
    amountMinor:
      typeof raw.amount_minor === 'string'
        ? Number(raw.amount_minor)
        : raw.amount_minor,
    currency: raw.currency,
    reason: raw.reason,
    idempotencyKey: raw.idempotency_key,
    createdAt: raw.created_at ?? '',
  };
}

function codeFromErrorMessage(msg: string): string | null {
  // The SQL function raises each rejection with a bare, anchored
  // error message (e.g. `raise exception 'invalid_amount' using
  // errcode = 'P0001'`). We require an EXACT match against a known
  // code, not a substring search, so that arbitrary diagnostic text
  // that happens to contain a code word does not get misclassified
  // as a known rejection. Substring matching would also let
  // `'unauthenticated'` shadow e.g. `'forbidden'`, etc.
  const trimmed = msg.trim();
  const codes: readonly string[] = [
    'unauthenticated',
    'idempotency_conflict',
    'currency_mismatch',
    'over_refund',
    'invalid_state',
    'invalid_amount',
    'not_found',
    'forbidden',
  ];
  for (const code of codes) {
    if (trimmed === code) return code;
  }
  return null;
}

@Injectable()
export class RefundService {
  constructor(
    @Inject(CALLER_CLIENT) private readonly caller: CallerClient,
    private readonly memberships: MembershipService,
    private readonly audit: AuditService,
    @Inject(PINO_LOGGER) private readonly logger: PinoLogger,
  ) {}

  async create(
    principal: Principal,
    organizationId: string,
    invoiceId: string,
    dto: CreateRefundDto,
    requestId: string,
  ): Promise<RefundRow> {
    // Step 1 + 2: membership load + role check. loadActiveMembership throws
    // 404 (no URL-org membership) or 403 (suspended); both propagate
    // through ProblemDetailsFilter without refund-specific auditing. Then
    // the role check is the refund-specific rejection, audited here.
    const own = await this.memberships.loadActiveMembership(principal, organizationId);
    if (own.role !== 'manager' && own.role !== 'organization_admin') {
      await this.auditRejection(
        principal,
        organizationId,
        requestId,
        'forbidden',
        null,
      );
      throw this.audited(new ForbiddenException());
    }

    // Step 3: invoke the SECURITY DEFINER RPC. The function derives the
    // actor from auth.uid() (under the caller's bearer token), so this
    // client is the caller-scoped client, not a service-role one. The
    // function returns a single `public.refunds` row; supabase-js wraps
    // TABLE-returning functions in an array, so `.single()` extracts the
    // first (and only) row.
    const client = this.caller(principal.accessToken);
    // The supabase-js Database type defaults to `any`, so the Args generic
    // can be inferred from the object literal. The function returns one
    // row of `public.refunds`; `.single()` extracts it from the array.
    const { data, error } = await client.rpc(
      'create_refund',
      {
        p_invoice_id: invoiceId,
        p_amount_minor: dto.amountMinor,
        p_currency: dto.currency,
        p_reason: dto.reason,
        p_idempotency_key: dto.idempotencyKey,
        p_request_id: requestId,
      },
    ).single<RawRefundRow>();

    if (error) {
      // Step 4: map SQL `error.message` substrings to the Spec §10.1
      // status/code pairs. Every rejection path audits through the
      // isolated AuditService (mandatory per Spec §5.2.6 / §10.4).
      const msg = (error.message ?? '').toLowerCase();
      const code = codeFromErrorMessage(msg) ?? 'internal';

      // The brief's audit metadata convention: targetId is null on every
      // rejection; metadata carries the code, plus invoiceId for the
      // not_found forensic case (the URL parameter the caller already
      // knows — leaking it does not weaken existence hiding).
      const metadataInvoiceId = code === 'not_found' ? invoiceId : null;

      switch (code) {
        case 'unauthenticated':
          await this.auditRejection(
            principal,
            organizationId,
            requestId,
            'unauthenticated',
            null,
          );
          // Defensive mapping: the SQL function raises `unauthenticated`
          // when auth.uid() is null. AuthGuard should have already
          // produced a 401 in that case, so this path is only reachable
          // if a request slipped through without a verified token. Map
          // to 401 Problem Details per Spec §10.1.
          throw new UnauthorizedException();
        case 'not_found':
          await this.auditRejection(
            principal,
            organizationId,
            requestId,
            'not_found',
            metadataInvoiceId,
          );
          throw new NotFoundException();
        case 'forbidden':
          await this.auditRejection(
            principal,
            organizationId,
            requestId,
            'forbidden',
            null,
          );
          throw this.audited(new ForbiddenException());
        case 'invalid_state':
          await this.auditRejection(
            principal,
            organizationId,
            requestId,
            'invalid_state',
            null,
          );
          throw this.audited(
            new ConflictException({ code: 'invalid_state', message: 'invalid_state' }),
          );
        case 'invalid_amount':
          await this.auditRejection(
            principal,
            organizationId,
            requestId,
            'invalid_amount',
            null,
          );
          throw this.audited(
            new BadRequestException({
              code: 'invalid_amount',
              message: 'invalid_amount',
            }),
          );
        case 'currency_mismatch':
          await this.auditRejection(
            principal,
            organizationId,
            requestId,
            'currency_mismatch',
            null,
          );
          // Spec §10.1: currency_mismatch is 400, NOT 409. The DTO
          // already validates the format; this defence-in-depth path
          // fires when the request currency disagrees with the locked
          // invoice currency.
          throw this.audited(
            new BadRequestException({
              code: 'currency_mismatch',
              message: 'currency_mismatch',
            }),
          );
        case 'over_refund':
          await this.auditRejection(
            principal,
            organizationId,
            requestId,
            'over_refund',
            null,
          );
          throw this.audited(
            new ConflictException({ code: 'over_refund', message: 'over_refund' }),
          );
        case 'idempotency_conflict':
          await this.auditRejection(
            principal,
            organizationId,
            requestId,
            'idempotency_conflict',
            null,
          );
          throw this.audited(
            new ConflictException({
              code: 'idempotency_conflict',
              message: 'idempotency_conflict',
            }),
          );
        default: {
          // Unknown error: the SQL function did not raise one of the
          // documented rejection codes. Per Spec §10.1, this is 500
          // / `internal`. Log the rejection code (never the underlying
          // DB error message — the test asserts that diagnostic text
          // like `database detail` does not appear in logs) and surface
          // a marker-audited InternalServerErrorException so the
          // global filter emits the canonical 500 Problem Details.
          await this.auditRejection(
            principal,
            organizationId,
            requestId,
            'internal',
            null,
          );
          this.logger.error(
            { requestId, code: 'internal' },
            'unhandled refund error',
          );
          throw this.audited(
            new InternalServerErrorException({
              code: 'internal',
              message: 'internal',
            }),
          );
        }
      }
    }

    if (!data) {
      // RPC returned no error and no row — treat as 500 internal per
      // Spec §10.1. The handler MUST persist a rejected-attempt audit
      // (mirroring the other refund-rejection paths) so a missing
      // row from a SECURITY DEFINER call leaves the same forensic
      // trail as a known rejection. Audit failure → 503
      // audit_unavailable (Spec §10.4 fail-closed). Never emit 503
      // with `code: 'internal'` directly — 503 is reserved for the
      // documented dependency_unavailable / audit_unavailable / health
      // failures, and a generic internal error is not a dependency
      // problem.
      await this.auditRejection(
        principal,
        organizationId,
        requestId,
        'internal',
        null,
      );
      this.logger.error(
        { requestId, code: 'internal' },
        'create_refund returned no data',
      );
      throw this.audited(
        new InternalServerErrorException({
          code: 'internal',
          message: 'internal',
        }),
      );
    }

    // Success: the SQL function has already written the audit_events row in
    // the same transaction, correlated to p_request_id. The service MUST
    // NOT call audit.record again here.
    return toRefundRow(data as RawRefundRow);
  }

  // Mark the exception as "already audited by the service" so
  // ProblemDetailsFilter's mandatory-audit branch skips its own row.
  // Used on every HttpException the service throws AFTER
  // `auditRejection(...)` has succeeded.
  private audited<E extends Error>(err: E): E & { auditRecorded: true } {
    (err as E & { auditRecorded?: boolean }).auditRecorded = true;
    return err as E & { auditRecorded: true };
  }

  // Audit rejection helper. Audit failure → 503 audit_unavailable
  // (Spec §10.4 fail-closed). `metadataInvoiceId` is included in the audit
  // metadata for the not_found path only; otherwise it is omitted so the
  // metadata stays a tight `{ code }` per the brief.
  private async auditRejection(
    principal: Principal,
    organizationId: string,
    requestId: string,
    code: string,
    metadataInvoiceId: string | null,
  ): Promise<void> {
    const metadata: Record<string, string | number | boolean | null> = { code };
    if (metadataInvoiceId !== null) {
      metadata.invoiceId = metadataInvoiceId;
    }
    try {
      await this.audit.record({
        actorId: principal.userId,
        organizationId,
        action: 'refund.create',
        targetType: 'refund',
        targetId: null,
        result: 'rejected',
        correlationId: requestId,
        metadata,
      });
    } catch (err) {
      if (err instanceof Error && err.message === AUDIT_UNAVAILABLE) {
        throw new ServiceUnavailableException({ code: 'audit_unavailable' });
      }
      throw new ServiceUnavailableException({ code: 'audit_unavailable' });
    }
  }
}
