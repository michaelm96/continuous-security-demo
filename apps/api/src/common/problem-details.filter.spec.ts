// Unit tests for ProblemDetailsFilter's audit-on-400 behavior.
//
// Spec §5.2.6 / §10.4: every 400 must be audited through AuditService
// unless the originating service already stamped `req.auditRecorded = true`
// before throwing (services that throw audited rejections directly set the
// flag so the filter does not double-emit). If the audit write fails, the
// response is replaced with 503 audit_unavailable (fail-closed). The 413
// oversize-body path flows through the same audit-or-fail-closed branch.

import {
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ProblemDetailsFilter } from './problem-details.filter';
import { AuditService, AUDIT_UNAVAILABLE } from '../audit/audit.service';

interface MockReq extends Partial<Request> {
  requestId?: string;
  method: string;
  params?: Record<string, string>;
  route?: { path: string };
  principal?: { userId: string };
  auditRecorded?: boolean;
}

function makeReq(overrides: Partial<MockReq> = {}): MockReq {
  return {
    method: 'PATCH',
    requestId: 'req-123',
    params: { organizationId: 'org-1' },
    route: { path: '/organizations/:organizationId/members/:userId' },
    ...overrides,
  };
}

function makeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 0;
  let body: unknown = undefined;
  return {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status: (s: number) => {
      statusCode = s;
      return {
        json: (b: unknown) => {
          body = b;
          return undefined;
        },
      };
    },
    get headers() {
      return headers;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

function makeArgsHost(req: MockReq, res: ReturnType<typeof makeRes>): {
  switchToHttp: () => { getRequest: () => unknown; getResponse: () => unknown };
} {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  };
}

const baseDeps = {
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
    trace: jest.fn(),
  },
  nodeEnv: 'test',
};

function makeFilter(audit: AuditService): ProblemDetailsFilter {
  return new ProblemDetailsFilter(baseDeps.logger as never, baseDeps.nodeEnv, audit);
}

describe('ProblemDetailsFilter — audit-on-400', () => {
  it('records audit on 400 ValidationPipe failure and returns 400', async () => {
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const filter = makeFilter(audit);
    const req = makeReq();
    const res = makeRes();

    const exc = new BadRequestException({
      message: 'role must be one of: user, manager, organization_admin',
    });
    await filter.catch(exc, makeArgsHost(req, res) as never);

    expect((audit.record as jest.Mock).mock.calls).toHaveLength(1);
    const call = (audit.record as jest.Mock).mock.calls[0][0];
    expect(call).toMatchObject({
      actorId: null,
      organizationId: 'org-1',
      action: 'api.validation',
      targetType: 'PATCH /organizations/:organizationId/members/:userId',
      targetId: null,
      result: 'rejected',
      correlationId: 'req-123',
      metadata: {
        code: 'validation_failed',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      status: 400,
      code: 'validation_failed',
      requestId: 'req-123',
    });
  });

  it('uses principal.userId as actorId when present', async () => {
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const filter = makeFilter(audit);
    const req = makeReq({
      principal: { userId: 'user-abc' },
    });
    const res = makeRes();

    await filter.catch(new BadRequestException('bad'), makeArgsHost(req, res) as never);

    const call = (audit.record as jest.Mock).mock.calls[0][0];
    expect(call.actorId).toBe('user-abc');
  });

  it('skips audit on 400 when req.auditRecorded is true (service already audited)', async () => {
    // Spec §5.2.6 leaves room for services that already recorded their own
    // rejection audit before throwing 400. They stamp
    // `req.auditRecorded = true` on the request; the filter honors the
    // flag and does not emit a second row. The response itself is still
    // emitted (the filter is not the audit source — only an enforcement
    // layer for the mandatory case).
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const filter = makeFilter(audit);
    const req = makeReq({ auditRecorded: true });
    const res = makeRes();

    await filter.catch(new BadRequestException('bad'), makeArgsHost(req, res) as never);

    expect((audit.record as jest.Mock).mock.calls).toHaveLength(0);
    expect(res.statusCode).toBe(400);
  });

  it('replaces 400 with 503 audit_unavailable when audit write fails', async () => {
    const audit = {
      record: jest.fn().mockRejectedValue(new Error(AUDIT_UNAVAILABLE)),
    } as unknown as AuditService;
    const filter = makeFilter(audit);
    const req = makeReq();
    const res = makeRes();

    await filter.catch(new BadRequestException('bad'), makeArgsHost(req, res) as never);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      status: 503,
      code: 'audit_unavailable',
      requestId: 'req-123',
    });
  });

  it('logs one redacted line when audit write fails (without token/headers/body)', async () => {
    const audit = {
      record: jest.fn().mockRejectedValue(new Error(AUDIT_UNAVAILABLE)),
    } as unknown as AuditService;
    const filter = makeFilter(audit);
    const req = makeReq({
      headers: {
        authorization: 'Bearer should-not-leak-xyz',
      } as never,
    });
    const res = makeRes();

    // baseDeps.logger.error is shared across tests in this describe block
    // (Jest does not auto-reset module-level mocks). Clear it so this
    // assertion observes only the log emitted by THIS filter.catch call.
    (baseDeps.logger.error as jest.Mock).mockClear();

    await filter.catch(new BadRequestException('bad'), makeArgsHost(req, res) as never);

    const errorCalls = (baseDeps.logger.error as jest.Mock).mock.calls;
    expect(errorCalls).toHaveLength(1);
    const logPayload = JSON.stringify(errorCalls[0]);
    expect(logPayload).not.toContain('should-not-leak-xyz');
    expect(logPayload).not.toContain('Bearer');
    expect(logPayload).toContain('audit_unavailable');
    expect(logPayload).toContain('req-123');
  });

  it('audits 413 oversize body as 400 validation_failed and fails closed', async () => {
    // Spec §5.2.6 — every 400 must be audited, and the 413 branch maps to a
    // 400 response. The oversize path must therefore go through the same
    // audit-or-fail-closed branch (round-2 Critical finding).
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const filter = makeFilter(audit);
    const req = makeReq();
    const res = makeRes();

    const exc = { status: 413, type: 'entity.too.large' } as unknown as Error;
    await filter.catch(exc, makeArgsHost(req, res) as never);

    expect((audit.record as jest.Mock).mock.calls).toHaveLength(1);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      status: 400,
      code: 'validation_failed',
      requestId: 'req-123',
      detail: 'oversize_body',
    });
  });

  it('replaces 413-derived 400 with 503 audit_unavailable when audit fails', async () => {
    const audit = {
      record: jest.fn().mockRejectedValue(new Error(AUDIT_UNAVAILABLE)),
    } as unknown as AuditService;
    const filter = makeFilter(audit);
    const req = makeReq();
    const res = makeRes();

    const exc = { status: 413, type: 'entity.too.large' } as unknown as Error;
    await filter.catch(exc, makeArgsHost(req, res) as never);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      status: 503,
      code: 'audit_unavailable',
      requestId: 'req-123',
    });
  });

  it('truncates detail to 200 chars and never includes token/headers/body', async () => {
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const filter = makeFilter(audit);
    const req = makeReq({
      headers: {
        authorization: 'Bearer should-not-leak-xyz',
        'content-type': 'application/json',
      } as never,
    });
    const res = makeRes();

    const longMessage = 'x'.repeat(500);
    await filter.catch(new BadRequestException(longMessage), makeArgsHost(req, res) as never);

    const call = (audit.record as jest.Mock).mock.calls[0][0];
    const detail = call.metadata.detail as string;
    expect(detail.length).toBe(200);
    // Token / headers / body must never appear in the audit event.
    expect(JSON.stringify(call)).not.toContain('should-not-leak-xyz');
    expect(JSON.stringify(call)).not.toContain('Bearer');
  });

  it('uses "unknown" as targetType when req.route is undefined', async () => {
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const filter = makeFilter(audit);
    const req = makeReq({ route: undefined });
    const res = makeRes();

    await filter.catch(new BadRequestException('bad'), makeArgsHost(req, res) as never);

    const call = (audit.record as jest.Mock).mock.calls[0][0];
    expect(call.targetType).toBe('unknown');
  });

  it('does not audit on 404 / 403 / 401 (only 400 + 413)', async () => {
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const filter = makeFilter(audit);
    const res = makeRes();

    for (const exc of [
      new HttpException('not found', 404),
      new HttpException('forbidden', 403),
      new HttpException('unauthenticated', 401),
    ]) {
      const req = makeReq();
      await filter.catch(exc, makeArgsHost(req, res) as never);
    }

    expect((audit.record as jest.Mock).mock.calls).toHaveLength(0);
  });
});
