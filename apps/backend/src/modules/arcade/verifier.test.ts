/**
 * Warteschlange fürs Nachrechnen.
 *
 * Der Worker-Weg lädt `verify-worker.ts` samt `tsx`-Lader (siehe Kopf von
 * `verifier.ts`). Im Test-Setup läuft er echt: Der Auftrag geht in einen
 * eigenen Faden und kommt mit dem Urteil des echten Registers zurück. Ließe
 * sich der Faden nicht starten, fiele die Warteschlange sauber auf direktes
 * Rechnen zurück – der Test prüft deshalb das Urteil unabhängig vom Weg und
 * hält den Weg selbst fest.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { miniRegistry } from './test-support.js';
import { type ArcadeVerifier, createArcadeVerifier } from './verifier.js';
import { defaultArcadeRegistry, rulesVersionOf, verifyArcadeRun } from './verify.js';

let verifier: ArcadeVerifier | null = null;

afterEach(async () => {
  await verifier?.close();
  verifier = null;
});

describe('Nachrechnen im Worker', () => {
  it('liefert das Urteil des echten Registers aus dem Faden', { timeout: 30_000 }, async () => {
    const warn = vi.fn();
    verifier = createArcadeVerifier({ logger: { warn } });
    const request = {
      gameId: 'kriechpfad' as const,
      seed: 1,
      gameVersion: rulesVersionOf(defaultArcadeRegistry, 'kriechpfad') ?? 1,
      replay: '!!! kein Base64 !!!',
    };

    const result = await verifier.verify(request);

    expect(result).toEqual(verifyArcadeRun(defaultArcadeRegistry, request));
    expect(result.ok).toBe(false);
    // Im Test-Setup läuft der Faden (tsx ist Entwicklungsabhängigkeit des Backends).
    expect(verifier.lastPath()).toBe('worker');
    expect(warn).not.toHaveBeenCalled();
  });

  it('arbeitet mehrere Aufträge nacheinander ab', { timeout: 30_000 }, async () => {
    verifier = createArcadeVerifier({ concurrency: 1 });
    const version = rulesVersionOf(defaultArcadeRegistry, 'kriechpfad') ?? 1;

    const results = await Promise.all(
      [1, 2, 3].map((seed) =>
        verifier!.verify({ gameId: 'kriechpfad', seed, gameVersion: version, replay: '%' }),
      ),
    );

    expect(results.every((result) => !result.ok)).toBe(true);
  });
});

describe('Nachrechnen direkt', () => {
  it('rechnet mit eingeschleustem Register im Hauptfaden', async () => {
    const registry = miniRegistry();
    verifier = createArcadeVerifier({ mode: 'inline', registry });

    const result = await verifier.verify({
      gameId: 'vier-gewinnt',
      seed: 5,
      gameVersion: 1,
      match: {
        options: { stones: 1 },
        seats: [{ type: 'human' }, { type: 'bot', level: 'leicht' }],
        moves: [{ seat: 0, move: { take: 1 } }],
      },
    });

    expect(result).toEqual({ ok: true, score: 1 });
    expect(verifier.lastPath()).toBe('inline');
  });

  it('macht aus einem Regelfehler eine Ablehnung statt eines Absturzes', () => {
    const registry = miniRegistry(
      {},
      {
        kriechpfad: {
          ...miniRegistry().realtime('kriechpfad')!,
          create: () => {
            throw new Error('kaputt');
          },
        },
      },
    );

    expect(
      verifyArcadeRun(registry, { gameId: 'kriechpfad', seed: 1, gameVersion: 3, replay: 'AQAA' }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('kaputt') });
  });
});
