import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLebenszeichen } from './lebenszeichen.js';

/**
 * Lebenszeichen für den Docker-Healthcheck (Review 2026-09-16, Befund 8.3).
 */

const ordner: string[] = [];

async function neuerOrdner(): Promise<string> {
  const pfad = await mkdtemp(path.join(tmpdir(), 'palantir-lebenszeichen-'));
  ordner.push(pfad);

  return pfad;
}

async function kurzWarten(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(ordner.splice(0).map((pfad) => rm(pfad, { recursive: true, force: true })));
});

describe('startLebenszeichen', () => {
  it('schreibt sofort Zeitpunkt und Zustand', async () => {
    const pfad = path.join(await neuerOrdner(), 'alive');
    const zeichen = startLebenszeichen({
      pfad,
      intervallMs: 60_000,
      zustand: () => 'verbunden',
      now: () => new Date('2026-09-16T12:00:00.000Z'),
    });
    await kurzWarten();

    expect(await readFile(pfad, 'utf8')).toBe('2026-09-16T12:00:00.000Z verbunden\n');
    zeichen.stop();
  });

  it('schreibt im Takt weiter und hört nach stop() auf', async () => {
    const pfad = path.join(await neuerOrdner(), 'alive');
    let tick = 0;
    const zeichen = startLebenszeichen({
      pfad,
      intervallMs: 20,
      now: () => new Date(1_000 * ++tick),
    });
    await kurzWarten(70);
    expect(tick).toBeGreaterThan(1);

    zeichen.stop();
    // Ein gerade laufender Schreibvorgang darf noch landen; erst danach ist
    // der Stand eingefroren.
    await kurzWarten(30);
    const beimStop = tick;
    const vorher = await readFile(pfad, 'utf8');
    await kurzWarten(70);

    expect(tick).toBe(beimStop);
    expect(await readFile(pfad, 'utf8')).toBe(vorher);
  });

  it('meldet einen Schreibfehler, statt den Prozess zu beenden', async () => {
    const onError = vi.fn();
    const zeichen = startLebenszeichen({
      pfad: path.join(await neuerOrdner(), 'gibt-es-nicht', 'alive'),
      intervallMs: 60_000,
      onError,
    });
    await kurzWarten();

    expect(onError).toHaveBeenCalledTimes(1);
    zeichen.stop();
  });
});
