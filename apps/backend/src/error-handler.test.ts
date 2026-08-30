import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildServer } from './server.js';

/**
 * Der globale `setErrorHandler` (N6, Gefundener Punkt 97) ist das Sicherheitsnetz
 * für alles, was die Routen nicht bewusst abfangen. Geprüft wird an Routen, die
 * absichtlich einen rohen bzw. fachlichen Fehler werfen – ohne Datenbank und
 * ohne Auth, wie das übrige Grundgerüst (`auth: false`, `database: false`).
 */
describe('Globaler Fehler-Handler', () => {
  it('beantwortet einen rohen Laufzeitfehler im Envelope mit INTERNAL_ERROR (500)', async () => {
    const app = await buildServer({ auth: false, database: false });
    // Log stummschalten: der Handler protokolliert den echten Fehler bewusst auf
    // error-Ebene – im Test soll das die Ausgabe nicht fluten.
    app.get('/__boom', async () => {
      throw new Error('roher Laufzeitfehler mit Interna: DB-Passwort=geheim');
    });

    const response = await app.inject({ method: 'GET', url: '/__boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Ein interner Fehler ist aufgetreten.' },
    });
    // Kein Interna-Leck nach außen: weder Meldung noch Stacktrace des Rohfehlers.
    expect(response.body).not.toContain('geheim');
    expect(response.body).not.toContain('roher Laufzeitfehler');

    await app.close();
  });

  it('bildet einen ZodError auf VALIDATION_FAILED (400) ab', async () => {
    const app = await buildServer({ auth: false, database: false });
    app.get('/__zod', async () => {
      z.object({ name: z.string() }).parse({ name: 123 });
      return { unreachable: true };
    });

    const response = await app.inject({ method: 'GET', url: '/__zod' });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    // Feldbezogene Meldung, nicht der rohe Zod-Baum.
    expect(body.error.message).toContain('name');

    await app.close();
  });

  it('behält den eigenen Katalog-Code eines fachlichen Fehlers bei', async () => {
    const app = await buildServer({ auth: false, database: false });
    app.get('/__business', async () => {
      // Ein Fehler mit gültigem Katalog-Code, wie ihn die Modul-Fehlerklassen
      // tragen (hier minimal nachgebildet), fällt ausnahmsweise bis zum Handler
      // durch – er bleibt eine fachliche Antwort, kein 500.
      const error = Object.assign(new Error('Dieser Server existiert nicht.'), {
        code: 'SERVER_NOT_FOUND' as const,
      });
      throw error;
    });

    const response = await app.inject({ method: 'GET', url: '/__business' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'SERVER_NOT_FOUND', message: 'Dieser Server existiert nicht.' },
    });

    await app.close();
  });
});
