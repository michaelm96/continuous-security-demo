// Local HS256 JWT minting + caller-scoped RLS query helpers.
//
// Forced deviation from the plan (Step 4 originally called Supabase Auth's
// signInWithPassword): Task 2 fell back to native Postgres.app, so there is
// no GoTrue on this host. signIn() mints a JWT locally with `jose`, signed
// with process.env.SUPABASE_JWT_SECRET. Real Supabase Auth in Task 4+
// replaces signIn() with `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
//   .auth.signInWithPassword(...)`; the rest (visibleInvoiceIds, withCaller,
//   decodeAccessToken) stays the same — only the JWT acquisition path changes.
//
// signIn() does NOT contact SUPABASE_URL. visibleInvoiceIds uses DATABASE_URL
// (already wired by Task 2).

import { SignJWT, decodeJwt } from 'jose';
import type { PoolClient } from 'pg';
import type { SeedIdentity } from './seed-identities';
import { withTransaction } from './db';

const FALLBACK_SECRET = 'test-only-jwt-secret-32-bytes-min-len-please';
const FALLBACK_ISSUER = 'http://127.0.0.1:54321';

function secretBytes(): Uint8Array {
  const raw = process.env.SUPABASE_JWT_SECRET ?? FALLBACK_SECRET;
  if (raw.length < 32) {
    throw new Error(`SUPABASE_JWT_SECRET must be >=32 chars (got ${raw.length})`);
  }
  return new TextEncoder().encode(raw);
}

function issuerString(): string {
  // Forced deviation (Tasks 6/7): signIn previously omitted the `iss` claim
  // entirely, so JwtVerifier (which requires `iss === env.SUPABASE_JWT_ISSUER`)
  // rejected every minted token and AuthGuard returned 503 audit_unavailable
  // before any DTO/controller code could run. The Task 5 /me tests work around
  // this by accepting [200, 503]. Task 6/7 e2e DTO and authorization tests
  // require the JWT to actually verify — adding the issuer mirrors mintTestToken
  // and unblocks those assertions.
  return process.env.SUPABASE_JWT_ISSUER ?? FALLBACK_ISSUER;
}

export async function signIn(identity: SeedIdentity): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const issuer = issuerString();
  return new SignJWT({
    role: identity.role,
    aud: 'authenticated',
    email: identity.email,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    iat: now,
    exp: now + 3600,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(identity.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setAudience('authenticated')
    .setIssuer(issuer)
    .sign(secretBytes());
}

export interface DecodedAccessToken {
  sub: string;
  role: string;
  aud: string;
}

export interface MintTokenOptions {
  issuer?: string;
  audience?: string;
  expired?: boolean;
  futureIat?: boolean;
  badSignature?: boolean;
  sub?: string;
}

// Mint a JWT with deliberate failures. Used by the Step 1 RED JWT failure
// cases (wrong issuer, wrong audience, expired, future iat, bad signature).
// Defaults produce a valid token signed with SUPABASE_JWT_SECRET.
export async function mintTestToken(opts: MintTokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = opts.expired ? now - 60 : now + 3600;
  const iat = opts.futureIat ? now + 600 : now;
  const audience = opts.audience ?? 'authenticated';
  const issuer = opts.issuer ?? process.env.SUPABASE_JWT_ISSUER ?? 'http://127.0.0.1:54321';
  const sub = opts.sub ?? '00000000-0000-4000-8000-000000000000';
  const secretBytes2 = opts.badSignature
    ? new TextEncoder().encode('different-secret-also-32-chars-long-for-tests-please')
    : secretBytes();
  return new SignJWT({
    role: 'authenticated',
    aud: audience,
    email: 'test@example.test',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    iat,
    exp,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(sub)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setAudience(audience)
    .setIssuer(issuer)
    .sign(secretBytes2);
}

export async function decodeAccessToken(token: string): Promise<DecodedAccessToken> {
  // Boundary tests trust the locally-minted secret; no verify needed because
  // the test process is the only signer on this host.
  const payload = decodeJwt(token) as { sub?: string; role?: string; aud?: string };
  if (!payload.sub || !payload.role || !payload.aud) {
    throw new Error('decodeAccessToken: missing required claims (sub/role/aud)');
  }
  return { sub: payload.sub, role: payload.role, aud: payload.aud };
}

export async function withCaller<T>(
  token: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const claims = await decodeAccessToken(token);
  const claimsJson = JSON.stringify({
    sub: claims.sub,
    role: claims.role,
    aud: claims.aud,
    email: (decodeJwt(token) as { email?: string }).email,
  });
  return withTransaction(async (client) => {
    // SET LOCAL role to `authenticated` so FORCE ROW LEVEL SECURITY applies.
    // The DB owner role has BYPASSRLS; without this, RLS would silently
    // admit every row regardless of auth.uid(). We must SET ROLE before
    // SET LOCAL config keys, because SET LOCAL doesn't take parameters.
    await client.query(`set local role authenticated`);
    // auth.uid()/auth.role() read from `request.jwt.claim.*` (singular, plain);
    // auth.jwt() reads from `request.jwt.claims` (plural, JSON). RLS policies
    // here only use auth.uid()/auth.role(), but we set both surfaces for
    // completeness — anything that reads either form will see the caller.
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [claims.sub]);
    await client.query(`select set_config('request.jwt.claim.role', $1, true)`, [claims.role]);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [claimsJson]);
    return fn(client);
  });
}

export async function visibleInvoiceIds(token: string): Promise<string[]> {
  return withCaller(token, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select id from public.invoices order by created_at asc, id asc`,
    );
    return rows.map((r) => r.id);
  });
}
