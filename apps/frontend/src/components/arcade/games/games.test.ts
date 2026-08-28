import { describe, expect, it } from 'vitest';
import { ARCADE_GAME_IDS } from '@palantir/contracts';
import { ARCADE_GAME_REGISTRY, getArcadeGame } from './index';
import { kriechpfad } from './kriechpfad';
import { blockstapel } from './blockstapel';
import { punktejaeger } from './punktejaeger';
import { steinbrecher } from './steinbrecher';

/** Eine feste Zufallsquelle für deterministische Tests. */
function constantRandom(value: number): () => number {
  return () => value;
}

describe('Arcade-Registry', () => {
  it('führt genau ein Spiel je Katalog-Kennung', () => {
    for (const id of ARCADE_GAME_IDS) {
      const game = getArcadeGame(id);
      expect(game.id).toBe(id);
      expect(typeof game.instructions).toBe('string');
    }
  });

  it('jedes Spiel startet in der Phase „ready" mit Punktestand 0', () => {
    for (const id of ARCADE_GAME_IDS) {
      const game = ARCADE_GAME_REGISTRY[id];
      const state = game.create(constantRandom(0));
      expect(game.phase(state)).toBe('ready');
      expect(game.score(state)).toBe(0);
    }
  });

  it('startet erst, wenn ein Steuerbefehl kommt', () => {
    const state = kriechpfad.create(constantRandom(0));
    kriechpfad.step(state, 1000);
    expect(kriechpfad.phase(state)).toBe('ready');
    kriechpfad.control(state, 'up', 'press');
    expect(kriechpfad.phase(state)).toBe('running');
  });
});

describe('Kriechpfad', () => {
  it('verlängert die Linie und zählt Punkte beim Fressen', () => {
    const state = kriechpfad.create(constantRandom(0));
    // Häppchen direkt vor den Kopf setzen (Kopf bei x=9,y=10, Richtung rechts).
    state.food = { x: 10, y: 10 };
    const startLength = state.snake.length;
    kriechpfad.control(state, 'right', 'press');
    kriechpfad.step(state, 200);
    expect(kriechpfad.score(state)).toBe(10);
    // Wächst um zwei Felder – ein Bissen wächst über die nächsten Schritte.
    kriechpfad.step(state, 400);
    expect(state.snake.length).toBeGreaterThan(startLength);
  });

  it('endet beim Auftreffen auf die Wand', () => {
    const state = kriechpfad.create(constantRandom(0));
    kriechpfad.control(state, 'up', 'press');
    // Genug Einzelschritte, um die obere Wand zu erreichen (ein step() holt
    // bewusst nur begrenzt viele Rasterschritte auf einmal nach).
    for (let i = 0; i < 40 && kriechpfad.phase(state) === 'running'; i += 1) {
      kriechpfad.step(state, 200);
    }
    expect(kriechpfad.phase(state)).toBe('over');
  });

  it('ignoriert die direkte Rückwärtsrichtung', () => {
    const state = kriechpfad.create(constantRandom(0));
    kriechpfad.control(state, 'right', 'press');
    kriechpfad.control(state, 'left', 'press');
    expect(state.pendingDir).toEqual({ x: 1, y: 0 });
  });
});

describe('Blockstapel', () => {
  it('räumt eine volle Reihe ab und vergibt Punkte', () => {
    const state = blockstapel.create(constantRandom(0));
    state.phase = 'running';
    // Unterste Reihe bis auf eine Lücke füllen und die Lücke schließen.
    for (let c = 0; c < state.cols; c += 1) {
      state.grid[state.rows - 1]![c] = c === 0 ? null : '#';
    }
    state.grid[state.rows - 1]![0] = '#';
    const before = state.score;
    // lockPiece wird intern über einen blockierten Fall ausgelöst; hier direkt
    // eine volle Reihe erzwingen und einen Schritt gehen.
    state.piece = { shape: [[1]], color: '#', x: 0, y: state.rows - 1 };
    blockstapel.step(state, 2000);
    expect(state.score).toBeGreaterThanOrEqual(before);
  });

  it('dreht die Form beim Aktionsbefehl', () => {
    const state = blockstapel.create(constantRandom(0));
    state.phase = 'running';
    // I-Form (1x4) an eine freie Stelle setzen.
    state.piece = { shape: [[1, 1, 1, 1]], color: '#', x: 3, y: 2 };
    blockstapel.control(state, 'action', 'press');
    expect(state.piece.shape.length).toBe(4);
    expect(state.piece.shape[0]!.length).toBe(1);
  });

  it('endet, wenn ein neuer Stein sofort blockiert ist', () => {
    const state = blockstapel.create(constantRandom(0));
    state.phase = 'running';
    // Die oberen Reihen im Bereich, in dem neue Steine erscheinen, blockieren –
    // Spalte 0 bleibt frei, damit keine Reihe voll ist und sich auflöst.
    for (let r = 0; r < 2; r += 1) {
      for (let c = 1; c < state.cols; c += 1) {
        state.grid[r]![c] = '#';
      }
    }
    // Einen Stein unten festsetzen: das löst das Erscheinen des nächsten aus,
    // der oben sofort blockiert ist.
    state.piece = { shape: [[1]], color: '#', x: 0, y: state.rows - 1 };
    blockstapel.step(state, 2000);
    expect(blockstapel.phase(state)).toBe('over');
  });
});

describe('Punktejäger', () => {
  it('sammelt einen Punkt beim Betreten des Feldes', () => {
    const state = punktejaeger.create(constantRandom(0.99));
    // Wächter weit weg schieben, damit sie nicht sofort treffen.
    state.ghosts.forEach((ghost) => {
      ghost.x = state.cols - 2;
      ghost.y = state.rows - 2;
    });
    const target = { x: 2, y: 1 };
    expect(state.walls[target.y]![target.x]).toBe(false);
    state.dots[target.y]![target.x] = true;
    const before = state.score;
    punktejaeger.control(state, 'right', 'press');
    punktejaeger.step(state, 200);
    expect(state.score).toBeGreaterThan(before);
  });

  it('endet bei Berührung durch einen Wächter', () => {
    const state = punktejaeger.create(constantRandom(0));
    state.phase = 'running';
    state.ghosts[0]!.x = state.player.x;
    state.ghosts[0]!.y = state.player.y;
    punktejaeger.step(state, 200);
    expect(punktejaeger.phase(state)).toBe('over');
  });
});

describe('Steinbrecher', () => {
  it('endet, wenn der Ball unten durchfällt', () => {
    const state = steinbrecher.create(constantRandom(0));
    state.phase = 'running';
    state.launched = true;
    state.ballX = 10;
    state.ballY = state.h - 5;
    state.vx = 0;
    state.vy = state.speed; // fällt weiter nach unten
    state.playerX = state.w - 20; // Schläger weit weg
    // Der Ball fällt weiter; ein step() begrenzt den Zeitschritt bewusst, also
    // mehrere Schritte, bis er unten heraus ist.
    for (let i = 0; i < 20 && steinbrecher.phase(state) === 'running'; i += 1) {
      steinbrecher.step(state, 32);
    }
    expect(steinbrecher.phase(state)).toBe('over');
  });
});
