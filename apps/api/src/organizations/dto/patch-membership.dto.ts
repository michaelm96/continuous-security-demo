// PatchMembershipDto — strict allowlist for PATCH /organizations/:orgId/members/:userId.
// Global ValidationPipe enforces whitelist:true + forbidNonWhitelisted:true, so any
// unknown field (actor, organization, authority, synthetic sentinel) is rejected as
// 400/validation_failed by the global filter. The membership service also explicitly
// rejects `patch.role === undefined && patch.status === undefined` BEFORE the update
// — no decorated sentinel property is added here that would become whitelisted input.

import { IsIn, IsOptional } from 'class-validator';

export type MembershipRole = 'user' | 'manager' | 'organization_admin';
export type MembershipStatus = 'active' | 'suspended';

export class PatchMembershipDto {
  @IsOptional()
  @IsIn(['user', 'manager', 'organization_admin'])
  role?: MembershipRole;

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: MembershipStatus;
}
