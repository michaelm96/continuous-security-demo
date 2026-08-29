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

const HAS_DB = !!process.env.DATABASE_URL;

describe('AppModule (e2e)', () => {
  let app: INestApplication<Server>;
  let moduleFixture: TestingModule;

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ logger: false });
    applyEdge(app, loadEnv(process.env));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
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
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      'postgresql://nobody:nopassword@127.0.0.1:1/nope?connectionTimeoutMillis=500';
    try {
      await app.close();
      moduleFixture = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication({ logger: false });
      await app.init();
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('dependency_unavailable');
    } finally {
      if (saved === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = saved;
      }
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
      .send('this is not json');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
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
});
