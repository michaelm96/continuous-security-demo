// CommonModule bundles cross-cutting concerns (request id, JSON depth,
// access log, problem-details filter, rate-limit). Mounts the three
// middlewares on every route via configure().

import {
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { ProblemDetailsFilter } from './problem-details.filter';
import { RequestIdMiddleware } from './request-id.middleware';
import { JsonDepthMiddleware, DEPTH_LIMIT_TOKEN } from './json-depth.middleware';
import { AccessLogInterceptor } from './access-log.interceptor';
import { RateLimitMiddleware } from './rate-limit.middleware';

import { AuditModule } from '../audit/audit.module';
import { ConfigModule } from '../config/config.module';
import type { Env } from '../config/env';

const DEPTH_LIMIT_FACTORY = {
  provide: DEPTH_LIMIT_TOKEN,
  useFactory: (env: Env) => env.JSON_DEPTH_LIMIT,
  inject: ['ENV'],
};

@Module({
  imports: [AuditModule, ConfigModule],
  providers: [
    DEPTH_LIMIT_FACTORY,
    RequestIdMiddleware,
    JsonDepthMiddleware,
    AccessLogInterceptor,
    RateLimitMiddleware,
    ProblemDetailsFilter,
    { provide: APP_INTERCEPTOR, useClass: AccessLogInterceptor },
  ],
  exports: [ProblemDetailsFilter, AccessLogInterceptor],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        RequestIdMiddleware,
        JsonDepthMiddleware,
        RateLimitMiddleware,
      )
      .forRoutes('*');
  }
}
