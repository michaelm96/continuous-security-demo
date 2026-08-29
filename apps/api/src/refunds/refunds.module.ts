// RefundsModule — RefundService + RefundsController. Depends on
// OrganizationsModule (for MembershipService), AuthModule (AuthGuard for
// the route), AuditModule (AuditService for mandatory rejection audits)
// and DatabaseModule (CALLER_CLIENT for caller-scoped RPC invocation).

import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RefundService } from './refund.service';
import { RefundsController } from './refunds.controller';

@Module({
  imports: [
    AuditModule,
    AuthModule,
    ConfigModule,
    DatabaseModule,
    OrganizationsModule,
  ],
  controllers: [RefundsController],
  providers: [RefundService],
})
export class RefundsModule {}
