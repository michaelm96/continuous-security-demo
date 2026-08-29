// CreateRefundDto — strict allowlist for POST /organizations/:organizationId/invoices/:invoiceId/refunds.
// Global ValidationPipe enforces whitelist:true + forbidNonWhitelisted:true, so any
// unknown field (actorId, organizationId, invoiceId, ownerId, status) is
// rejected as 400/validation_failed by the global filter. `actorId`,
// `organizationId`, and `invoiceId` come from the verified token and URL
// path — Spec §7.2.

import { IsInt, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateRefundDto {
  @IsInt()
  @Min(1)
  @Max(9007199254740991) // Number.MAX_SAFE_INTEGER — matches DB bigint CHECK
  amountMinor!: number;

  @Matches(/^[A-Z]{3}$/, { message: 'currency must match ^[A-Z]{3}$' })
  currency!: string;

  @MinLength(1)
  @MaxLength(512)
  reason!: string;

  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}
