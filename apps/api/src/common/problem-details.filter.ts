// Global exception filter. Maps thrown errors to stable Problem Details
// responses per Spec §10.1.
//
// - BadRequestException / 400 (ValidationPipe whitelist/forbidNonWhitelisted
//   failures, malformed JSON, oversize body) → validation_failed
// - NotFoundException / 404 → not_found (no detail field — keeps path hidden)
// - UnauthorizedException / 401 → unauthenticated
// - ForbiddenException / 403 → forbidden
// - HttpException with explicit status → derive code from PROBLEM_CODES
// - PayloadTooLargeError (.status === 413) → validation_failed
// - Anything else → internal (logged once via pino; no stack in production)
//
// Audit on 400 (Spec §5.2.6 / §10.4): every 400 must be audited through
// AuditService unless the originating service already stamped
// `req.auditRecorded = true` before throwing (services that throw audited
// rejections directly set the flag so the filter does not double-emit).
// If the audit write fails, the 400 is replaced with 503 audit_unavailable
// (fail-closed). All 400 responses — whether from ValidationPipe, an
// oversize-body rejection, or a service-thrown BadRequestException — flow
// through the same path so the invariant is enforced uniformly. The audit
// event uses only safe context: req.requestId, req.method, req.route.path,
// req.params and the validated detail string. Bearer token, headers, and
// body are NEVER read.

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Logger as PinoLogger } from 'pino';

import { problemDetails, problemDetailsFromStatus } from './problem-details';
import { PINO_LOGGER, NODE_ENV } from '../config/config.module';
import { AuditService, AUDIT_UNAVAILABLE } from '../audit/audit.service';

interface StatusedError {
  status?: number;
  type?: string;
}

interface RequestWithAudit extends Request {
  requestId?: string;
  principal?: { userId: string };
  auditRecorded?: boolean;
}

const DETAIL_MAX = 200;

@Injectable()
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    @Inject(PINO_LOGGER) private readonly logger: PinoLogger,
    @Inject(NODE_ENV) private readonly nodeEnv: string,
    private readonly audit: AuditService,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const res = ctx.getResponse<Response>();
    const requestId = (req.requestId ?? '') || '';

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Content-Type', 'application/problem+json');

    // A service that has already recorded its own rejection audit can
    // set `error.auditRecorded = true` on the thrown exception to tell
    // the filter to skip its own mandatory-audit row (Plan Task 8
    // Step 4 — "services that already audited should not be
    // double-audited"). We mirror the flag onto the request so the
    // single check inside `respond()` covers both attachment points.
    const reqWithAudit = req as RequestWithAudit;
    if (
      exception !== null &&
      typeof exception === 'object' &&
      (exception as { auditRecorded?: unknown }).auditRecorded === true
    ) {
      reqWithAudit.auditRecorded = true;
    }

    // Body-parser oversize body: error has .status === 413 and
    // .type === 'entity.too.large'. Express body-parser throws these without
    // a prototype link to HttpException, so check the duck-typed status.
    if (
      exception !== null &&
      typeof exception === 'object' &&
      (exception as StatusedError).status === 413
    ) {
      await this.respond(
        req as RequestWithAudit,
        res,
        problemDetails('VALIDATION_FAILED', requestId, 'oversize_body'),
        'oversize_body',
      );
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const detail =
        typeof body === 'object' && body !== null && 'message' in body
          ? Array.isArray((body as { message: unknown }).message)
            ? ((body as { message: unknown[] }).message as unknown[]).map(String).join('; ')
            : String((body as { message: unknown }).message)
          : undefined;

      if (status === 404) {
        // No detail: keeps the requested path out of the response body.
        await this.respond(
          req as RequestWithAudit,
          res,
          problemDetails('NOT_FOUND', requestId),
        );
        return;
      }
      if (status === 400) {
        // Mandatory audit on every 400 (Spec §5.2.6). Fail-closed: a
        // write failure replaces the 400 with 503 audit_unavailable.
        // 400 covers three codes per Spec §10.1: VALIDATION_FAILED
        // (ValidationPipe / oversize body / service-thrown
        // BadRequestException), INVALID_AMOUNT (defence-in-depth path
        // when a refund row bypasses the DTO), and CURRENCY_MISMATCH
        // (same). Trust the explicit code from the exception body when
        // present; default to VALIDATION_FAILED. `respond` handles both
        // audit + write and honors req.auditRecorded when a service
        // already recorded the rejection.
        const code =
          typeof body === 'object' &&
          body !== null &&
          'code' in body &&
          typeof (body as { code: unknown }).code === 'string'
            ? ((body as { code: string }).code)
            : 'validation_failed';
        const codeKey =
          code === 'invalid_amount'
            ? 'INVALID_AMOUNT'
            : code === 'currency_mismatch'
              ? 'CURRENCY_MISMATCH'
              : 'VALIDATION_FAILED';
        await this.respond(
          req as RequestWithAudit,
          res,
          problemDetails(codeKey, requestId, detail),
          detail ?? '',
        );
        return;
      }
      if (status === 401) {
        await this.respond(
          req as RequestWithAudit,
          res,
          problemDetails('UNAUTHENTICATED', requestId, detail),
        );
        return;
      }
      if (status === 403) {
        await this.respond(
          req as RequestWithAudit,
          res,
          problemDetails('FORBIDDEN', requestId, detail),
        );
        return;
      }
      if (status === 429) {
        await this.respond(
          req as RequestWithAudit,
          res,
          problemDetails('THROTTLED', requestId, detail),
        );
        return;
      }
      if (status === 409) {
        // 409 can mean last_admin (Task 6), invalid_state (Task 2 trigger),
        // or idempotency_conflict / over_refund (Task 9). Trust the explicit
        // code from the exception body when present. `currency_mismatch` is
        // 400 per Spec §10.1, not 409, and is never raised with status 409.
        const code =
          typeof body === 'object' &&
          body !== null &&
          'code' in body &&
          typeof (body as { code: unknown }).code === 'string'
            ? ((body as { code: string }).code)
            : 'invalid_state';
        const codeKey =
          code === 'last_admin'
            ? 'LAST_ADMIN'
            : code === 'idempotency_conflict'
              ? 'IDEMPOTENCY_CONFLICT'
              : code === 'over_refund'
                ? 'OVER_REFUND'
                : code === 'validation_failed'
                  ? 'VALIDATION_FAILED'
                  : 'INVALID_STATE';
        await this.respond(
          req as RequestWithAudit,
          res,
          problemDetails(codeKey, requestId, detail),
        );
        return;
      }
      if (status === 503) {
        // 503 can mean audit_unavailable (Task 5 AuthGuard) or
        // dependency_unavailable (Task 4 HealthService). Trust the explicit
        // code from the exception body when present.
        const code =
          typeof body === 'object' &&
          body !== null &&
          'code' in body &&
          typeof (body as { code: unknown }).code === 'string'
            ? ((body as { code: string }).code)
            : 'dependency_unavailable';
        await this.respond(
          req as RequestWithAudit,
          res,
          problemDetails(
            code === 'audit_unavailable' ? 'AUDIT_UNAVAILABLE' : 'DEPENDENCY_UNAVAILABLE',
            requestId,
            detail,
          ),
        );
        return;
      }
      await this.respond(
        req as RequestWithAudit,
        res,
        problemDetailsFromStatus(status, requestId, detail),
      );
      return;
    }

    // Unknown error: log once via pino (no stack in production).
    const message =
      exception instanceof Error ? exception.message : 'unhandled_error';
    if (this.nodeEnv !== 'production') {
      this.logger.error({ requestId, code: 'internal', message }, 'internal error');
    } else {
      this.logger.error({ requestId, code: 'internal' }, 'internal error');
    }
    await this.respond(
      req as RequestWithAudit,
      res,
      problemDetails('INTERNAL', requestId),
    );
  }

  // Centralized write path. Enforces the mandatory-audit invariant for any
  // 400 response (Spec §5.2.6) and emits one redacted log line if the
  // audit write fails (Spec §10.4 — visibility into a degraded mode).
  // Services that already record their own rejection audit must set
  // `req.auditRecorded = true` on the request before throwing, which this
  // method honors to avoid a double-emit.
  private async respond(
    req: RequestWithAudit,
    res: Response,
    pd: { status: number; title: string; code: string; requestId: string; detail?: string },
    detailForAudit?: string,
  ): Promise<void> {
    if (pd.status === 400 && !req.auditRecorded) {
      try {
        await this.auditValidationFailure(req, detailForAudit ?? '');
      } catch (err) {
        // Mandatory audit failed — fail closed (Spec §10.4). Log one
        // redacted line so operators see the degraded mode; never log
        // the body, headers, or bearer token.
        this.logger.error(
          {
            requestId: req.requestId,
            code: AUDIT_UNAVAILABLE,
          },
          'required audit persistence failed',
        );
        const pd503 = problemDetails('AUDIT_UNAVAILABLE', req.requestId ?? '');
        res.status(pd503.status).json(pd503);
        return;
      }
    }
    res.status(pd.status).json(pd);
  }

  // Records a DTO-validation rejection audit. Safe context only:
  // req.requestId, req.method, req.route.path, req.params, and detail.
  // Bearer token / Authorization header / body are NEVER read.
  private async auditValidationFailure(
    req: RequestWithAudit,
    detail: string,
  ): Promise<void> {
    const truncated =
      detail.length > DETAIL_MAX ? detail.slice(0, DETAIL_MAX) : detail;
    const organizationId =
      typeof req.params?.organizationId === 'string'
        ? req.params.organizationId
        : null;
    const targetType = req.route?.path
      ? `${req.method} ${req.route.path}`
      : 'unknown';
    await this.audit.record({
      actorId: req.principal?.userId ?? null,
      organizationId,
      action: 'api.validation',
      targetType,
      targetId: null,
      result: 'rejected',
      correlationId: req.requestId ?? 'unknown',
      metadata: { code: 'validation_failed', detail: truncated },
    });
  }
}
