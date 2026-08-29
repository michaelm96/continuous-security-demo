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
// Always sets X-Request-Id and application/problem+json content type.

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

interface StatusedError {
  status?: number;
  type?: string;
}

@Injectable()
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    @Inject(PINO_LOGGER) private readonly logger: PinoLogger,
    @Inject(NODE_ENV) private readonly nodeEnv: string,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
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
}
