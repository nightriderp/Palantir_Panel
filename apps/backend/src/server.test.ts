import { describe, expect, it } from 'vitest';
import { env } from './config/env.js';
import { buildServer } from './server.js';

describe('Backend-Grundgerüst', () => {
  it('antwortet auf /health im Envelope-Format (Pflichtenheft §5.1)', async () => {
    // `auth: false` (ergänzt in B1): das Grundgerüst soll ohne Datenbank und
    // ohne die Geheimnisse aus der zentralen `.env` prüfbar bleiben. Die
    // Auth-Routen haben ihren eigenen Test in `modules/auth/routes.test.ts`.
    const app = await buildServer({ auth: false });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    // `database` haengt davon ab, ob eine Datenbank erreichbar ist (CI: ja,
    // lokal ohne DATABASE_URL: `skipped`); die Probe selbst prueft
    // `routes/health.test.ts`.
    expect(response.json()).toMatchObject({
      success: true,
      data: { status: 'ok', service: 'backend' },
      error: null,
    });

    await app.close();
  });

  /**
   * Der Preflight muss jede Methode nennen, die die API benutzt. `@fastify/cors`
   * 11 erlaubt in der Vorgabe nur `GET,HEAD,POST`; nach dem Sprung darauf
   * scheiterte jeder PUT, PATCH und DELETE aus dem Browser, ohne dass der
   * Server je eine fehlgeschlagene Anfrage sah. Dieser Test hält die Liste
   * fest, damit die nächste Version des Plugins nicht wieder still etwas
   * herausnimmt.
   */
  it.each(['PUT', 'PATCH', 'DELETE', 'POST'])(
    'erlaubt %s im CORS-Preflight für das Frontend',
    async (methode) => {
      const app = await buildServer({ auth: false });
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/admin/instance-settings',
        headers: {
          origin: env.PUBLIC_WEB_URL,
          'access-control-request-method': methode,
          'access-control-request-headers': 'content-type,x-csrf-token',
        },
      });

      expect(response.statusCode).toBe(204);
      const erlaubt = String(response.headers['access-control-allow-methods'] ?? '')
        .split(',')
        .map((eintrag) => eintrag.trim());
      expect(erlaubt).toContain(methode);
      expect(response.headers['access-control-allow-origin']).toBe(env.PUBLIC_WEB_URL);
      expect(response.headers['access-control-allow-credentials']).toBe('true');

      await app.close();
    },
  );
});
