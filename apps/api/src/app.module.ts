import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { InvoicesModule } from './invoices/invoices.module';
import { HealthModule } from './health/health.module';

// Order matters: AuditModule before AuthModule (AuthGuard depends on
// AuditService). DatabaseModule before AuthModule (MeService depends on
// CALLER_CLIENT). OrganizationsModule before InvoicesModule (InvoiceService
// depends on MembershipService). HealthModule is self-contained (it owns
// its PG_POOL).
@Module({
  imports: [
    ConfigModule,
    CommonModule,
    DatabaseModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    InvoicesModule,
    HealthModule,
  ],
})
export class AppModule {}
