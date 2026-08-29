// Step 1 RED — failing e2e tests. Step 2+ will wire up the modules these test.
//
// Coverage (11 scenarios from brief):
//  1.  Request ID round-trip (auto + echo of client header)
//  2.  404 Problem Details on unknown route
//  3.  OpenAPI disabled → /docs-json and /docs return 404 Problem Details
//  4.  OpenAPI enabled → /docs-json returns OpenAPI JSON
//  5.  Health 503 when DB unreachable (dependency_unavailable)
//  6.  Health 200 happy path
//  7.  CORS preflight
//  8.  Body size limit
//  9.  JSON depth limit
// 10.  Bad JSON body
// 11.  Pino redaction: Authorization header never appears in log output
//
// We construct the Nest app via Test.createTestingModule + .createNestApplication
// so the HTTP server + middleware pipeline are exercised end-to-end.

import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'http';

import { AppModule } from '../src/app.module';
import { applyEdge } from '../src/common/bootstrap-app';
import { loadEnv } from '../src/config/env';
import { signIn } from './helpers/auth';
import { SEED_IDENTITIES, SEED_IDS } from './helpers/seed-identities';
import { AuditService } from '../src/audit/audit.service';
import { HEALTH_CLIENT } from '../src/health/health.service';

const HAS_DB = !!process.env.SUPABASE_DB_URL;

describe('AppModule (e2e)', () => {
  let app: INestApplication<Server>;
  let moduleFixture: TestingModule;
  let auditRecord: jest.Mock;

  beforeEach(async () => {
    // Mock AuditService so the happy 400 path returns 400 (not 503) in
    // the dev env where the fake SUPABASE_URL cannot reach PostgREST.
    // Every spec-mandated 400 MUST trigger an audit (Spec §5.2.6); the
    // dedicated fail-closed test below overrides the mock to throw and
    // verifies 503 audit_unavailable (Spec §10.4). Tests that want to
    // assert on the audit payload (e.g. the validation rejection path)
    // pull `auditRecord` from the closure and inspect call args.
    auditRecord = jest.fn().mockResolvedValue(undefined);
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuditService)
      .useValue({ record: auditRecord })
      .compile();
    app = moduleFixture.createNestApplication({ logger: false });
    applyEdge(app, loadEnv(process.env));
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('1) request id round-trips: absent → server-generated; present → echoed', async () => {
    const server = app.getHttpServer();
    const absent = await request(server).get('/health');
    const autoId = absent.headers['x-request-id'];
    expect(typeof autoId).toBe('string');
    expect(autoId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const customId = randomUUID();
    const echoed = await request(server)
      .get('/health')
      .set('X-Request-Id', customId);
    expect(echoed.headers['x-request-id']).toBe(customId);
  });

  it('2) unknown route returns 404 Problem Details with code=not_found', async () => {
    const res = await request(app.getHttpServer()).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      status: 404,
      code: 'not_found',
      title: expect.any(String),
      requestId: expect.any(String),
    });
    expect(res.body.detail).toBeUndefined();
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  it('3) /docs-json returns 404 Problem Details when OPENAPI_ENABLED=false', async () => {
    const saved = process.env.OPENAPI_ENABLED;
    process.env.OPENAPI_ENABLED = 'false';
    try {
      await app.close();
      moduleFixture = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication({ logger: false });
      applyEdge(app, loadEnv(process.env));
      await app.init();
      const res = await request(app.getHttpServer()).get('/docs-json');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    } finally {
      if (saved === undefined) {
        delete process.env.OPENAPI_ENABLED;
      } else {
        process.env.OPENAPI_ENABLED = saved;
      }
    }
  });

  it('4) /docs-json returns 200 OpenAPI JSON when OPENAPI_ENABLED=true (default in non-production)', async () => {
    process.env.OPENAPI_ENABLED = 'true';
    try {
      await app.close();
      moduleFixture = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication({ logger: false });
      applyEdge(app, loadEnv(process.env));
      await app.init();
      const res = await request(app.getHttpServer()).get('/docs-json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBeDefined();
      expect(res.body.paths['/health']).toBeDefined();
    } finally {
      delete process.env.OPENAPI_ENABLED;
    }
  });

  it('5) /health returns 503 dependency_unavailable when DB unreachable', async () => {
    // Simulate DB failure by overriding HEALTH_CLIENT (the injected DB probe client).
    // HealthModule does not export HealthService, so we override its injected
    // HEALTH_CLIENT dependency instead.  This avoids a fake DATABASE_URL which
    // would fail loadEnv validation (DATABASE_URL is no longer a known env key).
    const moduleFixture2 = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HEALTH_CLIENT)
      .useValue({
        rpc: () => ({
          abortSignal: () => Promise.reject(new Error('db_unreachable')),
        }),
      })
      .compile();
    const app2 = moduleFixture2.createNestApplication({ logger: false });
    applyEdge(app2, loadEnv(process.env));
    await app2.init();
    try {
      const res = await request(app2.getHttpServer()).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('dependency_unavailable');
    } finally {
      await app2.close();
      await moduleFixture2.close();
    }
  }, 15000);

  (HAS_DB ? it : it.skip)(
    '6) /health returns 200 { status: "ok" } when DB is reachable',
    async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
      expect(res.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    },
  );

  it('7) CORS preflight: Origin allowed → CORS headers present', async () => {
    const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    const res = await request(app.getHttpServer())
      .options('/health')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('7b) CORS preflight: Origin NOT allowed → no Access-Control-Allow-Origin', async () => {
    const res = await request(app.getHttpServer())
      .options('/health')
      .set('Origin', 'http://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('8) body size limit: oversize body returns 400 validation_failed', async () => {
    const huge = 'x'.repeat(150 * 1024); // 150 KB > 100 KB default
    const res = await request(app.getHttpServer())
      .post('/does-not-exist')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ big: huge }));
    expect([400, 413]).toContain(res.status);
    expect(res.body.code).toBe('validation_failed');
  });

  it('9) JSON depth limit: nested arrays > 20 levels returns 400 validation_failed', async () => {
    let nested: unknown = 'leaf';
    for (let i = 0; i < 25; i++) {
      nested = { a: nested };
    }
    const res = await request(app.getHttpServer())
      .post('/does-not-exist')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ nested }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('10) bad JSON body returns 400 validation_failed', async () => {
    const res = await request(app.getHttpServer())
      .post('/does-not-exist')
      .set('Content-Type', 'application/json')
      .set('X-Request-Id', 'bad-json-req-1')
      .send('this is not json');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    // requestId must be echoed in both header and body even when the error
    // originates from body-parser (which runs before Nest middlewares).
    expect(res.headers['x-request-id']).toBe('bad-json-req-1');
    expect(res.body.requestId).toBe('bad-json-req-1');
  });

  it('11) pino never logs the Authorization header value', async () => {
    const captured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    const origErrWrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      captured.push(String(chunk));
      return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
      captured.push(String(chunk));
      return (origErrWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stderr.write;
    try {
      await request(app.getHttpServer())
        .get('/health')
        .set('Authorization', 'Bearer should-never-appear-in-logs-fake-token-xyz');
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.stdout.write = origWrite;
      process.stderr.write = origErrWrite;
    }
    const blob = captured.join('\n');
    expect(blob).not.toContain('should-never-appear-in-logs-fake-token-xyz');
    expect(blob).not.toContain('Bearer should-never-appear');
  });

  // ===========================================================================
  // Task 5 — JWT verification + /me. With real GoTrue sign-in, the JWT
  // verifies correctly against the ES256 JWKS endpoint.
  // ===========================================================================
  describe('Task 5: GET /me', () => {
    it('returns caller userId from verified JWT', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaUserA);
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(SEED_IDENTITIES.alphaUserA.userId);
    });

    it('memberships is always an array', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaUserA);
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.memberships)).toBe(true);
    });
  });

  // ===========================================================================
  // Task 6 — Organizations + Memberships. DTO validation runs before any
  // controller logic, so these return 400 regardless of DB state.
  // ===========================================================================
  describe('Task 6: PATCH /organizations/:organizationId/members/:userId DTO validation', () => {
    it('rejects empty body {} as 400 validation_failed', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaAdmin);
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${SEED_IDS.alphaOrg}/members/${SEED_IDS.alphaUserA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.requestId).toBeDefined();
      expect(res.body.status).toBe(400);
      expect(res.body.title).toBe('Validation Failed');
    });

    it('rejects synthetic { atLeastOne: true } field as unknown 400 validation_failed', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaAdmin);
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${SEED_IDS.alphaOrg}/members/${SEED_IDS.alphaUserA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ atLeastOne: true });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('rejects authority mass assignment { actor: ..., organization: ..., status: "user" } as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaAdmin);
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${SEED_IDS.alphaOrg}/members/${SEED_IDS.alphaUserA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ actor: SEED_IDS.alphaAdmin, organization: 'root', role: 'user' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('rejects role outside the whitelist ("superuser") as 400 validation_failed', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaAdmin);
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${SEED_IDS.alphaOrg}/members/${SEED_IDS.alphaUserA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'superuser' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('rejects status outside the whitelist ("deleted") as 400 validation_failed', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaAdmin);
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${SEED_IDS.alphaOrg}/members/${SEED_IDS.alphaUserA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'deleted' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('accepts { role: "manager" } alone (passes DTO; downstream may return 404/403 in dev)', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaAdmin);
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${SEED_IDS.alphaOrg}/members/${SEED_IDS.alphaUserA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'manager' });
      // DTO accepted; downstream behavior depends on DB/audit state.
      expect([200, 404, 403, 409]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.role).toBe('manager');
      }
    });

    it('accepts { status: "suspended" } alone (passes DTO)', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaAdmin);
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${SEED_IDS.alphaOrg}/members/${SEED_IDS.alphaUserA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'suspended' });
      expect([200, 404, 403, 409]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.status).toBe('suspended');
      }
    });
  });

  // ===========================================================================
  // Task 7 — Invoices + ownership + state transitions. DTO validation runs
  // before any controller logic.
  // ===========================================================================
  describe('Task 7: invoice DTO allowlists', () => {
    it('CreateInvoiceDto rejects amountMinor = 0 as 400 validation_failed', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(`/organizations/${SEED_IDS.alphaOrg}/invoices`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId: 'cust-1',
          description: 'desc',
          amountMinor: 0,
          currency: 'USD',
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('CreateInvoiceDto rejects amountMinor = 9007199254740992 as 400 (above bigint max)', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(`/organizations/${SEED_IDS.alphaOrg}/invoices`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId: 'cust-1',
          description: 'desc',
          amountMinor: '9007199254740992',
          currency: 'USD',
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('CreateInvoiceDto accepts amountMinor = 9007199254740991 (the ceiling)', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(`/organizations/${SEED_IDS.alphaOrg}/invoices`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId: 'cust-1',
          description: 'desc',
          amountMinor: 9007199254740991,
          currency: 'USD',
        });
      // DTO accepted; downstream returns whatever the Nest layer returns.
      expect([200, 201, 404, 403]).toContain(res.status);
    });

    it('CreateInvoiceDto rejects currency = "usd" (lowercase) as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(`/organizations/${SEED_IDS.alphaOrg}/invoices`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId: 'cust-1',
          description: 'desc',
          amountMinor: 1000,
          currency: 'usd',
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('CreateInvoiceDto rejects currency = "US" (too short) as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(`/organizations/${SEED_IDS.alphaOrg}/invoices`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId: 'cust-1',
          description: 'desc',
          amountMinor: 1000,
          currency: 'US',
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('CreateInvoiceDto rejects currency = "USDD" (too long) as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(`/organizations/${SEED_IDS.alphaOrg}/invoices`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId: 'cust-1',
          description: 'desc',
          amountMinor: 1000,
          currency: 'USDD',
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('CreateInvoiceDto rejects authority mass assignment (owner_id, organization_id, status) as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(`/organizations/${SEED_IDS.alphaOrg}/invoices`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId: 'cust-1',
          description: 'desc',
          amountMinor: 1000,
          currency: 'USD',
          owner_id: SEED_IDS.alphaAdmin,
          organization_id: SEED_IDS.betaOrg,
          status: 'paid',
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('PatchInvoiceDto accepts issued, paid, cancelled and rejects draft as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      for (const status of ['issued', 'paid', 'cancelled']) {
        const res = await request(app.getHttpServer())
          .patch(
            `/organizations/${SEED_IDS.alphaOrg}/invoices/${SEED_IDS.alphaUserAInvoiceDraft}`,
          )
          .set('Authorization', `Bearer ${token}`)
          .send({ status });
        // DTO accepted; downstream returns 404/409 in dev.
        expect([200, 404, 409]).toContain(res.status);
      }
      const draft = await request(app.getHttpServer())
        .patch(
          `/organizations/${SEED_IDS.alphaOrg}/invoices/${SEED_IDS.alphaUserAInvoiceDraft}`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'draft' });
      expect(draft.status).toBe(400);
      expect(draft.body.code).toBe('validation_failed');
    });
  });

  // ===========================================================================
  // Task 8 — Mandatory audit writes (Spec §5.2.6 / §10.4). Every 400 MUST
  // trigger an AuditService.record call. If the audit write fails, the
  // 400 is replaced with 503 audit_unavailable (fail-closed).
  // ===========================================================================
  describe('Task 8: mandatory audit unavailability fail-closed', () => {
    it('returns 503 audit_unavailable when AuditService.record throws', async () => {
      const moduleFixture2 = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(AuditService)
        .useValue({
          record: jest.fn().mockRejectedValue(new Error('audit_unavailable')),
        })
        .compile();
      const app2 = moduleFixture2.createNestApplication({ logger: false });
      applyEdge(app2, loadEnv(process.env));
      await app2.init();
      try {
        const token = await signIn(SEED_IDENTITIES.alphaAdmin);
        // { role: 'superuser' } is rejected by the whitelist → ValidationPipe
        // throws BadRequestException(400). ProblemDetailsFilter audits the
        // 400, the mocked AuditService.record rejects, the filter
        // substitutes 503 audit_unavailable.
        const res = await request(app2.getHttpServer())
          .patch(`/organizations/${SEED_IDS.alphaOrg}/members/${SEED_IDS.alphaUserA}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ role: 'superuser' });
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('audit_unavailable');
        expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
        expect(res.body.requestId).toBeDefined();
      } finally {
        await app2.close();
        await moduleFixture2.close();
      }
    });
  });

  // ===========================================================================
  // Task 8 — Mandatory audit writes. Every 400 MUST trigger an
  // AuditService.record call with the expected payload.
  // ===========================================================================
  it('records an api.validation rejection audit on DTO 400', async () => {
    const token = await signIn(SEED_IDENTITIES.alphaAdmin);
    await request(app.getHttpServer())
      .patch(`/organizations/${SEED_IDS.alphaOrg}/members/${SEED_IDS.alphaUserA}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'superuser' });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api.validation',
        result: 'rejected',
        actorId: expect.any(String),
        organizationId: SEED_IDS.alphaOrg,
        targetType: expect.stringContaining('PATCH'),
        metadata: expect.objectContaining({ code: 'validation_failed' }),
      }),
    );
  });
});
