// Stable error codes per Spec §10.1. Each entry pairs an HTTP status with a
// single stable `code` string. Responses always emit exactly one code; no
// response combines `invalid_state` with another code.

export interface ProblemDetails {
  title: string;
  status: number;
  code: string;
  detail?: string;
  requestId: string;
}

export const PROBLEM_CODES = {
  VALIDATION_FAILED: { http: 400, code: 'validation_failed' },
  INVALID_AMOUNT: { http: 400, code: 'invalid_amount' },
  CURRENCY_MISMATCH: { http: 400, code: 'currency_mismatch' },
  UNAUTHENTICATED: { http: 401, code: 'unauthenticated' },
  FORBIDDEN: { http: 403, code: 'forbidden' },
  NOT_FOUND: { http: 404, code: 'not_found' },
  IDEMPOTENCY_CONFLICT: { http: 409, code: 'idempotency_conflict' },
  INVALID_STATE: { http: 409, code: 'invalid_state' },
  LAST_ADMIN: { http: 409, code: 'last_admin' },
  OVER_REFUND: { http: 409, code: 'over_refund' },
  THROTTLED: { http: 429, code: 'throttled' },
  INTERNAL: { http: 500, code: 'internal' },
  DEPENDENCY_UNAVAILABLE: { http: 503, code: 'dependency_unavailable' },
  AUDIT_UNAVAILABLE: { http: 503, code: 'audit_unavailable' },
} as const;

export type ProblemCodeKey = keyof typeof PROBLEM_CODES;

const TITLES: Record<ProblemCodeKey, string> = {
  VALIDATION_FAILED: 'Validation Failed',
  INVALID_AMOUNT: 'Invalid Amount',
  CURRENCY_MISMATCH: 'Currency Mismatch',
  UNAUTHENTICATED: 'Unauthenticated',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not Found',
  IDEMPOTENCY_CONFLICT: 'Idempotency Conflict',
  INVALID_STATE: 'Invalid State',
  LAST_ADMIN: 'Last Admin',
  OVER_REFUND: 'Over Refund',
  THROTTLED: 'Throttled',
  INTERNAL: 'Internal Server Error',
  DEPENDENCY_UNAVAILABLE: 'Dependency Unavailable',
  AUDIT_UNAVAILABLE: 'Audit Unavailable',
};

const STATUS_TO_KEY: Record<number, ProblemCodeKey> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'INVALID_STATE',
  429: 'THROTTLED',
  500: 'INTERNAL',
  503: 'DEPENDENCY_UNAVAILABLE',
};

export function problemDetails(
  key: ProblemCodeKey,
  requestId: string,
  detail?: string,
): ProblemDetails {
  const entry = PROBLEM_CODES[key];
  const body: ProblemDetails = {
    title: TITLES[key],
    status: entry.http,
    code: entry.code,
    requestId,
  };
  if (detail !== undefined) body.detail = detail;
  return body;
}

export function problemDetailsFromStatus(
  status: number,
  requestId: string,
  detail?: string,
): ProblemDetails {
  const key = STATUS_TO_KEY[status] ?? 'INTERNAL';
  return problemDetails(key, requestId, detail);
}
