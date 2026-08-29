// OpenApiModule. Wires /docs and /docs-json when OPENAPI_ENABLED is true.
// Mounted in AppModule so it works for both main.ts and the testing module
// (without this, the e2e tests can't observe the swagger surface).

import {
  Inject,
  Module,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';

import { ConfigModule } from '../config/config.module';
import type { Env } from '../config/env';

@Module({
  imports: [ConfigModule],
})
export class OpenApiModule implements OnApplicationBootstrap {
  constructor(@Inject('ENV') private readonly env: Env) {}

  onApplicationBootstrap(): void {
    // No-op here — main.ts / tests call .setupOpenApi(app) explicitly so
    // they control app selection.
  }
}

export function setupOpenApi(app: INestApplication, env: Env): void {
  if (!env.OPENAPI_ENABLED) return;
  const config = new DocumentBuilder()
    .setTitle('Continuous Security Demo API')
    .setVersion('1.0')
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, doc);
}
