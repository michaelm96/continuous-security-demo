// ConfigModule wires the typed Env + a configured pino logger into the DI
// graph. The factory throws on misconfiguration; main.ts catches and exits.
//
// Pino redaction (Spec §10.3):
// - req.headers.authorization, req.headers.cookie, res.headers["set-cookie"]
// - *.SUPABASE_SERVICE_ROLE_KEY, *.SUPABASE_ANON_KEY
// - *.password, *.access_token, *.refresh_token, *.authorization
// - *.reason → logged as { reasonLength, reasonHashPrefix } only
// - req.body → omitted entirely

import { Module, OnModuleInit, Provider } from '@nestjs/common';
import { pino, type Logger as PinoLogger } from 'pino';
import { loadEnv, type Env } from './env';

export const ENV = 'ENV';
export const PINO_LOGGER = 'PINO_LOGGER';
export const NODE_ENV = 'NODE_ENV';

const pinoLoggerProvider: Provider = {
  provide: PINO_LOGGER,
  useFactory: (env: Env): PinoLogger => {
    const redactPaths = [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.SUPABASE_SERVICE_ROLE_KEY',
      '*.SUPABASE_ANON_KEY',
      '*.password',
      '*.access_token',
      '*.refresh_token',
      '*.authorization',
      '*.reason',
      'req.body',
    ];
    const base = {
      level: env.LOG_LEVEL,
      redact: { paths: redactPaths, censor: '[REDACTED]' },
      formatters: {
        level: (label: string) => ({ level: label }),
      },
      timestamp: () => `,"time":${Date.now()}`,
    } as const;
    if (env.NODE_ENV === 'development') {
      return pino({
        ...base,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, singleLine: true },
        },
      });
    }
    return pino(base);
  },
  inject: [ENV],
};

const envProvider: Provider = {
  provide: ENV,
  // loadEnv throws ConfigurationInvalidError; main.ts catches and exits.
  useFactory: () => loadEnv(process.env),
};

const nodeEnvProvider: Provider = {
  provide: NODE_ENV,
  useFactory: (env: Env) => env.NODE_ENV,
  inject: [ENV],
};

@Module({
  providers: [envProvider, nodeEnvProvider, pinoLoggerProvider],
  exports: [ENV, NODE_ENV, PINO_LOGGER],
})
export class ConfigModule implements OnModuleInit {
  onModuleInit(): void {
    // no-op; logger is already constructed via factory.
  }
}
