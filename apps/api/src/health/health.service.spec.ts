import { ServiceUnavailableException } from '@nestjs/common';

import { loadEnv } from '../config/env';
import {
  HealthService,
  type HealthClient,
  type HealthFetch,
  type HealthRpcResult,
} from './health.service';

const ENV = loadEnv({
  ...process.env,
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_ANON_KEY: 'anon-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-placeholder',
  SUPABASE_JWT_ISSUER: 'https://supabase.example/auth/v1',
});

type RpcRun = (signal: AbortSignal) => Promise<HealthRpcResult>;

function client(run: RpcRun, started?: Set<string>): HealthClient {
  return {
    rpc(name) {
      if (name !== 'health_check') throw new Error('wrong_rpc');
      started?.add('database');
      return { abortSignal: run };
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetcher(
  run: (url: string, init: RequestInit | undefined) => Promise<Response>,
  started?: Set<string>,
): HealthFetch {
  return async (input, init) => {
    const url = String(input);
    started?.add(url.endsWith('/health') ? 'auth' : 'jwks');
    return run(url, init);
  };
}

function genericFailure(error: unknown): void {
  expect(error).toBeInstanceOf(ServiceUnavailableException);
  const body = (error as ServiceUnavailableException).getResponse();
  expect(body).toEqual({ code: 'dependency_unavailable' });
  expect(JSON.stringify(body)).not.toMatch(
    /supabase\.example|anon-public-key|upstream body|stack|token/i,
  );
}

describe('HealthService', () => {
  it('probes database, Auth, and nonempty JWKS with the anon key', async () => {
    const rpcNames: string[] = [];
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const healthClient: HealthClient = {
      rpc(name) {
        rpcNames.push(name);
        return {
          abortSignal: async () => ({ data: true, error: null }),
        };
      },
    };
    const healthFetch = fetcher(async (url, init) => {
      requests.push({ url, init });
      return url.endsWith('/health')
        ? new Response(null, { status: 200 })
        : jsonResponse({ keys: [{ kid: 'primary' }] });
    });

    await expect(
      new HealthService(healthClient, ENV, healthFetch).check(),
    ).resolves.toBeUndefined();
    expect(rpcNames).toEqual(['health_check']);
    expect(requests.map(({ url }) => url)).toEqual([
      'https://supabase.example/auth/v1/health',
      'https://supabase.example/auth/v1/.well-known/jwks.json',
    ]);
    expect(requests[0].init?.headers).toEqual({ apikey: 'anon-public-key' });
  });

  it.each(['database', 'auth', 'jwks'] as const)(
    'fails closed when %s fails while still starting every probe',
    async (failed) => {
      const started = new Set<string>();
      const healthClient = client(async () => {
        if (failed === 'database') throw new Error('upstream body: database-secret');
        return { data: true, error: null };
      }, started);
      const healthFetch = fetcher(async (url) => {
        if (failed === 'auth' && url.endsWith('/health')) {
          return new Response('upstream body: auth-secret', { status: 503 });
        }
        if (failed === 'jwks' && url.endsWith('/jwks.json')) {
          return jsonResponse({ keys: [] });
        }
        return url.endsWith('/health')
          ? new Response(null, { status: 200 })
          : jsonResponse({ keys: [{ kid: 'primary' }] });
      }, started);

      try {
        await new HealthService(healthClient, ENV, healthFetch).check();
        throw new Error('expected health failure');
      } catch (error) {
        genericFailure(error);
      }
      expect(started).toEqual(new Set(['database', 'auth', 'jwks']));
    },
  );

  it.each(['database', 'auth', 'jwks'] as const)(
    'times out %s independently after two seconds',
    async (timedOut) => {
      jest.useFakeTimers();
      try {
        const started = new Set<string>();
        const healthClient = client(
          timedOut === 'database'
            ? async () => new Promise<HealthRpcResult>(() => {})
            : async () => ({ data: true, error: null }),
          started,
        );
        const healthFetch = fetcher(async (url) => {
          const dependency = url.endsWith('/health') ? 'auth' : 'jwks';
          if (timedOut === dependency) return new Promise<Response>(() => {});
          return dependency === 'auth'
            ? new Response(null, { status: 200 })
            : jsonResponse({ keys: [{ kid: 'primary' }] });
        }, started);
        const checking = new HealthService(healthClient, ENV, healthFetch).check();

        expect(started).toEqual(new Set(['database', 'auth', 'jwks']));
        await jest.advanceTimersByTimeAsync(1_999);
        let settled = false;
        void checking.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        await Promise.resolve();
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        try {
          await checking;
          throw new Error('expected health timeout');
        } catch (error) {
          genericFailure(error);
        }
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('starts all probes before waiting for any one to finish', async () => {
    const started = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const healthClient = client(async () => {
      await gate;
      return { data: true, error: null };
    }, started);
    const healthFetch = fetcher(async (url) => {
      await gate;
      return url.endsWith('/health')
        ? new Response(null, { status: 200 })
        : jsonResponse({ keys: [{ kid: 'primary' }] });
    }, started);

    const checking = new HealthService(healthClient, ENV, healthFetch).check();
    expect(started).toEqual(new Set(['database', 'auth', 'jwks']));
    release();
    await expect(checking).resolves.toBeUndefined();
  });
});
