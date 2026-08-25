import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';

describe('Backend-Grundgerüst', () => {
  it('antwortet auf /health im Envelope-Format (Pflichtenheft §5.1)', async () => {
    const app = await buildServer();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: { status: 'ok', service: 'backend' },
      error: null,
    });

    await app.close();
  });
});
