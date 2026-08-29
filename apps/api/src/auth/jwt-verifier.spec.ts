import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from 'jose';

import { loadEnv, type Env } from '../config/env';
import { JwtVerifier } from './jwt-verifier';

const AUDIENCE = 'authenticated';

describe('JwtVerifier', () => {
  let server: Server;
  let origin: string;
  let privateKey: CryptoKey;
  let otherPrivateKey: CryptoKey;
  let jwksBody: string;

  beforeAll(async () => {
    const primary = await generateKeyPair('ES256');
    const other = await generateKeyPair('ES256');
    privateKey = primary.privateKey;
    otherPrivateKey = other.privateKey;

    const jwk: JWK = await exportJWK(primary.publicKey);
    jwk.kid = 'primary';
    jwk.alg = 'ES256';
    jwk.use = 'sig';
    jwksBody = JSON.stringify({ keys: [jwk] });

    server = createServer((req, res) => {
      if (req.url !== '/auth/v1/.well-known/jwks.json') {
        res.writeHead(404).end();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(jwksBody);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  function env(baseUrl = origin): Env {
    return loadEnv({
      ...process.env,
      SUPABASE_URL: baseUrl,
      SUPABASE_ANON_KEY: 'test-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
      SUPABASE_JWT_AUDIENCE: AUDIENCE,
      SUPABASE_JWT_ISSUER: `${baseUrl}/auth/v1`,
    });
  }

  async function token(options: {
    key?: CryptoKey;
    issuer?: string;
    audience?: string;
    subject?: string | null;
    issuedAt?: number | null;
    expirationTime?: number | null;
    kid?: string;
  } = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims: JWTPayload = {};
    if (options.subject !== null) claims.sub = options.subject ?? 'user-123';
    if (options.issuedAt !== null) claims.iat = options.issuedAt ?? now;
    if (options.expirationTime !== null) {
      claims.exp = options.expirationTime ?? now + 60;
    }
    claims.iss = options.issuer ?? `${origin}/auth/v1`;
    claims.aud = options.audience ?? AUDIENCE;

    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: options.kid ?? 'primary' })
      .sign(options.key ?? privateKey);
  }

  async function expectRejected(accessToken: string, verifier = JwtVerifier.fromEnv(env())) {
    await expect(verifier.verify(accessToken)).rejects.toMatchObject({
      message: 'unauthenticated',
    });
  }

  it('verifies a valid ES256 token through the remote JWKS', async () => {
    await expect(JwtVerifier.fromEnv(env()).verify(await token())).resolves.toEqual({
      userId: 'user-123',
    });
  });

  it('rejects a tampered token and a token signed by the wrong key generically', async () => {
    const valid = await token();
    const parts = valid.split('.');
    parts[1] = `${parts[1][0] === 'a' ? 'b' : 'a'}${parts[1].slice(1)}`;

    await expectRejected(parts.join('.'));
    await expectRejected(await token({ key: otherPrivateKey }));
  });

  it('rejects the wrong issuer generically', async () => {
    await expectRejected(await token({ issuer: 'https://wrong.example/auth/v1' }));
  });

  it('rejects the wrong audience generically', async () => {
    await expectRejected(await token({ audience: 'wrong' }));
  });

  it('rejects an expired token generically', async () => {
    await expectRejected(
      await token({ expirationTime: Math.floor(Date.now() / 1000) - 1 }),
    );
  });

  it('requires a numeric expiration time', async () => {
    await expectRejected(await token({ expirationTime: null }));
  });

  it('requires a numeric issued-at time', async () => {
    await expectRejected(await token({ issuedAt: null }));
  });

  it('rejects issued-at more than five seconds in the future', async () => {
    await expectRejected(await token({ issuedAt: Math.floor(Date.now() / 1000) + 6 }));
  });

  it('accepts issued-at exactly five seconds in the future', async () => {
    await expect(
      JwtVerifier.fromEnv(env()).verify(
        await token({ issuedAt: Math.floor(Date.now() / 1000) + 5 }),
      ),
    ).resolves.toEqual({ userId: 'user-123' });
  });

  it.each([null, ''])('rejects missing or empty subject generically', async (subject) => {
    await expectRejected(await token({ subject }));
  });

  it('rejects an unavailable JWKS generically', async () => {
    const unavailable = createServer();
    await new Promise<void>((resolve) => unavailable.listen(0, '127.0.0.1', resolve));
    const port = (unavailable.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) =>
      unavailable.close((error) => (error ? reject(error) : resolve())),
    );

    await expectRejected(
      await token(),
      JwtVerifier.fromEnv(env(`http://127.0.0.1:${port}`)),
    );
  });

  it('rejects an invalid JWKS response generically', async () => {
    const validBody = jwksBody;
    jwksBody = 'not-json';
    try {
      await expectRejected(await token());
    } finally {
      jwksBody = validBody;
    }
  });
});
