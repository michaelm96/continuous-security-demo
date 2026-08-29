import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { HealthModule } from './health/health.module';

// Order matters: AuditModule before AuthModule (AuthGuard depends on
// AuditService). DatabaseModule before AuthModule (MeService depends on
// CALLER_CLIENT). OrganizationsModule before any consumer that needs
// MembershipService (e.g. InvoicesModule in Task 7). HealthModule is
// self-contained (it owns its PG_POOL).
@Module({
  imports: [
    ConfigModule,
    CommonModule,
    DatabaseModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    HealthModule,
  ],
})
export class AppModule {}
