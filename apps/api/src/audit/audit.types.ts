// AuditInput — the typed event shape that flows through AuditService.record().
// Field allowlist enforced by the schema (001_tenant_schema.sql audit_events
// table CHECK on `result`); JSONB metadata column is the catch-all for safe
// error codes, target ids, and request context.

export interface AuditInput {
  actorId: string | null;
  organizationId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  result: 'success' | 'rejected' | 'failure';
  correlationId: string;
  metadata: Record<string, string | number | boolean | null>;
}
