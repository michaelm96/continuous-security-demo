// JsonDepthMiddleware. Walks req.body (already parsed by express.json upstream)
// and rejects bodies deeper than env.JSON_DEPTH_LIMIT (default 20) as
// 400/validation_failed via BadRequestException. Uses a WeakSet to
// short-circuit on circular references.

import {
  BadRequestException,
  Inject,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

export const DEPTH_LIMIT_TOKEN = 'JSON_DEPTH_LIMIT';

@Injectable()
export class JsonDepthMiddleware implements NestMiddleware {
  constructor(
    @Inject(DEPTH_LIMIT_TOKEN) private readonly limit: number,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    if (req.body === undefined || req.body === null) {
      next();
      return;
    }
    const seen = new WeakSet<object>();
    const depth = computeDepth(req.body, seen, 0);
    if (depth > this.limit) {
      next(new BadRequestException('JSON depth exceeds limit'));
      return;
    }
    next();
  }
}

function computeDepth(value: unknown, seen: WeakSet<object>, current: number): number {
  if (current > 1000) return current; // hard ceiling for pathological input
  if (value === null || typeof value !== 'object') return current;
  if (seen.has(value as object)) return current;
  seen.add(value as object);
  let max = current;
  if (Array.isArray(value)) {
    for (const item of value) {
      const d = computeDepth(item, seen, current + 1);
      if (d > max) max = d;
      if (max > 100) break; // give up early; will still fail the limit
    }
  } else {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const d = computeDepth(v, seen, current + 1);
      if (d > max) max = d;
      if (max > 100) break;
    }
  }
  return max;
}

