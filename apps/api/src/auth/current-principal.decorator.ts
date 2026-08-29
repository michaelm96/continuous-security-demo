// CurrentPrincipal — param decorator that returns the verified Principal
// attached to req.principal by AuthGuard. Throws InternalServerError if
// invoked on a route that was not behind the guard.

import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Principal } from './principal';

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest<{ principal?: Principal }>();
    if (!req.principal) {
      throw new InternalServerErrorException('principal_missing');
    }
    return req.principal;
  },
);
