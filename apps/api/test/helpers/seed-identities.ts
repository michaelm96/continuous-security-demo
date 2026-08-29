// Deterministic UUIDs and seed identity records. The brief's contract: these
// UUIDs match byte-for-byte with apps/api/test/sql/003_seed.sql so the seed
// is repeatable across db:seed invocations.

export const SEED_IDS = {
  alphaOrg: '11111111-1111-4111-8111-111111111111',
  betaOrg:  '22222222-2222-4222-8222-222222222222',
  alphaAdmin:    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  alphaManager:  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  alphaUserA:    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  alphaUserB:    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  alphaSuspended:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  betaAdmin:     'ffffffff-ffff-4fff-8fff-ffffffffffff',
  // Invoices (Step 3)
  alphaUserAInvoiceDraft:  '10000001-aaaa-4aaa-8aaa-000000000001',
  alphaUserBInvoiceIssued: '10000002-bbbb-4bbb-8bbb-000000000002',
  betaAdminInvoice:        '20000001-ffff-4fff-8fff-000000000001',
  // Refunds (Step 3) — minimal fixtures, no body fields
  alphaRefundPaid:       '30000001-aaaa-4aaa-8aaa-000000000001',
  alphaRefundCancelled:  '30000002-bbbb-4bbb-8bbb-000000000002',
} as const;

export type SeedKey = keyof typeof SEED_IDS;

export interface SeedIdentity {
  email: string;
  password: string;
  userId: string;
  organizationId: string;
  role: 'user' | 'manager' | 'organization_admin';
  status: 'active' | 'suspended';
}

export const SEED_IDENTITIES = {
  alphaAdmin:     { email: 'admin.alpha@example.test',     password: 'LocalOnly-Admin1!',     userId: SEED_IDS.alphaAdmin,     organizationId: SEED_IDS.alphaOrg, role: 'organization_admin', status: 'active' },
  alphaManager:   { email: 'manager.alpha@example.test',   password: 'LocalOnly-Manager1!',   userId: SEED_IDS.alphaManager,   organizationId: SEED_IDS.alphaOrg, role: 'manager',            status: 'active' },
  alphaUserA:     { email: 'user-a.alpha@example.test',    password: 'LocalOnly-UserA1!',     userId: SEED_IDS.alphaUserA,     organizationId: SEED_IDS.alphaOrg, role: 'user',               status: 'active' },
  alphaUserB:     { email: 'user-b.alpha@example.test',    password: 'LocalOnly-UserB1!',     userId: SEED_IDS.alphaUserB,     organizationId: SEED_IDS.alphaOrg, role: 'user',               status: 'active' },
  alphaSuspended: { email: 'suspended.alpha@example.test', password: 'LocalOnly-Suspended1!', userId: SEED_IDS.alphaSuspended, organizationId: SEED_IDS.alphaOrg, role: 'user',               status: 'suspended' },
  betaAdmin:      { email: 'admin.beta@example.test',      password: 'LocalOnly-Admin2!',     userId: SEED_IDS.betaAdmin,      organizationId: SEED_IDS.betaOrg,  role: 'organization_admin', status: 'active' },
} as const;
export type SeedIdentityKey = keyof typeof SEED_IDENTITIES;
