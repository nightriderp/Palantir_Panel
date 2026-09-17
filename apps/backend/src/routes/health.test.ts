import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { type HealthRouteOptions, registerHealthRoutes } from './health.js';

/**
 * `/health` mit Datenbank-Probe (Review 2026-09-16, Befund 8.8).
 */

let app: FastifyInstance | null = null;

async function baueApp(options: HealthRouteOptions = {}): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  await app.register(registerHealthRoutes, options);
  await app.ready();

  return app;
}

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('GET /health', () => {
  it('meldet ohne Probe nur den Prozess', async () => {
    const instance = await baueApp();
    const response = await instance.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: { status: 'ok', service: 'backend', database: 'skipped' },
      error: null,
    });
  });

  it('meldet ok, wenn die Datenbank antwortet', async () => {
    const instance = await baueApp({ probeDatabase: async () => undefined });
    const response = await instance.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { database: string } }>().data.database).toBe('ok');
  });

  it('antwortet mit 503, wenn die Probe wirft', async () => {
    const instance = await baueApp({
      probeDatabase: async () => {
        throw new Error('Verbindung verweigert');
      },
    });
    const response = await instance.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json<{ success: boolean; error: { code: string } }>()).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });

  it('antwortet mit 503, wenn die Probe die Frist überschreitet', async () => {
    const instance = await baueApp({
      probeDatabase: () => new Promise(() => undefined),
      probeTimeoutMs: 20,
    });
    const response = await instance.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
  });
});
