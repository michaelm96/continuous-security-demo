// AccessLogInterceptor. One log line per request, format:
//   { requestId, method, path, status, durationMs, userId?, organizationId? }
// Reads userId/organizationId from req.auth if present (Task 5 will set this;
// for Task 4 they're absent and the fields are omitted).

import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import type { Logger as PinoLogger } from 'pino';

import { PINO_LOGGER } from '../config/config.module';

interface AuthShape {
  userId?: string;
  organizationId?: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthShape;
  }
}

@Injectable()
export class AccessLogInterceptor implements NestInterceptor {
  constructor(@Inject(PINO_LOGGER) private readonly logger: PinoLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { requestId?: string }>();
    const res = http.getResponse<Response>();
    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => this.log(req, res, start),
        error: () => this.log(req, res, start),
      }),
    );
  }

  private log(req: Request, res: Response, start: number): void {
    const requestId = req.requestId ?? '';
    const payload: Record<string, unknown> = {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
    };
    const auth = req.auth;
    if (auth?.userId !== undefined) payload.userId = auth.userId;
    if (auth?.organizationId !== undefined) payload.organizationId = auth.organizationId;
    this.logger.info(payload, 'request');
  }
}
