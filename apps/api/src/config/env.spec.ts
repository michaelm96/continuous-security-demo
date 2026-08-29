// Step 1 RED — failing tests for loadEnv. Step 2 will implement loadEnv.
//
// Coverage:
// - Missing required keys push key name into invalidKeys; error names only, never values.
// - Invalid API_PORT (negative, zero, non-integer) → invalidKeys includes API_PORT.
// - Malformed OPENAPI_ENABLED → invalidKeys includes OPENAPI_ENABLED.
// - SUPABASE_JWT_ISSUER !== SUPABASE_URL → invalidKeys includes SUPABASE_JWT_ISSUER.
// - NODE_ENV=production → OPENAPI_ENABLED defaults to false.
// - NODE_ENV=development → OPENAPI_ENABLED defaults to true.
// - OPENAPI_ENABLED=true overrides default in any environment.
// - Default values applied for unset optional tunables.
// - parseBoolean: true/false/1/0/yes/no (mixed case) accepted; maybe/2/empty rejected.

import {
  loadEnv,
  ConfigurationInvalidError,
  parseBoolean,
} from './env';

const BASE: NodeJS.ProcessEnv = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'service-placeholder',
  SUPABASE_JWT_SECRET: 'a-secret-at-least-thirty-two-characters-long-yes',
  SUPABASE_JWT_AUDIENCE: 'authenticated',
  SUPABASE_JWT_ISSUER: 'http://127.0.0.1:54321',
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql:///db?host=/tmp',
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  API_PORT: '3001',
  RATE_LIMIT_WINDOW_MS: '60000',
  RATE_LIMIT_AUTH_PER_MIN: '60',
  RATE_LIMIT_ANON_PER_MIN: '20',
  BODY_LIMIT_KB: '100',
  JSON_DEPTH_LIMIT: '20',
};

describe('loadEnv', () => {
  it('accepts a fully-specified development environment and applies defaults', () => {
    const env = loadEnv(BASE);
    expect(env.NODE_ENV).toBe('development');
    expect(env.OPENAPI_ENABLED).toBe(true);
    expect(env.API_PORT).toBe(3001);
    expect(env.WEB_ORIGIN).toBe('http://localhost:3000');
  });

  it('rejects a missing required key and names it in invalidKeys (no values leaked)', () => {
    const { SUPABASE_JWT_SECRET: _omit, ...rest } = BASE;
    let caught: unknown;
    try {
      loadEnv(rest as NodeJS.ProcessEnv);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigurationInvalidError);
    const err = caught as ConfigurationInvalidError;
    expect(err.invalidKeys).toContain('SUPABASE_JWT_SECRET');
    // Names-only contract: error message and toString must NOT contain values.
    expect(err.message).toBe('configuration_invalid');
    expect(String(err)).toBe('configuration_invalid');
    const msg = JSON.stringify({ ...rest, _omit: undefined });
    for (const value of ['test-value', 'placeholder', 'http://127.0.0.1:54321']) {
      // Ensure no value text appears in the error surface.
      expect(String(err)).not.toContain(value);
      // Also assert across all invalid keys individually:
      expect(err.message).not.toContain(value);
      // Ensure msg helper compiles — defensive:
      expect(typeof msg).toBe('string');
    }
  });

  it('rejects negative, zero, and non-integer API_PORT', () => {
    for (const bad of ['-1', '0', '3.14', 'abc']) {
      let caught: unknown;
      try {
        loadEnv({ ...BASE, API_PORT: bad });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ConfigurationInvalidError);
      expect((caught as ConfigurationInvalidError).invalidKeys).toContain('API_PORT');
    }
  });

  it('rejects malformed OPENAPI_ENABLED', () => {
    let caught: unknown;
    try {
      loadEnv({ ...BASE, OPENAPI_ENABLED: 'maybe' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigurationInvalidError);
    expect((caught as ConfigurationInvalidError).invalidKeys).toContain('OPENAPI_ENABLED');
  });

  it('rejects SUPABASE_JWT_ISSUER that does not match SUPABASE_URL', () => {
    let caught: unknown;
    try {
      loadEnv({ ...BASE, SUPABASE_URL: 'http://a', SUPABASE_JWT_ISSUER: 'http://b' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigurationInvalidError);
    expect((caught as ConfigurationInvalidError).invalidKeys).toContain('SUPABASE_JWT_ISSUER');
  });

  it('defaults OPENAPI_ENABLED to false when NODE_ENV=production', () => {
    const env = loadEnv({ ...BASE, NODE_ENV: 'production' });
    expect(env.OPENAPI_ENABLED).toBe(false);
  });

  it('defaults OPENAPI_ENABLED to true when NODE_ENV=development', () => {
    const env = loadEnv({ ...BASE, NODE_ENV: 'development' });
    expect(env.OPENAPI_ENABLED).toBe(true);
  });

  it('lets OPENAPI_ENABLED=true override the default in production', () => {
    const env = loadEnv({ ...BASE, NODE_ENV: 'production', OPENAPI_ENABLED: 'true' });
    expect(env.OPENAPI_ENABLED).toBe(true);
  });

  it('lets OPENAPI_ENABLED=false override the default in development', () => {
    const env = loadEnv({ ...BASE, NODE_ENV: 'development', OPENAPI_ENABLED: 'false' });
    expect(env.OPENAPI_ENABLED).toBe(false);
  });

  it('rejects invalid NODE_ENV', () => {
    let caught: unknown;
    try {
      loadEnv({ ...BASE, NODE_ENV: 'preview' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigurationInvalidError);
    expect((caught as ConfigurationInvalidError).invalidKeys).toContain('NODE_ENV');
  });

  it('rejects invalid LOG_LEVEL', () => {
    let caught: unknown;
    try {
      loadEnv({ ...BASE, LOG_LEVEL: 'verbose' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigurationInvalidError);
    expect((caught as ConfigurationInvalidError).invalidKeys).toContain('LOG_LEVEL');
  });

  it('rejects invalid WEB_ORIGIN', () => {
    let caught: unknown;
    try {
      loadEnv({ ...BASE, WEB_ORIGIN: 'not-a-url' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigurationInvalidError);
    expect((caught as ConfigurationInvalidError).invalidKeys).toContain('WEB_ORIGIN');
  });

  it('rejects SUPABASE_URL that is not http(s)', () => {
    let caught: unknown;
    try {
      loadEnv({ ...BASE, SUPABASE_URL: 'ftp://x' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigurationInvalidError);
    expect((caught as ConfigurationInvalidError).invalidKeys).toContain('SUPABASE_URL');
  });

  it('rejects SUPABASE_JWT_SECRET shorter than 32 chars', () => {
    let caught: unknown;
    try {
      loadEnv({ ...BASE, SUPABASE_JWT_SECRET: 'short' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigurationInvalidError);
    expect((caught as ConfigurationInvalidError).invalidKeys).toContain('SUPABASE_JWT_SECRET');
  });

  it('rejects SUPABASE_JWT_AUDIENCE that is not "authenticated"', () => {
    let caught: unknown;
    try {
      loadEnv({ ...BASE, SUPABASE_JWT_AUDIENCE: 'public' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigurationInvalidError);
    expect((caught as ConfigurationInvalidError).invalidKeys).toContain('SUPABASE_JWT_AUDIENCE');
  });

  it('rejects invalid DATABASE_URL scheme', () => {
    let caught: unknown;
    try {
      loadEnv({ ...BASE, DATABASE_URL: 'mysql://x' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigurationInvalidError);
    expect((caught as ConfigurationInvalidError).invalidKeys).toContain('DATABASE_URL');
  });

  it('rejects non-positive RATE_LIMIT_WINDOW_MS', () => {
    let caught: unknown;
    try {
      loadEnv({ ...BASE, RATE_LIMIT_WINDOW_MS: '0' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigurationInvalidError);
    expect((caught as ConfigurationInvalidError).invalidKeys).toContain('RATE_LIMIT_WINDOW_MS');
  });

  it('applies default values for unset optional tunables', () => {
    const minimal: NodeJS.ProcessEnv = { ...BASE };
    delete (minimal as Record<string, string | undefined>).API_PORT;
    delete (minimal as Record<string, string | undefined>).RATE_LIMIT_WINDOW_MS;
    delete (minimal as Record<string, string | undefined>).RATE_LIMIT_AUTH_PER_MIN;
    delete (minimal as Record<string, string | undefined>).RATE_LIMIT_ANON_PER_MIN;
    delete (minimal as Record<string, string | undefined>).BODY_LIMIT_KB;
    delete (minimal as Record<string, string | undefined>).JSON_DEPTH_LIMIT;
    const env = loadEnv(minimal);
    expect(env.API_PORT).toBe(3001);
    expect(env.RATE_LIMIT_WINDOW_MS).toBe(60000);
    expect(env.RATE_LIMIT_AUTH_PER_MIN).toBe(60);
    expect(env.RATE_LIMIT_ANON_PER_MIN).toBe(20);
    expect(env.BODY_LIMIT_KB).toBe(100);
    expect(env.JSON_DEPTH_LIMIT).toBe(20);
  });
});

describe('parseBoolean', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
    ['yes', true],
    ['no', false],
    ['TRUE', true],
    ['False', false],
    ['YES', true],
    ['No', false],
  ])('accepts %s', (input, expected) => {
    expect(parseBoolean(input, false)).toBe(expected);
  });

  it('returns fallback for undefined', () => {
    expect(parseBoolean(undefined, true)).toBe(true);
    expect(parseBoolean(undefined, false)).toBe(false);
  });

  it.each(['maybe', '2', ''])('rejects %s', (input) => {
    expect(() => parseBoolean(input, false)).toThrow(ConfigurationInvalidError);
  });
});
