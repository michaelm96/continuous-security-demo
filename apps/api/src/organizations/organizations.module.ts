// OrganizationsModule — MembershipService + OrganizationsController.
// Exports MembershipService so the InvoicesModule (Task 7) can call
// loadActiveMembership(principal, organizationId) before every invoice op.
// Depends on AuthModule (AuthGuard for the route), AuditModule (AuditService
// for membership.update events) and DatabaseModule (CALLER_CLIENT for
// caller-scoped reads/writes).

import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { MembershipService } from './membership.service';
import { OrganizationsController } from './organizations.controller';

@Module({
  imports: [AuditModule, AuthModule, DatabaseModule],
  controllers: [OrganizationsController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class OrganizationsModule {}
