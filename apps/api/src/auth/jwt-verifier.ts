import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from '../config/env';

export class UnauthenticatedError extends Error {
  constructor() {
    super('unauthenticated');
    this.name = 'UnauthenticatedError';
  }
}

export interface VerifyResult {
  userId: string;
}

export class JwtVerifier {
  private constructor(
    private readonly verifyToken: (token: string) => Promise<VerifyResult>,
  ) {}

  static fromEnv(env: Env): JwtVerifier {
    const jwks = createRemoteJWKSet(
      new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
    );

    return new JwtVerifier(async (token) => {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: env.SUPABASE_JWT_ISSUER,
          audience: env.SUPABASE_JWT_AUDIENCE,
          requiredClaims: ['exp', 'iat', 'sub'],
        });
        const now = Math.floor(Date.now() / 1000);
        if (
          typeof payload.exp !== 'number' ||
          typeof payload.iat !== 'number' ||
          payload.iat > now + 5 ||
          typeof payload.sub !== 'string' ||
          payload.sub.length === 0
        ) {
          throw new UnauthenticatedError();
        }
        return { userId: payload.sub };
      } catch {
        throw new UnauthenticatedError();
      }
    });
  }

  async verify(token: string): Promise<VerifyResult> {
    return this.verifyToken(token);
  }
}
