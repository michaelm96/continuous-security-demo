// Bootstrap helper. Applies the edge setup that both main.ts and the e2e
// tests need: helmet, body parsers, depth + rate-limit middlewares, CORS,
// ValidationPipe, ProblemDetailsFilter, OpenAPI. main.ts owns the env-validate
// + listen steps; this helper takes an already-built NestApplication.

import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';

import type { Env } from '../config/env';
import { JsonDepthMiddleware } from './json-depth.middleware';
import { RateLimitMiddleware } from './rate-limit.middleware';
import { ProblemDetailsFilter } from './problem-details.filter';
import { setupOpenApi } from './openapi.module';

export function applyEdge(app: INestApplication, env: Env): void {
  app.use(helmet());
  app.use(json({ limit: `${env.BODY_LIMIT_KB}kb` }));
  app.use(urlencoded({ extended: false, limit: `${env.BODY_LIMIT_KB}kb` }));

  const jsonDepth = app.get(JsonDepthMiddleware);
  const rateLimitMw = app.get(RateLimitMiddleware);
  app.use((req: unknown, res: unknown, next: unknown) =>
    jsonDepth.use(
      req as Parameters<JsonDepthMiddleware['use']>[0],
      res as Parameters<JsonDepthMiddleware['use']>[1],
      next as Parameters<JsonDepthMiddleware['use']>[2],
    ),
  );
  app.use((req: unknown, res: unknown, next: unknown) =>
    rateLimitMw.use(
      req as Parameters<RateLimitMiddleware['use']>[0],
      res as Parameters<RateLimitMiddleware['use']>[1],
      next as Parameters<RateLimitMiddleware['use']>[2],
    ),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: [env.WEB_ORIGIN],
    credentials: false,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  const filter = app.get(ProblemDetailsFilter);
  app.useGlobalFilters(filter);

  app.enableShutdownHooks();

  setupOpenApi(app, env);
}
