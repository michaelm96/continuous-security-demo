import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { loadEnv, ConfigurationInvalidError } from './config/env';
import { applyEdge } from './common/bootstrap-app';

async function bootstrap(): Promise<void> {
  let env;
  try {
    env = loadEnv(process.env);
  } catch (err) {
    if (err instanceof ConfigurationInvalidError) {
      process.stderr.write(
        JSON.stringify({
          level: 50,
          time: Date.now(),
          code: 'configuration_invalid',
          invalidKeys: err.invalidKeys,
          msg: 'configuration_invalid',
        }) + '\n',
      );
      process.exit(1);
    }
    throw err;
  }

  const app = await NestFactory.create(AppModule, { logger: false });

  applyEdge(app, env);

  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
}

void bootstrap();
