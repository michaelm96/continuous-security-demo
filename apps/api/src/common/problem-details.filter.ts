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
// AuditService. If the audit write fails, the 400 is replaced with 503
// audit_unavailable (fail-closed). We do not try to distinguish a
// ValidationPipe DTO failure from a service-thrown BadRequestException —
// the spec mandates a mandatory audit for every 400, and the cost of a
// double-audit (when a service has already recorded the rejection) is
// acceptable noise compared to the cost of skipping the audit on a path
// the filter cannot reliably identify. `req.auditRecorded` remains on the
// request type for future services that want to flag it, but the filter
// does not act on it. The audit event uses only safe context:
// req.requestId, req.method, req.route.path, req.params and the validated
// detail string. Bearer token, headers, and body are NEVER read.

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

    // Body-parser oversize body: error has .status === 413 and
    // .type === 'entity.too.large'. Express body-parser throws these without
    // a prototype link to HttpException, so check the duck-typed status.
    if (
      exception !== null &&
      typeof exception === 'object' &&
      (exception as StatusedError).status === 413
    ) {
      const pd = problemDetails('VALIDATION_FAILED', requestId, 'oversize_body');
      res.status(pd.status).json(pd);
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
        const pd = problemDetails('NOT_FOUND', requestId);
        res.status(pd.status).json(pd);
        return;
      }
      if (status === 400) {
        // Mandatory audit on every 400 (Spec §5.2.6). Fail-closed: a
        // write failure replaces the 400 with 503 audit_unavailable.
        try {
          await this.auditValidationFailure(req as RequestWithAudit, detail ?? '');
        } catch {
          // Audit unavailable — fail closed (Spec §10.4). Emit 503 in
          // place of the 400; the original validation result is discarded.
          const pd503 = problemDetails('AUDIT_UNAVAILABLE', requestId);
          res.status(pd503.status).json(pd503);
          return;
        }
        const pd = problemDetails('VALIDATION_FAILED', requestId, detail);
        res.status(pd.status).json(pd);
        return;
      }
      if (status === 401) {
        const pd = problemDetails('UNAUTHENTICATED', requestId, detail);
        res.status(pd.status).json(pd);
        return;
      }
      if (status === 403) {
        const pd = problemDetails('FORBIDDEN', requestId, detail);
        res.status(pd.status).json(pd);
        return;
      }
      if (status === 429) {
        const pd = problemDetails('THROTTLED', requestId, detail);
        res.status(pd.status).json(pd);
        return;
      }
      if (status === 409) {
        // 409 can mean last_admin (Task 6), invalid_state (Task 2 trigger),
        // idempotency_conflict / over_refund (Task 9), or validation_failed
        // for same-key conflicts. Trust the explicit code from the exception
        // body when present.
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
        const pd = problemDetails(codeKey, requestId, detail);
        res.status(pd.status).json(pd);
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
        const pd = problemDetails(
          code === 'audit_unavailable' ? 'AUDIT_UNAVAILABLE' : 'DEPENDENCY_UNAVAILABLE',
          requestId,
          detail,
        );
        res.status(pd.status).json(pd);
        return;
      }
      const pd = problemDetailsFromStatus(status, requestId, detail);
      res.status(pd.status).json(pd);
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
    const pd = problemDetails('INTERNAL', requestId);
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
    try {
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
    } catch (err) {
      // Mandatory audit failed → fail closed (Spec §10.4). Re-throw so the
      // caller's branch substitutes a 503 audit_unavailable response below.
      throw err instanceof Error ? err : new Error(AUDIT_UNAVAILABLE);
    }
  }
}
