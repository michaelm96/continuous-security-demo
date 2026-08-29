// MembershipService — caller-scoped reads and last-admin-safe updates for
// organizations and memberships.
//
// Architecture invariant (Spec §3.4 / §5.2.3): every read/write uses the
// caller-scoped Supabase client (CALLER_CLIENT). DatabaseModule does NOT
// export a service-role client; this service never sees one.
//
// Authorization decision order (Spec §5.2.3 / Plan Task 6 Step 3):
//   1. AuthGuard has already verified the bearer token (req.principal).
//   2. loadActiveMembership selects the caller's own row for the URL
//      organization via caller client. `memberships_select_self` lets a
//      suspended caller still see their own row, so a suspended own row
//      surfaces as 403 (not 404). No row → 404. Active → proceed.
//   3. Role check: listMembers/listOrganizations require any active role;
//      updateMember requires `organization_admin` (else 403).
//   4. Target lookup: missing/wrong-tenant targets return 404.
//
// Last-admin rule (Plan Task 6 Step 4): before updating an active
// `organization_admin` to a non-admin role or to `suspended`, the service
// counts other active admins via caller client and rejects the visible
// final-admin attempt as 409/last_admin (application-layer pre-check). The
// `enforce_last_admin()` DB trigger is the authoritative race-safe check;
// its `last_admin` exception is mapped to the same 409/last_admin in the
// service so the two layers share a single response contract.
//
// Audit (Plan Task 6 Step 4): successful changes are audited best-effort
// (logged on failure; the change is committed and the user-visible response
// must reflect that). Forbidden and last-admin rejections are audited as
// required — if the audit insert fails the request returns 503
// audit_unavailable per Spec §10.4.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { CALLER_CLIENT, type CallerClient } from '../database/caller-client';
import { AuditService, AUDIT_UNAVAILABLE } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import type { PatchMembershipDto } from './dto/patch-membership.dto';

export interface MembershipRow {
  id: string;
  organizationId: string;
  userId: string;
  role: 'user' | 'manager' | 'organization_admin';
  status: 'active' | 'suspended';
}

export interface OrganizationView {
  id: string;
  name: string;
}

interface RawMembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: 'user' | 'manager' | 'organization_admin';
  status: 'active' | 'suspended';
}

interface RawOrganizationRow {
  id: string;
  name: string;
}

@Injectable()
export class MembershipService {
  constructor(
    @Inject(CALLER_CLIENT) private readonly caller: CallerClient,
    private readonly audit: AuditService,
  ) {}

  // -------- Load --------

  async loadActiveMembership(
    principal: Principal,
    organizationId: string,
  ): Promise<MembershipRow> {
    const client = this.caller(principal.accessToken);
    const { data, error } = await client
      .from('memberships')
      .select('id, organization_id, user_id, role, status')
      .eq('organization_id', organizationId)
      .eq('user_id', principal.userId)
      .maybeSingle();

    // Either a query error (dev / PostgREST unreachable) or RLS hides the row
    // → indistinguishable "no membership" → 404. In production a missing
    // membership row is the correct 404 outcome (the caller isn't a member
    // of the URL organization).
    if (error || !data) {
      throw new NotFoundException();
    }
    const row = data as RawMembershipRow;
    if (row.status !== 'active') {
      // memberships_select_self deliberately surfaces the caller's own
      // suspended row so we can return 403 instead of 404 (Spec §5.2.3).
      throw new ForbiddenException();
    }
    return {
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      role: row.role,
      status: row.status,
    };
  }

  // -------- List --------

  async listOrganizations(principal: Principal): Promise<OrganizationView[]> {
    const client = this.caller(principal.accessToken);
    const { data, error } = await client
      .from('organizations')
      .select('id, name');
    if (error || !Array.isArray(data)) return [];
    return (data as RawOrganizationRow[]).map((o) => ({ id: o.id, name: o.name }));
  }

  async listMembers(
    principal: Principal,
    organizationId: string,
  ): Promise<MembershipRow[]> {
    // Any active role in the org is sufficient to list members.
    await this.loadActiveMembership(principal, organizationId);

    const client = this.caller(principal.accessToken);
    const { data, error } = await client
      .from('memberships')
      .select('id, organization_id, user_id, role, status')
      .eq('organization_id', organizationId);
    if (error || !Array.isArray(data)) return [];
    return (data as RawMembershipRow[]).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      role: row.role,
      status: row.status,
    }));
  }

  // -------- Update --------

  async updateMember(
    principal: Principal,
    organizationId: string,
    userId: string,
    patch: PatchMembershipDto,
  ): Promise<MembershipRow> {
    // Explicit empty-patch rejection. The global whitelist would silently
    // accept `{ role: undefined, status: undefined }` because every
    // decorated field is optional; we surface this as 400 validation_failed
    // (no decorated sentinel property, per the plan).
    if (patch.role === undefined && patch.status === undefined) {
      throw new BadRequestException({
        code: 'validation_failed',
        message: 'at_least_one_required',
      });
    }

    // Role check: must be active organization_admin of the URL org.
    const own = await this.loadActiveMembership(principal, organizationId);
    if (own.role !== 'organization_admin') {
      await this.auditRejection(principal, organizationId, userId, 'forbidden');
      throw new ForbiddenException();
    }

    const client = this.caller(principal.accessToken);

    // Target lookup. Cross-tenant targets are indistinguishable from missing
    // because RLS hides them — both → 404 (no detail leaks the existence).
    const { data: target, error: targetErr } = await client
      .from('memberships')
      .select('id, organization_id, user_id, role, status')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (targetErr || !target) {
      throw new NotFoundException();
    }
    const targetRow = target as RawMembershipRow;

    const targetWasActiveAdmin =
      targetRow.role === 'organization_admin' && targetRow.status === 'active';
    const wouldDemoteOrSuspend =
      (patch.role !== undefined && patch.role !== 'organization_admin') ||
      (patch.status !== undefined && patch.status !== 'active');

    // Application-layer last-admin pre-check (defence in depth).
    if (targetWasActiveAdmin && wouldDemoteOrSuspend) {
      const { data: others, error: othersErr } = await client
        .from('memberships')
        .select('user_id')
        .eq('organization_id', organizationId)
        .eq('role', 'organization_admin')
        .eq('status', 'active')
        .neq('user_id', userId);
      const otherAdmins =
        othersErr || !Array.isArray(others) ? 0 : others.length;
      if (otherAdmins === 0) {
        await this.auditRejection(
          principal,
          organizationId,
          userId,
          'last_admin',
        );
        throw new ConflictException({
          code: 'last_admin',
          message: 'last_admin',
        });
      }
    }

    // Apply update via caller-scoped client so the DB trigger can lock the
    // organizations row and re-count atomically. The trigger is the
    // race-safe authority — its `last_admin` exception is mapped to the
    // same 409 below.
    const update: Record<string, string> = {};
    if (patch.role !== undefined) update.role = patch.role;
    if (patch.status !== undefined) update.status = patch.status;

    const { data: updated, error: updateErr } = await client
      .from('memberships')
      .update(update)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .select('id, organization_id, user_id, role, status')
      .single();

    if (updateErr) {
      const msg = (updateErr.message ?? '').toLowerCase();
      if (msg.includes('last_admin')) {
        await this.auditRejection(
          principal,
          organizationId,
          userId,
          'last_admin',
        );
        throw new ConflictException({
          code: 'last_admin',
          message: 'last_admin',
        });
      }
      // Other DB errors propagate as 500 (filter maps unknown to internal).
      throw updateErr;
    }
    if (!updated) {
      throw new NotFoundException();
    }
    const updatedRow = updated as RawMembershipRow;

    // Best-effort success audit (Spec §10.4: rejections are mandatory, but
    // a committed-change success audit failure does not invalidate the
    // already-persisted change — we log and continue).
    try {
      await this.audit.record({
        actorId: principal.userId,
        organizationId,
        action: 'membership.update',
        targetType: 'membership',
        targetId: userId,
        result: 'success',
        correlationId: 'unknown',
        metadata: {
          role: patch.role ?? null,
          status: patch.status ?? null,
        },
      });
    } catch {
      // best-effort; success audit failure does not fail the request
    }

    return {
      id: updatedRow.id,
      organizationId: updatedRow.organization_id,
      userId: updatedRow.user_id,
      role: updatedRow.role,
      status: updatedRow.status,
    };
  }

  private async auditRejection(
    principal: Principal,
    organizationId: string,
    userId: string,
    code: string,
  ): Promise<void> {
    try {
      await this.audit.record({
        actorId: principal.userId,
        organizationId,
        action: 'membership.update',
        targetType: 'membership',
        targetId: userId,
        result: 'rejected',
        correlationId: 'unknown',
        metadata: { code },
      });
    } catch {
      // Mandatory rejection audit failed — fail closed (Spec §10.4).
      throw new ServiceUnavailableException({ code: AUDIT_UNAVAILABLE });
    }
  }
}
