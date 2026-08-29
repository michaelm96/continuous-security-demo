// InvoiceService unit spec — proves the Nest layer's decision order:
// loadActiveMembership is consulted BEFORE the invoice query/insert mock
// is touched. An inactive/insufficient caller must be rejected with
// NotFoundException/ForbiddenException; the invoice mock must never be
// invoked in those paths.
//
// Plan Task 7 Step 1: "In invoice.service.spec.ts, mock MembershipService
// and CALLER_CLIENT; assert an inactive/insufficient membership rejects
// BEFORE the invoice query/insert mock is called (proves Nest layer does
// not delegate to RLS)."

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { CallerClient } from '../database/caller-client';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../organizations/membership.service';
import type { Principal } from '../auth/principal';
import { InvoiceService } from './invoice.service';

// Minimal chainable query mock that satisfies supabase-js's fluent API:
// every chainable method returns the mock so .select().eq().maybeSingle()
// etc. can be chained. The fluent methods are typed as any/unknown to
// keep the test focused on whether they were called.
function createQueryMock() {
  const mock: any = {
    select: jest.fn(() => mock),
    insert: jest.fn(() => mock),
    update: jest.fn(() => mock),
    eq: jest.fn(() => mock),
    neq: jest.fn(() => mock),
    maybeSingle: jest.fn(),
    single: jest.fn(),
  };
  return mock;
}

function createSupabaseStub(queryMock: any): SupabaseClient {
  return {
    from: jest.fn(() => queryMock),
  } as unknown as SupabaseClient;
}

const principal: Principal = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  accessToken: 'fake-token',
};

describe('InvoiceService — membership gate runs BEFORE invoice query', () => {
  function setup(opts: {
    membership: () => Promise<unknown>;
    queryResult?: { data: unknown; error: unknown };
  }) {
    const queryMock = createQueryMock();
    if (opts.queryResult !== undefined) {
      queryMock.maybeSingle.mockResolvedValue(opts.queryResult);
      queryMock.single.mockResolvedValue(opts.queryResult);
    }
    const caller: CallerClient = jest.fn(() => createSupabaseStub(queryMock));
    const memberships = {
      loadActiveMembership: jest.fn(opts.membership),
    } as unknown as MembershipService;
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const service = new InvoiceService(caller, memberships, audit);
    return { service, caller, memberships, audit, queryMock };
  }

  it('list: 404 from loadActiveMembership rejects before invoice query', async () => {
    const { service, queryMock } = setup({
      membership: () => Promise.reject(new NotFoundException()),
    });
    await expect(service.list(principal, '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(NotFoundException);
    // The Supabase JS client was never instantiated because the caller
    // factory was never invoked. If the Nest layer had delegated to RLS
    // by going straight to the invoice client, queryMock would have been
    // populated.
    expect(queryMock.select).not.toHaveBeenCalled();
    expect(queryMock.insert).not.toHaveBeenCalled();
  });

  it('list: 403 (suspended caller) from loadActiveMembership rejects before invoice query', async () => {
    const { service, queryMock } = setup({
      membership: () => Promise.reject(new ForbiddenException()),
    });
    await expect(service.list(principal, '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(ForbiddenException);
    expect(queryMock.select).not.toHaveBeenCalled();
  });

  it('get: 404 from loadActiveMembership rejects before invoice query', async () => {
    const { service, queryMock } = setup({
      membership: () => Promise.reject(new NotFoundException()),
    });
    await expect(
      service.get(principal, '11111111-1111-4111-8111-111111111111', 'some-invoice-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(queryMock.select).not.toHaveBeenCalled();
  });

  it('create: insufficient role (user) rejects BEFORE invoice insert', async () => {
    const { service, queryMock } = setup({
      membership: () =>
        Promise.resolve({
          id: 'm1',
          organizationId: '11111111-1111-4111-8111-111111111111',
          userId: principal.userId,
          role: 'user',
          status: 'active',
        }),
    });
    await expect(
      service.create(
        principal,
        '11111111-1111-4111-8111-111111111111',
        { customerId: 'c', description: 'd', amountMinor: 1, currency: 'USD' },
        'req-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Insert must NEVER be called for an insufficient-role caller; this
    // proves the Nest layer does not delegate the role check to RLS.
    expect(queryMock.insert).not.toHaveBeenCalled();
  });

  it('create: loadActiveMembership failure rejects before invoice insert', async () => {
    const { service, queryMock } = setup({
      membership: () => Promise.reject(new NotFoundException()),
    });
    await expect(
      service.create(
        principal,
        '11111111-1111-4111-8111-111111111111',
        { customerId: 'c', description: 'd', amountMinor: 1, currency: 'USD' },
        'req-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(queryMock.insert).not.toHaveBeenCalled();
  });

  it('updateStatus: insufficient role (user) rejects BEFORE invoice select/update', async () => {
    const { service, queryMock } = setup({
      membership: () =>
        Promise.resolve({
          id: 'm1',
          organizationId: '11111111-1111-4111-8111-111111111111',
          userId: principal.userId,
          role: 'user',
          status: 'active',
        }),
    });
    await expect(
      service.updateStatus(
        principal,
        '11111111-1111-4111-8111-111111111111',
        'some-invoice-id',
        { status: 'issued' },
        'req-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queryMock.select).not.toHaveBeenCalled();
    expect(queryMock.update).not.toHaveBeenCalled();
  });
});