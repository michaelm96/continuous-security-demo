// MeController — GET /me. Returns only the verified caller's userId and
// their active memberships. Uses the verified Principal from AuthGuard; no
// userId parameter is accepted (Spec §5.2.2 / §9).

import { Controller, Get, UseGuards } from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import { CurrentPrincipal } from './current-principal.decorator';
import { MeService, type MeResponse } from './me.service';
import type { Principal } from './principal';

@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  async get(@CurrentPrincipal() principal: Principal): Promise<MeResponse> {
    return this.me.getMe(principal);
  }
}
