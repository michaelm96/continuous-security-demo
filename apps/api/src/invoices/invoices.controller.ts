// InvoicesController — REST surface for Task 7.
//
// Endpoints (all guarded by AuthGuard; body validated by global pipe):
//   GET    /organizations/:organizationId/invoices
//   POST   /organizations/:organizationId/invoices           (201 Created)
//   GET    /organizations/:organizationId/invoices/:invoiceId
//   PATCH  /organizations/:organizationId/invoices/:invoiceId (status only)
//
// Tenant/membership/role checks live in InvoiceService (which calls
// MembershipService.loadActiveMembership first). Cross-tenant targets are
// indistinguishable from missing (404). Insufficient role is 403 BEFORE
// the invoice client is touched. Illegal transitions are 409 invalid_state
// (mirrored by the DB trigger). Required rejection-audit failures map to
// 503 audit_unavailable.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { Principal } from '../auth/principal';
import { CurrentRequestId } from '../common/current-request-id.decorator';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { PatchInvoiceDto } from './dto/patch-invoice.dto';
import { InvoiceService, type InvoiceRow } from './invoice.service';

@Controller('organizations/:organizationId/invoices')
@UseGuards(AuthGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Param('organizationId') organizationId: string,
  ): Promise<InvoiceRow[]> {
    return this.invoices.list(principal, organizationId);
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('organizationId') organizationId: string,
    @CurrentRequestId() requestId: string,
    @Body() dto: CreateInvoiceDto,
  ): Promise<InvoiceRow> {
    return this.invoices.create(principal, organizationId, dto, requestId);
  }

  @Get(':invoiceId')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('organizationId') organizationId: string,
    @Param('invoiceId') invoiceId: string,
  ): Promise<InvoiceRow> {
    return this.invoices.get(principal, organizationId, invoiceId);
  }

  @Patch(':invoiceId')
  async updateStatus(
    @CurrentPrincipal() principal: Principal,
    @Param('organizationId') organizationId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentRequestId() requestId: string,
    @Body() dto: PatchInvoiceDto,
  ): Promise<InvoiceRow> {
    return this.invoices.updateStatus(principal, organizationId, invoiceId, dto, requestId);
  }
}