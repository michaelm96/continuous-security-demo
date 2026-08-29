// Typed environment validation. loadEnv() is pure: takes a process.env-shaped
// object, returns a fully typed Env, throws ConfigurationInvalidError with
// invalidKeys on failure. The error message and toString NEVER contain values
// — only the constant string "configuration_invalid" — so accidental logging
// is safe.
//
// Spec §3.4 / §10.1 contract:
// - 16 required env vars (incl. DATABASE_URL which is a Task 2 prerequisite).
// - Production defaults OPENAPI_ENABLED to false; non-production defaults true.
// - Explicit OPENAPI_ENABLED always overrides the default.
// - Missing/invalid keys push the key name into invalidKeys.

export type NodeEnv = 'development' | 'test' | 'staging' | 'production';

export type LogLevel =
  | 'fatal'
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'trace'
  | 'silent';

export interface Env {
  API_PORT: number;
  WEB_ORIGIN: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  SUPABASE_JWT_AUDIENCE: string;
  SUPABASE_JWT_ISSUER: string;
  NODE_ENV: NodeEnv;
  LOG_LEVEL: LogLevel;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_AUTH_PER_MIN: number;
  RATE_LIMIT_ANON_PER_MIN: number;
  BODY_LIMIT_KB: number;
  JSON_DEPTH_LIMIT: number;
  OPENAPI_ENABLED: boolean;
  DATABASE_URL: string;
}

export class ConfigurationInvalidError extends Error {
  public readonly invalidKeys: string[];

  constructor(invalidKeys: string[]) {
    super('configuration_invalid');
    this.name = 'ConfigurationInvalidError';
    this.invalidKeys = [...invalidKeys];
  }

  // Names-only toString: never include the key list, never include values.
  // Accidental `console.log(err)` or `${err}` interpolation yields just the
  // constant "configuration_invalid" string.
  override toString(): string {
    return 'configuration_invalid';
  }
}

const NODE_ENVS: readonly NodeEnv[] = [
  'development',
  'test',
  'staging',
  'production',
];

const LOG_LEVELS: readonly LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
];

const TRUE_TOKENS = new Set(['true', '1', 'yes']);
const FALSE_TOKENS = new Set(['false', '0', 'no']);

export function parseBoolean(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (TRUE_TOKENS.has(v)) return true;
  if (FALSE_TOKENS.has(v)) return false;
  throw new ConfigurationInvalidError(['OPENAPI_ENABLED']);
}

// Helper: append key to invalidKeys without throwing. Callers check the
// accumulator at the end of loadEnv and decide whether to throw.
type Sink = { invalidKeys: string[] };

function intInRange(
  key: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number | undefined,
  sink: Sink,
): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    sink.invalidKeys.push(key);
    return fallback;
  }
  return parsed;
}

function oneOf<T extends string>(
  key: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T | undefined,
  sink: Sink,
): T | undefined {
  if (raw === undefined || raw === '') return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  sink.invalidKeys.push(key);
  return fallback;
}

function requireString(
  key: string,
  raw: string | undefined,
  sink: Sink,
): string | undefined {
  if (raw === undefined || raw === '') {
    sink.invalidKeys.push(key);
    return undefined;
  }
  return raw;
}

function requireUrl(
  key: string,
  raw: string | undefined,
  sink: Sink,
): string | undefined {
  const v = requireString(key, raw, sink);
  if (v === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    sink.invalidKeys.push(key);
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    sink.invalidKeys.push(key);
    return undefined;
  }
  return v;
}

function requireOrigin(
  key: string,
  raw: string | undefined,
  sink: Sink,
): string | undefined {
  const v = requireString(key, raw, sink);
  if (v === undefined) return undefined;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      sink.invalidKeys.push(key);
      return undefined;
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    sink.invalidKeys.push(key);
    return undefined;
  }
}

export function loadEnv(source: NodeJS.ProcessEnv): Env {
  const sink: Sink = { invalidKeys: [] };

  const NODE_ENV =
    oneOf<NodeEnv>('NODE_ENV', source.NODE_ENV, NODE_ENVS, 'development', sink) ??
    'development';
  const LOG_LEVEL =
    oneOf<LogLevel>('LOG_LEVEL', source.LOG_LEVEL, LOG_LEVELS, 'info', sink) ??
    'info';

  const SUPABASE_URL = requireUrl('SUPABASE_URL', source.SUPABASE_URL, sink);
  const SUPABASE_ANON_KEY = requireString(
    'SUPABASE_ANON_KEY',
    source.SUPABASE_ANON_KEY,
    sink,
  );
  const SUPABASE_SERVICE_ROLE_KEY = requireString(
    'SUPABASE_SERVICE_ROLE_KEY',
    source.SUPABASE_SERVICE_ROLE_KEY,
    sink,
  );
  const SUPABASE_JWT_SECRET = requireString(
    'SUPABASE_JWT_SECRET',
    source.SUPABASE_JWT_SECRET,
    sink,
  );
  if (SUPABASE_JWT_SECRET !== undefined && SUPABASE_JWT_SECRET.length < 32) {
    sink.invalidKeys.push('SUPABASE_JWT_SECRET');
  }
  const SUPABASE_JWT_AUDIENCE = requireString(
    'SUPABASE_JWT_AUDIENCE',
    source.SUPABASE_JWT_AUDIENCE,
    sink,
  );
  if (SUPABASE_JWT_AUDIENCE !== undefined && SUPABASE_JWT_AUDIENCE !== 'authenticated') {
    sink.invalidKeys.push('SUPABASE_JWT_AUDIENCE');
  }
  const SUPABASE_JWT_ISSUER = requireUrl(
    'SUPABASE_JWT_ISSUER',
    source.SUPABASE_JWT_ISSUER,
    sink,
  );
  if (
    SUPABASE_JWT_ISSUER !== undefined &&
    SUPABASE_URL !== undefined &&
    SUPABASE_JWT_ISSUER !== SUPABASE_URL
  ) {
    sink.invalidKeys.push('SUPABASE_JWT_ISSUER');
  }
  const WEB_ORIGIN = requireOrigin('WEB_ORIGIN', source.WEB_ORIGIN, sink);
  const DATABASE_URL = requireString('DATABASE_URL', source.DATABASE_URL, sink);
  if (DATABASE_URL !== undefined && !DATABASE_URL.startsWith('postgresql://')) {
    sink.invalidKeys.push('DATABASE_URL');
  }

  const API_PORT = intInRange('API_PORT', source.API_PORT, 3001, 1, 65535, sink);
  const RATE_LIMIT_WINDOW_MS = intInRange(
    'RATE_LIMIT_WINDOW_MS',
    source.RATE_LIMIT_WINDOW_MS,
    60000,
    1,
    undefined,
    sink,
  );
  const RATE_LIMIT_AUTH_PER_MIN = intInRange(
    'RATE_LIMIT_AUTH_PER_MIN',
    source.RATE_LIMIT_AUTH_PER_MIN,
    60,
    1,
    undefined,
    sink,
  );
  const RATE_LIMIT_ANON_PER_MIN = intInRange(
    'RATE_LIMIT_ANON_PER_MIN',
    source.RATE_LIMIT_ANON_PER_MIN,
    20,
    1,
    undefined,
    sink,
  );
  const BODY_LIMIT_KB = intInRange('BODY_LIMIT_KB', source.BODY_LIMIT_KB, 100, 1, undefined, sink);
  const JSON_DEPTH_LIMIT = intInRange(
    'JSON_DEPTH_LIMIT',
    source.JSON_DEPTH_LIMIT,
    20,
    1,
    undefined,
    sink,
  );

  // Boolean parsing: parseBoolean throws on malformed input. We catch and
  // push OPENAPI_ENABLED so it lands in invalidKeys rather than blowing up
  // the function early.
  const defaultOpenapi = NODE_ENV === 'production' ? false : true;
  let OPENAPI_ENABLED: boolean;
  try {
    OPENAPI_ENABLED = parseBoolean(source.OPENAPI_ENABLED, defaultOpenapi);
  } catch {
    sink.invalidKeys.push('OPENAPI_ENABLED');
    OPENAPI_ENABLED = defaultOpenapi;
  }

  if (sink.invalidKeys.length > 0) {
    // De-duplicate while preserving order.
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const k of sink.invalidKeys) {
      if (!seen.has(k)) {
        seen.add(k);
        dedup.push(k);
      }
    }
    throw new ConfigurationInvalidError(dedup);
  }

  // After the throw guard, all fields are defined (the sink would have caught
  // any missing values). The non-null assertions are safe at this point.
  return {
    API_PORT,
    WEB_ORIGIN: WEB_ORIGIN!,
    SUPABASE_URL: SUPABASE_URL!,
    SUPABASE_ANON_KEY: SUPABASE_ANON_KEY!,
    SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_ROLE_KEY!,
    SUPABASE_JWT_SECRET: SUPABASE_JWT_SECRET!,
    SUPABASE_JWT_AUDIENCE: SUPABASE_JWT_AUDIENCE!,
    SUPABASE_JWT_ISSUER: SUPABASE_JWT_ISSUER!,
    NODE_ENV,
    LOG_LEVEL,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_AUTH_PER_MIN,
    RATE_LIMIT_ANON_PER_MIN,
    BODY_LIMIT_KB,
    JSON_DEPTH_LIMIT,
    OPENAPI_ENABLED,
    DATABASE_URL: DATABASE_URL!,
  };
}
