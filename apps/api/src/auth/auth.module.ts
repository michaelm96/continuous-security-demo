// AuthModule — JwtVerifier, AuthGuard, MeController, MeService. Wired after
// AuditModule (so AuditService is available) and after DatabaseModule (so
// CALLER_CLIENT is available).

import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { JwtVerifier } from './jwt-verifier';
import { AuthGuard } from './auth.guard';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [ConfigModule, AuditModule, DatabaseModule],
  controllers: [MeController],
  providers: [
    {
      provide: JwtVerifier,
      inject: [ENV],
      useFactory: (env: Env) => JwtVerifier.fromEnv(env),
    },
    AuthGuard,
    MeService,
  ],
})
export class AuthModule {}
