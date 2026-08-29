// CurrentRequestId — param decorator that returns req.requestId attached
// by RequestIdMiddleware. Used by domain controllers to forward the API
// request UUID to AuditService.record() so the audit row is correlatable
// with the originating request.

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const CurrentRequestId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request & { requestId?: string }>();
    return req.requestId ?? 'unknown';
  },
);
