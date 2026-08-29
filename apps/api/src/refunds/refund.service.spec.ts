import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import type { CallerClient } from '../database/caller-client';
import { MembershipService } from '../organizations/membership.service';
import { RefundService } from './refund.service';

const principal: Principal = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  accessToken: 'fake-token',
};
const organizationId = '11111111-1111-4111-8111-111111111111';
const invoiceId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const dto = {
  amountMinor: 100,
  currency: 'USD',
  reason: 'partial refund',
  idempotencyKey: 'idem-1',
};

function setup(options: {
  membership?: () => Promise<unknown>;
  rpcResult?: { data: unknown; error: unknown };
  auditError?: Error;
} = {}) {
  const single = jest.fn().mockResolvedValue(
    options.rpcResult ?? {
      data: {
        id: 'refund-1',
        invoice_id: invoiceId,
        organization_id: organizationId,
        created_by: principal.userId,
        amount_minor: '100',
        currency: 'USD',
        reason: 'partial refund',
        idempotency_key: 'idem-1',
        created_at: '2026-08-29T00:00:00.000Z',
      },
      error: null,
    },
  );
  const rpc = jest.fn(() => ({ single }));
  const client = { rpc } as unknown as SupabaseClient;
  const caller: CallerClient = jest.fn(() => client);
  const memberships = {
    loadActiveMembership: jest.fn(
      options.membership ??
        (() =>
          Promise.resolve({
            id: 'membership-1',
            organizationId,
            userId: principal.userId,
            role: 'manager',
            status: 'active',
          })),
    ),
  } as unknown as MembershipService;
  const record = options.auditError
    ? jest.fn().mockRejectedValue(options.auditError)
    : jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;
  const logger = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as any;
  return {
    service: new RefundService(caller, memberships, audit, logger),
    rpc,
    single,
    record,
    logger,
  };
}

async function thrown(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected rejection');
}

function create(service: RefundService) {
  return service.create(principal, organizationId, invoiceId, dto, requestId);
}

function expectRejectedAudit(record: jest.Mock, code: string): void {
  expect(record).toHaveBeenCalledTimes(1);
  expect(record).toHaveBeenCalledWith({
    actorId: principal.userId,
    organizationId,
    action: 'refund.create',
    targetType: 'refund',
    targetId: null,
    result: 'rejected',
    correlationId: requestId,
    metadata: { code },
  });
}

describe('RefundService', () => {
  it('rejects a user role before RPC and records the correlated rejection', async () => {
    const { service, rpc, record } = setup({
      membership: () =>
        Promise.resolve({
          id: 'membership-1',
          organizationId,
          userId: principal.userId,
          role: 'user',
          status: 'active',
        }),
    });

    await expect(create(service)).rejects.toBeInstanceOf(ForbiddenException);
    expect(rpc).not.toHaveBeenCalled();
    expectRejectedAudit(record, 'forbidden');
  });

  it('propagates missing membership without auditing or invoking RPC', async () => {
    const { service, rpc, record } = setup({
      membership: () => Promise.reject(new NotFoundException()),
    });

    await expect(create(service)).rejects.toBeInstanceOf(NotFoundException);
    expect(rpc).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('propagates suspended membership without auditing or invoking RPC', async () => {
    const { service, rpc, record } = setup({
      membership: () => Promise.reject(new ForbiddenException()),
    });

    await expect(create(service)).rejects.toBeInstanceOf(ForbiddenException);
    expect(rpc).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('calls RPC with SQL argument names, extracts one row, and does not audit success', async () => {
    const { service, rpc, single, record } = setup();

    await expect(create(service)).resolves.toEqual({
      id: 'refund-1',
      invoiceId,
      organizationId,
      createdBy: principal.userId,
      amountMinor: 100,
      currency: 'USD',
      reason: 'partial refund',
      idempotencyKey: 'idem-1',
      createdAt: '2026-08-29T00:00:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('create_refund', {
      p_invoice_id: invoiceId,
      p_amount_minor: 100,
      p_currency: 'USD',
      p_reason: 'partial refund',
      p_idempotency_key: 'idem-1',
      p_request_id: requestId,
    });
    expect(single).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
  });

  it('maps exact unauthenticated to 401 and audits it', async () => {
    const { service, record } = setup({
      rpcResult: { data: null, error: { message: 'unauthenticated' } },
    });

    await expect(create(service)).rejects.toBeInstanceOf(UnauthorizedException);
    expectRejectedAudit(record, 'unauthenticated');
  });

  for (const code of ['invalid_amount', 'currency_mismatch'] as const) {
    it(`maps exact ${code} to an already-audited 400 with its explicit code`, async () => {
      const { service, record } = setup({
        rpcResult: { data: null, error: { message: code } },
      });

      const error = await thrown(create(service));
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getStatus()).toBe(400);
      expect(error.getResponse()).toMatchObject({ code });
      expect(error.auditRecorded).toBe(true);
      expectRejectedAudit(record, code);
    });
  }

  it('does not classify an arbitrary substring as a known SQL rejection', async () => {
    const { service, record } = setup({
      rpcResult: {
        data: null,
        error: { message: 'unexpected invalid_amount diagnostic' },
      },
    });

    const error = await thrown(create(service));
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getResponse()).toMatchObject({ code: 'internal' });
    expectRejectedAudit(record, 'internal');
  });

  it('audits unknown RPC failures then returns 500 internal', async () => {
    const { service, record, logger } = setup({
      rpcResult: { data: null, error: { message: 'database detail' } },
    });

    const error = await thrown(create(service));
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getStatus()).toBe(500);
    expect(error.getResponse()).toMatchObject({ code: 'internal' });
    expectRejectedAudit(record, 'internal');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('database detail');
  });

  it('audits a no-data RPC response then returns 500 internal', async () => {
    const { service, record } = setup({
      rpcResult: { data: null, error: null },
    });

    const error = await thrown(create(service));
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getResponse()).toMatchObject({ code: 'internal' });
    expectRejectedAudit(record, 'internal');
  });

  it('fails closed with 503 when a required rejection audit is unavailable', async () => {
    const { service } = setup({
      membership: () =>
        Promise.resolve({ role: 'user', status: 'active' }),
      auditError: new Error('audit_unavailable'),
    });

    const error = await thrown(create(service));
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getResponse()).toMatchObject({ code: 'audit_unavailable' });
  });
});
