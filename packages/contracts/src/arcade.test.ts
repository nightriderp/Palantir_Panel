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

  it('trägt keinen der geschützten Originaltitel als Namen (Lastenheft §3.9)', () => {
    const geschuetzt = ['snake', 'pong', 'breakout', 'tetris', 'pac-man', 'pacman'];
    for (const game of ARCADE_GAMES) {
      const name = game.name.toLowerCase();
      for (const marke of geschuetzt) {
        expect(name).not.toContain(marke);
      }
    }
  });

  it('erkennt gültige und ungültige Kennungen', () => {
    expect(isArcadeGameId('kriechpfad')).toBe(true);
    expect(isArcadeGameId('snake')).toBe(false);
    expect(isArcadeGameId('')).toBe(false);
  });
});
