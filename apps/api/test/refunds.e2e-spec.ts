// Task 9 — Refunds e2e (HTTP contract tests).
//
// DTO validation, role gates, and Problem Details shape are fully verifiable
// here; data paths are covered by test:unit (mocked) and test:rls (direct Postgres).
//
// `beforeEach` overrides AuditService to no-op so the happy 400 path
// returns 400 (not 503 audit_unavailable) in this dev env (Adaptation 4
// from Task 8).

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

function refundPath(): string {
  return `/organizations/${SEED_IDS.alphaOrg}/invoices/${SEED_IDS.alphaUserBInvoiceIssued}/refunds`;
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    amountMinor: 100,
    currency: 'USD',
    reason: 'partial refund',
    idempotencyKey: 'idem-key-1',
    ...overrides,
  };
}

describe('RefundsModule (e2e)', () => {
  let app: INestApplication<Server>;
  let moduleFixture: TestingModule;

  beforeEach(async () => {
    // Mock AuditService so the happy 400 path returns 400 (not 503) in the
    // dev env where the fake SUPABASE_URL cannot reach PostgREST.
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuditService)
      .useValue({ record: jest.fn().mockResolvedValue(undefined) })
      .compile();
    app = moduleFixture.createNestApplication({ logger: false });
    applyEdge(app, loadEnv(process.env));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ===========================================================================
  // DTO allowlists (Spec §7.2). Every unknown field, every out-of-range
  // value, every authority mass-assignment is 400 validation_failed.
  // ===========================================================================
  describe('CreateRefundDto allowlists', () => {
    it('rejects amountMinor = 0 as 400 validation_failed', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(refundPath())
        .set('Authorization', `Bearer ${token}`)
        .send(validBody({ amountMinor: 0 }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('rejects amountMinor = 9007199254740992 as 400 (above bigint max)', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(refundPath())
        .set('Authorization', `Bearer ${token}`)
        .send(validBody({ amountMinor: '9007199254740992' }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('accepts amountMinor at the boundary (1, 9007199254740990, 9007199254740991)', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      for (const amountMinor of [1, 9007199254740990, 9007199254740991]) {
        const res = await request(app.getHttpServer())
          .post(refundPath())
          .set('Authorization', `Bearer ${token}`)
          .send(validBody({ amountMinor, idempotencyKey: `idem-${amountMinor}` }));
        // DTO accepted; downstream returns whatever the Nest layer returns.
        expect([201, 403, 404, 409]).toContain(res.status);
      }
    });

    it('rejects currency = "usd" (lowercase) as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(refundPath())
        .set('Authorization', `Bearer ${token}`)
        .send(validBody({ currency: 'usd' }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('rejects currency = "US" (too short) as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(refundPath())
        .set('Authorization', `Bearer ${token}`)
        .send(validBody({ currency: 'US' }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('rejects currency = "USDD" (too long) as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(refundPath())
        .set('Authorization', `Bearer ${token}`)
        .send(validBody({ currency: 'USDD' }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('rejects reason of 513 chars as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(refundPath())
        .set('Authorization', `Bearer ${token}`)
        .send(validBody({ reason: 'x'.repeat(513) }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('rejects idempotencyKey of 129 chars as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(refundPath())
        .set('Authorization', `Bearer ${token}`)
        .send(validBody({ idempotencyKey: 'x'.repeat(129) }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('rejects authority mass-assignment (actorId, organizationId, invoiceId) as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(refundPath())
        .set('Authorization', `Bearer ${token}`)
        .send(
          validBody({
            actorId: SEED_IDS.alphaAdmin,
            organizationId: SEED_IDS.betaOrg,
            invoiceId: SEED_IDS.betaAdminInvoice,
            ownerId: SEED_IDS.alphaAdmin,
            status: 'paid',
          }),
        );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });

    it('rejects unknown extra field as 400', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(refundPath())
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validBody(), secretAdminField: 'oops' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });
  });

  // ===========================================================================
  // 401 / 403 contracts.
  // ===========================================================================
  describe('Authentication + role gates', () => {
    it('anonymous request → 401 unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .post(refundPath())
        .send(validBody());
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('unauthenticated');
    });

    it('alphaUserA (role=user) → 403 forbidden (role check runs before RPC)', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaUserA);
      const res = await request(app.getHttpServer())
        .post(refundPath())
        .set('Authorization', `Bearer ${token}`)
        .send(validBody());
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    });
  });

  // ===========================================================================
  // 404 contract.
  // ===========================================================================
  describe('not_found contract', () => {
    it('unknown invoiceId → 404 not_found', async () => {
      const token = await signIn(SEED_IDENTITIES.alphaManager);
      const res = await request(app.getHttpServer())
        .post(
          `/organizations/${SEED_IDS.alphaOrg}/invoices/00000000-0000-4000-8000-000000000000/refunds`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send(validBody({ idempotencyKey: 'idem-unknown-invoice' }));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    });
  });

  // ===========================================================================
  // 503 audit_unavailable (fail-closed) — Task 8's Adaptation 4.
  // ===========================================================================
  describe('audit_unavailable fail-closed', () => {
    it('returns 503 audit_unavailable when AuditService.record throws on a DTO 400', async () => {
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
        const token = await signIn(SEED_IDENTITIES.alphaManager);
        // amountMinor = 0 is rejected by the DTO (Min(1)). ValidationPipe
        // throws BadRequestException BEFORE the controller runs, so the
        // path is reachable in dev without a real DB. ProblemDetailsFilter
        // audits the 400, the mocked audit rejects, the filter
        // substitutes 503 audit_unavailable.
        const res = await request(app2.getHttpServer())
          .post(refundPath())
          .set('Authorization', `Bearer ${token}`)
          .send(validBody({ amountMinor: 0 }));
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('audit_unavailable');
        expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
        expect(res.body.requestId).toBeDefined();
      } finally {
        await app2.close();
      }
    });
  });
});
