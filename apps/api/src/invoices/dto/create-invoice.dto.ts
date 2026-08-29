// CreateInvoiceDto — strict allowlist for POST /organizations/:organizationId/invoices.
// Global ValidationPipe enforces whitelist:true + forbidNonWhitelisted:true, so any
// unknown field (ownerId, organizationId, status, actor) is rejected as
// 400/validation_failed by the global filter. owner_id and status are
// server-derived (Postgres column defaults); organizationId comes from the URL.

import { IsInt, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateInvoiceDto {
  @IsInt()
  @Min(1)
  @Max(9007199254740991)
  amountMinor!: number;

  @Matches(/^[A-Z]{3}$/, { message: 'currency must match ^[A-Z]{3}$' })
  currency!: string;

  @MinLength(1)
  @MaxLength(128)
  customerId!: string;

  @MinLength(1)
  @MaxLength(1024)
  description!: string;
}