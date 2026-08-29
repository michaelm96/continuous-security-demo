// AuthGuard — NestJS CanActivate. Extracts exactly one Bearer token, verifies
// it via JwtVerifier, and attaches the verified Principal to req.principal.
// Every authentication failure is audited through AuditService; if the audit
// write itself fails, the request returns 503 audit_unavailable (Spec §10.4).

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtVerifier } from './jwt-verifier';
import type { Principal } from './principal';
import { AuditService } from '../audit/audit.service';
import { AUDIT_UNAVAILABLE } from '../audit/audit.service';

interface RequestWithPrincipal extends Request {
  requestId?: string;
  principal?: Principal;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtVerifier,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestWithPrincipal>();
    const auth = req.headers.authorization;

    if (!auth || !auth.startsWith('Bearer ')) {
      await this.recordFailure(req, 'missing_bearer');
      throw new UnauthorizedException();
    }
    const token = auth.slice('Bearer '.length).trim();
    if (!token) {
      await this.recordFailure(req, 'empty_bearer');
      throw new UnauthorizedException();
    }
    try {
      const { userId } = await this.jwt.verify(token);
      req.principal = { userId, accessToken: token };
      return true;
    } catch (err) {
      await this.recordFailure(
        req,
        err instanceof Error ? err.message : 'verify_failed',
      );
      throw new UnauthorizedException();
    }
  }

  private async recordFailure(req: RequestWithPrincipal, code: string): Promise<void> {
    try {
      await this.audit.record({
        actorId: null,
        organizationId: null,
        action: 'auth.verify',
        targetType: 'auth',
        targetId: null,
        result: 'rejected',
        correlationId: req.requestId ?? 'unknown',
        metadata: { code },
      });
    } catch (auditErr) {
      if (auditErr instanceof Error && auditErr.message === AUDIT_UNAVAILABLE) {
        throw new ServiceUnavailableException({ code: 'audit_unavailable' });
      }
      throw new ServiceUnavailableException({ code: 'audit_unavailable' });
    }
  }
}
