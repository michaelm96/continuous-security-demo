// JwtVerifier — HS256 signature/audience/issuer/exp/iat verification.
//
// Postgres.app adaptation (forced deviation, documented in report):
// Real Supabase Auth exposes a JWKS endpoint at
//   ${SUPABASE_URL}/auth/v1/.well-known/jwks.json
// and the production verifier should use `createRemoteJWKSet`. There is no
// real Auth service on this dev host, so we sign and verify with
// SUPABASE_JWT_SECRET directly. Task 11+ swaps to the JWKS path.

import { jwtVerify } from 'jose';
import type { Env } from '../config/env';

export class UnauthenticatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

export interface VerifyResult {
  userId: string;
}

type VerifyFn = (token: string) => Promise<VerifyResult>;

export class JwtVerifier {
  constructor(private readonly verifyFn: VerifyFn) {}

  static fromEnv(env: Env): JwtVerifier {
    const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
    return new JwtVerifier(async (token: string) => {
      try {
        const { payload } = await jwtVerify(token, secret, {
          issuer: env.SUPABASE_JWT_ISSUER,
          audience: env.SUPABASE_JWT_AUDIENCE,
        });
        if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
          throw new UnauthenticatedError('invalid_sub');
        }
        const now = Math.floor(Date.now() / 1000);
        if (typeof payload.iat === 'number' && payload.iat > now + 5) {
          throw new UnauthenticatedError('future_iat');
        }
        return { userId: payload.sub };
      } catch (err) {
        if (err instanceof UnauthenticatedError) throw err;
        throw new UnauthenticatedError(
          err instanceof Error ? err.message : 'verify_failed',
        );
      }
    });
  }

  async verify(token: string): Promise<VerifyResult> {
    return this.verifyFn(token);
  }
}
