import { describe, expect, it } from 'vitest';
import { type Database } from '../../db/client.js';
import { createDrizzleArcadeRepository } from './repository.js';

/**
 * Audit W2-9 (Fundpunkt 146), abgeschlossen in W3-5: Der Schreibweg warf einen
 * rohen `Error`, wenn `returning()` leer blieb – ein Fehler ohne Code aus dem
 * Katalog (CLAUDE.md §5). Geprüft wird ohne Datenbank: Der Drizzle-Aufrufbaum
 * wird nur so weit nachgebildet, wie das Repository ihn durchläuft (Muster von
 * `server-orchestration/schedule-repository.test.ts`).
 */

/** Nachbau der Kette `insert(...).values(...).returning()` – liefert keine Zeile. */
function dbOhneZeile(): Database {
  const attrappe = {
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
  };

  // Bewusst über `unknown` gecastet: Die echte Drizzle-Instanz hat Dutzende
  // Methoden, von denen dieser Test genau eine anfasst.
  return attrappe as unknown as Database;
}

describe('Arcade-Repository: Einfügen ohne Ergebniszeile', () => {
  it('meldet ein wirkungsloses Einfügen mit einem benannten Katalog-Code statt als rohem Fehler', async () => {
    const repository = createDrizzleArcadeRepository(dbOhneZeile());

    await expect(
      repository.insertScore({
        userId: '11111111-1111-4111-8111-000000000001',
        gameId: 'kriechpfad',
        score: 120,
      }),
    ).rejects.toMatchObject({
      name: 'ArcadeError',
      code: 'INTERNAL_ERROR',
    });
  });
});
