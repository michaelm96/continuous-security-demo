// RateLimitMiddleware. Two per-IP limiters keyed off req.ip:
//   - /auth/* uses RATE_LIMIT_AUTH_PER_MIN (default 60)
//   - everything else uses RATE_LIMIT_ANON_PER_MIN (default 20)
// standardHeaders: true emits RateLimit-* headers; legacyHeaders: false
// suppresses X-RateLimit-* to avoid confusion.

import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import rateLimit, {
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';

import type { Env } from '../config/env';

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly authLimiter: RateLimitRequestHandler;
  private readonly anonLimiter: RateLimitRequestHandler;

  constructor(@Inject('ENV') private readonly env: Env) {
    const keyFn = (req: Request): string => ipKeyGenerator(req.ip ?? 'unknown');
    this.authLimiter = rateLimit({
      windowMs: this.env.RATE_LIMIT_WINDOW_MS,
      max: this.env.RATE_LIMIT_AUTH_PER_MIN,
      keyGenerator: keyFn,
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.anonLimiter = rateLimit({
      windowMs: this.env.RATE_LIMIT_WINDOW_MS,
      max: this.env.RATE_LIMIT_ANON_PER_MIN,
      keyGenerator: keyFn,
      standardHeaders: true,
      legacyHeaders: false,
    });
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const limiter = req.path.startsWith('/auth/')
      ? this.authLimiter
      : this.anonLimiter;
    limiter(req, res, next);
  }
}
