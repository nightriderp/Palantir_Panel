import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RbacError } from './modules/rbac/errors.js';
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
      // Ein fachlicher Fehler aus einem Modul fällt ausnahmsweise bis zum
      // Handler durch – er bleibt eine fachliche Antwort, kein 500.
      throw new RbacError('PERMISSION_DENIED', 'Dafür fehlt dir die Berechtigung.');
    });

    const response = await app.inject({ method: 'GET', url: '/__business' });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'PERMISSION_DENIED', message: 'Dafür fehlt dir die Berechtigung.' },
    });

    await app.close();
  });

  /**
   * Audit W2-9, `backend-core-03`: Der Durchgriff auf den Katalog hing früher
   * am bloßen Vorhandensein eines passend benannten `code`-Felds. Ein fremder
   * Fehler – Treiber, Bibliothek – mit demselben Namen hätte damit seine
   * Meldung nach außen getragen.
   */
  it('greift nicht auf den Katalog durch, wenn ein fremder Fehler nur ein code-Feld trägt', async () => {
    const app = await buildServer({ auth: false, database: false });
    app.get('/__fremd', async () => {
      throw Object.assign(new Error('Verbindung zu 10.10.0.5:5432 fehlgeschlagen'), {
        code: 'PERMISSION_DENIED',
      });
    });

    const response = await app.inject({ method: 'GET', url: '/__fremd' });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('INTERNAL_ERROR');
    expect(response.body).not.toContain('10.10.0.5');
    expect(response.body).not.toContain('PERMISSION_DENIED');

    await app.close();
  });

  /**
   * Audit W2-9, `backend-core-01`: Fastify wirft für kaputtes JSON einen
   * eigenen Fehler mit `statusCode: 400`. Der Handler kannte weder `ZodError`
   * noch Katalog-Code und antwortete deshalb mit 500 – samt error-Logeintrag
   * mit Stacktrace für jede anonyme Anfrage mit kaputtem Körper.
   */
  it('behält den Status eines Fastify-Fehlers unter 500 bei (kaputtes JSON → 400)', async () => {
    const app = await buildServer({ auth: false, database: false });
    app.post('/__json', async () => ({ unreachable: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/__json',
      headers: { 'content-type': 'application/json' },
      payload: '{oops',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'VALIDATION_FAILED', message: 'Die Anfrage enthält ungültige Werte.' },
    });
    // Der Originaltext des Parsers nennt Positionen im Rohkörper – der bleibt im Log.
    expect(response.body).not.toContain('JSON');

    await app.close();
  });

  it('beantwortet eine zu große Nutzlast mit FILE_TOO_LARGE (413)', async () => {
    const app = await buildServer({ auth: false, database: false });
    app.post('/__gross', { bodyLimit: 16 }, async () => ({ unreachable: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/__gross',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ feld: 'x'.repeat(64) }),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('FILE_TOO_LARGE');

    await app.close();
  });

  /**
   * Audit W2-9, `backend-core-02`: Fastify beantwortet unbekannte Routen über
   * einen eigenen Hook, den `setErrorHandler` nie sieht. Ohne
   * `setNotFoundHandler` verließ diese eine Antwort das Envelope-Format, und
   * ein Client, der `error.code` auswertet, las `undefined`.
   */
  it('beantwortet eine unbekannte Route im Envelope (404)', async () => {
    const app = await buildServer({ auth: false, database: false });

    const response = await app.inject({ method: 'GET', url: '/gibtsnicht' });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toBe('Diese Route existiert nicht.');
    // Fastifys Standardform darf nicht mehr durchschlagen.
    expect(body).not.toHaveProperty('statusCode');

    await app.close();
  });
});
