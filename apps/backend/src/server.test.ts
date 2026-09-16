import { describe, expect, it } from 'vitest';
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
});
