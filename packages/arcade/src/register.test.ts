import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCADE_GAME_CATALOG, ARCADE_GAME_IDS } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { REALTIME_GAMES, TURN_GAMES } from './games/index.js';

/**
 * Querschnittsprüfungen über alle Spiele.
 *
 * Katalog (Contracts) und Register (Regeln) sind zwei Listen, die zueinander
 * passen müssen: Das Backend wählt am Katalog-Feld `engine` den Weg des
 * Nachrechnens und holt dann die Regeln aus dem Register. Liegt ein Spiel im
 * falschen Register oder stimmen die Sitzgrenzen nicht, lehnt es jede Partie ab.
 */

describe('Register der Spielregeln', () => {
  it('führt jedes Katalog-Spiel genau einmal im passenden Register', () => {
    for (const id of ARCADE_GAME_IDS) {
      const definition = ARCADE_GAME_CATALOG[id];
      const realtime = REALTIME_GAMES[id];
      const turn = TURN_GAMES[id];
      if (definition.engine === 'realtime') {
        expect(realtime?.id, id).toBe(id);
        expect(turn, id).toBeUndefined();
      } else {
        expect(turn?.id, id).toBe(id);
        expect(realtime, id).toBeUndefined();
      }
    }
  });

  it('übernimmt die Sitzgrenzen aus dem Katalog', () => {
    for (const [id, game] of Object.entries(TURN_GAMES)) {
      if (!game || game.version === 0) continue; // Platzhalter während des Baus
      const definition = ARCADE_GAME_CATALOG[game.id];
      expect(game.minPlayers, id).toBe(definition.minPlayers);
      expect(game.maxPlayers, id).toBe(definition.maxPlayers);
    }
  });

  it('bietet Bots genau dort, wo der Katalog sie verspricht', () => {
    for (const [id, game] of Object.entries(TURN_GAMES)) {
      if (!game || game.version === 0) continue;
      const definition = ARCADE_GAME_CATALOG[game.id];
      expect(typeof game.bot === 'function', id).toBe(definition.modes.bots);
    }
  });
});

describe('Reinheit der Regeln', () => {
  const gamesDir = join(dirname(fileURLToPath(import.meta.url)), 'games');
  const files = readdirSync(gamesDir).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );

  /*
   * Die Regeln laufen im Browser und beim Nachrechnen im Backend. Ein einziger
   * Blick auf Uhr oder Systemzufall ließe beide Seiten auseinanderlaufen – der
   * Fehler fiele erst auf, wenn eine ehrliche Partie abgelehnt wird.
   */
  it.each(files)('%s nutzt weder Math.random noch die Uhr', (name) => {
    const source = readFileSync(join(gamesDir, name), 'utf8');
    expect(source).not.toMatch(/Math\.random\s*\(/);
    expect(source).not.toMatch(/Date\.now\s*\(|new Date\s*\(|performance\.now\s*\(/);
  });
});
