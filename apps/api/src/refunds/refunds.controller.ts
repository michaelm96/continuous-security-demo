// RefundsController — REST surface for Task 9.
//
// Endpoints (guarded by AuthGuard; body validated by global pipe):
//   POST   /organizations/:organizationId/invoices/:invoiceId/refunds  (201)
//
// Tenant/membership/role checks live in RefundService (which calls
// MembershipService.loadActiveMembership first, then enforces manager|admin).
// Cross-tenant targets are indistinguishable from missing (404 not_found).
// Insufficient role is 403 BEFORE the RPC is invoked (proves Nest layer
// does not delegate the role check to the DB function). SQL rejections
// are mapped to status/code pairs from Spec §10.1 by the service. Required
// rejection-audit failures map to 503 audit_unavailable (Spec §10.4).

import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { Principal } from '../auth/principal';
import { CurrentRequestId } from '../common/current-request-id.decorator';
import { CreateRefundDto } from './dto/create-refund.dto';
import { RefundService, type RefundRow } from './refund.service';

@Controller('organizations/:organizationId/invoices/:invoiceId/refunds')
@UseGuards(AuthGuard)
export class RefundsController {
  constructor(private readonly refunds: RefundService) {}

  @Post()
  @HttpCode(201)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('organizationId') organizationId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentRequestId() requestId: string,
    @Body() dto: CreateRefundDto,
  ): Promise<RefundRow> {
    return this.refunds.create(principal, organizationId, invoiceId, dto, requestId);
  }
}
