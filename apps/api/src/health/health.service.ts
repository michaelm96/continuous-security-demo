import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export interface HealthRpcResult {
  data: unknown;
  error: unknown;
}

export interface HealthClient {
  rpc(name: 'health_check'): {
    abortSignal(signal: AbortSignal): PromiseLike<HealthRpcResult>;
  };
}

export type HealthFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export const HEALTH_CLIENT = Symbol('HEALTH_CLIENT');
export const HEALTH_FETCH = Symbol('HEALTH_FETCH');

@Injectable()
export class HealthService {
  constructor(
    @Inject(HEALTH_CLIENT) private readonly client: HealthClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(HEALTH_FETCH) private readonly fetchFn: HealthFetch,
  ) {}

  async check(): Promise<void> {
    try {
      await Promise.all([
        this.runProbe((signal) => this.checkDatabase(signal)),
        this.runProbe((signal) => this.checkAuth(signal)),
        this.runProbe((signal) => this.checkJwks(signal)),
      ]);
    } catch {
      throw new ServiceUnavailableException({
        code: 'dependency_unavailable',
      });
    }
  }

  private async checkDatabase(signal: AbortSignal): Promise<void> {
    const { data, error } = await this.client
      .rpc('health_check')
      .abortSignal(signal);
    if (error || data !== true) throw new Error('dependency_unavailable');
  }

  private async checkAuth(signal: AbortSignal): Promise<void> {
    const response = await this.fetchFn(`${this.env.SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: this.env.SUPABASE_ANON_KEY },
      signal,
    });
    if (!response.ok) throw new Error('dependency_unavailable');
  }

  private async checkJwks(signal: AbortSignal): Promise<void> {
    const response = await this.fetchFn(
      `${this.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
      { signal },
    );
    if (!response.ok) throw new Error('dependency_unavailable');

    const body: unknown = await response.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('keys' in body) ||
      !Array.isArray(body.keys) ||
      body.keys.length === 0
    ) {
      throw new Error('dependency_unavailable');
    }
  }

  private async runProbe(
    run: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      await Promise.race([
        run(controller.signal),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener(
            'abort',
            () => reject(new Error('dependency_unavailable')),
            { once: true },
          ),
        ),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
}
