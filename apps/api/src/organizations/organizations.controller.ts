// OrganizationsController — REST surface for Task 6.
//
// Endpoints (all guarded by AuthGuard; body validated by global pipe):
//   GET    /organizations
//          → list organizations in which the caller has an active membership.
//   GET    /organizations/:organizationId/members
//          → list members of an organization (any active role).
//   PATCH  /organizations/:organizationId/members/:userId
//          → update role / status (organization_admin only).
//
// Cross-tenant and missing-resource responses are 404 (no detail leaks
// existence). Suspended callers are 403. Non-admin attempting PATCH is 403.
// Final-admin demotion/suspension is 409 last_admin. Empty PATCH body is
// 400 validation_failed. Required rejection audits failing surface as 503
// audit_unavailable (Spec §10.4).

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { CurrentRequestId } from '../common/current-request-id.decorator';
import type { Principal } from '../auth/principal';
import { PatchMembershipDto } from './dto/patch-membership.dto';
import {
  MembershipService,
  type MembershipRow,
  type OrganizationView,
} from './membership.service';

@Controller('organizations')
@UseGuards(AuthGuard)
export class OrganizationsController {
  constructor(private readonly memberships: MembershipService) {}

  @Get()
  async listOrganizations(
    @CurrentPrincipal() principal: Principal,
  ): Promise<OrganizationView[]> {
    return this.memberships.listOrganizations(principal);
  }

  @Get(':organizationId/members')
  async listMembers(
    @CurrentPrincipal() principal: Principal,
    @Param('organizationId') organizationId: string,
  ): Promise<MembershipRow[]> {
    return this.memberships.listMembers(principal, organizationId);
  }

  @Patch(':organizationId/members/:userId')
  async updateMember(
    @CurrentPrincipal() principal: Principal,
    @CurrentRequestId() requestId: string,
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
    @Body() patch: PatchMembershipDto,
  ): Promise<MembershipRow> {
    return this.memberships.updateMember(
      principal,
      organizationId,
      userId,
      patch,
      requestId,
    );
  }
}
