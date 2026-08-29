// RequestIdMiddleware. Reads `X-Request-Id` from the request, or generates a
// crypto.randomUUID() if absent. Sets req.requestId + the response header.
//
// CORS already allows the X-Request-Id header (main.ts) so clients can
// participate in the round-trip.

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const id =
      typeof incoming === 'string' && incoming.length > 0
        ? incoming
        : randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
