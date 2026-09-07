/**
 * Missbrauchsgrenzen für angemeldete Konten (Audit W2-3,
 * `security-matrix-05`).
 *
 * Geprüft wird der Mechanismus, den alle fünf Schreibrouten benutzen: Gezählt
 * wird je Konto und je Vorgang, die Ablehnung trägt den Envelope aus
 * Pflichtenheft §5.1 mit einem benannten Code, und ein zweites Konto ist von
 * der Grenze des ersten nie betroffen.
 */

import { httpStatusForErrorCode } from '@palantir/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ABUSE_LIMITS,
  ABUSE_LIMIT_ERROR_CODE,
  accountRateLimit,
  createAccountRateLimiter,
} from './abuse-limits.js';

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

/**
 * Eine Instanz mit genau einer geschützten Route.
 *
 * Das Konto kommt wie im Betrieb aus der Sitzungsauflösung – hier aus dem Kopf
 * `x-test-actor`; kein Kopf heißt „niemand angemeldet".
 */
async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });

  instance.post(
    '/probe',
    {
      preHandler: accountRateLimit({
        scope: 'chat.message',
        resolveUserId: (request) => {
          const kopf = request.headers['x-test-actor'];

          return typeof kopf === 'string' ? kopf : null;
        },
      }),
    },
    async () => ({ success: true, data: null, error: null }),
  );

  await instance.ready();
  app = instance;

  return instance;
}

function anfrage(instance: FastifyInstance, actor: string | null) {
  return instance.inject({
    method: 'POST',
    url: '/probe',
    ...(actor === null ? {} : { headers: { 'x-test-actor': actor } }),
  });
}

describe('accountRateLimit', () => {
  it('lässt die vorgesehene Anzahl durch und lehnt den Aufruf danach ab', async () => {
    const instance = await buildApp();
    const grenze = ABUSE_LIMITS['chat.message'].maxAttempts;

    for (let versuch = 1; versuch <= grenze; versuch += 1) {
      expect((await anfrage(instance, 'alex')).statusCode).toBe(200);
    }

    const abgelehnt = await anfrage(instance, 'alex');

    expect(abgelehnt.statusCode).toBe(429);
    expect(abgelehnt.json()).toMatchObject({
      success: false,
      data: null,
      error: { code: ABUSE_LIMIT_ERROR_CODE },
    });
  });

  it('meldet den eigenen 429er des Kontos, nicht den des Anmeldeformulars', () => {
    // Contracts-Nachzug W2-C2: Vorher lieh sich die Grenze `AUTH_RATE_LIMITED`.
    // Der zählt je IP und bedeutet für die Oberfläche „warte vor dem nächsten
    // Anmeldeversuch" – für ein angemeldetes Konto die falsche Auskunft.
    expect(ABUSE_LIMIT_ERROR_CODE).toBe('RATE_LIMITED');
    expect(httpStatusForErrorCode(ABUSE_LIMIT_ERROR_CODE)).toBe(429);
  });

  it('nennt in „retry-after", wann der nächste Versuch Sinn hat', async () => {
    const instance = await buildApp();

    for (let versuch = 0; versuch < ABUSE_LIMITS['chat.message'].maxAttempts; versuch += 1) {
      await anfrage(instance, 'alex');
    }

    const abgelehnt = await anfrage(instance, 'alex');
    const kopf = Number(abgelehnt.headers['retry-after']);

    expect(kopf).toBeGreaterThan(0);
    expect(kopf).toBeLessThanOrEqual(ABUSE_LIMITS['chat.message'].windowSeconds);
  });

  it('zählt je Konto – ein anderes Konto ist nicht betroffen', async () => {
    const instance = await buildApp();

    for (let versuch = 0; versuch <= ABUSE_LIMITS['chat.message'].maxAttempts; versuch += 1) {
      await anfrage(instance, 'alex');
    }

    expect((await anfrage(instance, 'alex')).statusCode).toBe(429);
    expect((await anfrage(instance, 'bea')).statusCode).toBe(200);
  });

  it('zählt ohne Sitzung nichts – dort weist die Route selbst ab', async () => {
    const instance = await buildApp();

    for (let versuch = 0; versuch < ABUSE_LIMITS['chat.message'].maxAttempts * 2; versuch += 1) {
      expect((await anfrage(instance, null)).statusCode).toBe(200);
    }
  });
});

describe('createAccountRateLimiter', () => {
  it('führt getrennte Kontingente je Vorgang', () => {
    const nachrichten = createAccountRateLimiter('chat.message', {
      windowSeconds: 60,
      maxAttempts: 1,
    });
    const meldungen = createAccountRateLimiter('chat.report', {
      windowSeconds: 60,
      maxAttempts: 1,
    });

    expect(nachrichten.consume('alex', 1_000).allowed).toBe(true);
    expect(nachrichten.consume('alex', 1_100).allowed).toBe(false);
    // Wer sein Nachrichten-Kontingent verbraucht hat, darf weiter melden.
    expect(meldungen.consume('alex', 1_100).allowed).toBe(true);
  });

  it('gibt das Kontingent frei, sobald der älteste Versuch aus dem Fenster fällt', () => {
    const limiter = createAccountRateLimiter('chat.message', {
      windowSeconds: 60,
      maxAttempts: 2,
    });

    expect(limiter.consume('alex', 0).allowed).toBe(true);
    expect(limiter.consume('alex', 1_000).allowed).toBe(true);
    expect(limiter.consume('alex', 2_000).allowed).toBe(false);
    expect(limiter.consume('alex', 61_000).allowed).toBe(true);
  });
});
