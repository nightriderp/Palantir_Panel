import { describe, expect, it } from 'vitest';
import { ARCADE_GAME_CATALOG, ARCADE_GAME_IDS, ARCADE_GAMES, isArcadeGameId } from './arcade.js';

describe('Arcade-Katalog', () => {
  it('führt jede Kennung mit passender Definition', () => {
    for (const id of ARCADE_GAME_IDS) {
      const definition = ARCADE_GAME_CATALOG[id];
      expect(definition.id).toBe(id);
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.tagline.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });

  it('liefert die Spiele in Reihenfolge der Kennungen', () => {
    expect(ARCADE_GAMES.map((game) => game.id)).toEqual([...ARCADE_GAME_IDS]);
  });

  it('passt Sitzzahlen und Modi zueinander', () => {
    for (const game of ARCADE_GAMES) {
      expect(game.minPlayers).toBeGreaterThanOrEqual(1);
      expect(game.maxPlayers).toBeGreaterThanOrEqual(game.minPlayers);
      expect(game.maxPlayers).toBeLessThanOrEqual(10);
      if (game.engine === 'realtime') {
        expect(game.maxPlayers).toBe(1);
        expect(game.metric).toBe('score');
      }
      const irgendwie = game.modes.solo || game.modes.bots || game.modes.local || game.modes.online;
      expect(irgendwie).toBe(true);
    }
  });

  it('führt mindestens zwanzig Spiele', () => {
    expect(ARCADE_GAME_IDS.length).toBeGreaterThanOrEqual(20);
  });

  it('erkennt gültige und ungültige Kennungen', () => {
    expect(isArcadeGameId('kriechpfad')).toBe(true);
    expect(isArcadeGameId('snake')).toBe(false);
    expect(isArcadeGameId('schach')).toBe(true);
    expect(isArcadeGameId('')).toBe(false);
  });
});
