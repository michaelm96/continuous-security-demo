// InvoicesModule — InvoiceService + InvoicesController. Depends on
// OrganizationsModule (for MembershipService) and AuthModule (for AuthGuard)
// and AuditModule (for AuditService) and DatabaseModule (for CALLER_CLIENT).

import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { InvoiceService } from './invoice.service';
import { InvoicesController } from './invoices.controller';

@Module({
  imports: [
    AuditModule,
    AuthModule,
    ConfigModule,
    DatabaseModule,
    OrganizationsModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoiceService],
})
export class InvoicesModule {}