// Shared response types that mirror the Nest API controllers. The web UI
// never imports anything from apps/api; these are local mirrors of the
// public response shapes declared in the controllers / services.

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

export type MembershipRole = 'user' | 'manager' | 'organization_admin';

export type MembershipStatus = 'active' | 'suspended';

export interface OrganizationView {
  id: string;
  name: string;
}

export interface MembershipView {
  organizationId: string;
  role: MembershipRole;
  status: MembershipStatus;
}

export interface MeResponse {
  userId: string;
  memberships: MembershipView[];
}

export interface MembershipRow {
  id: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
}

export interface InvoiceRow {
  id: string;
  organizationId: string;
  ownerId: string;
  customerId: string;
  description: string;
  amountMinor: number;
  currency: string;
  status: InvoiceStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface RefundRow {
  id: string;
  invoiceId: string;
  organizationId: string;
  createdBy: string;
  amountMinor: number;
  currency: string;
  reason: string;
  idempotencyKey: string;
  createdAt: string;
}

// RFC 9457 Problem Details error shape that the API emits on every 4xx/5xx
// response. The web UI renders title/detail/requestId from this object.
export interface ProblemDetails {
  title: string;
  status: number;
  code: string;
  requestId: string;
  detail?: string;
  type?: string;
  instance?: string;
}

// Server-action return value used by every form action in apps/web.
export type ActionState = {
  error?: ProblemDetails;
  success?: boolean;
};
