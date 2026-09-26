import {
  type RealtimeGame,
  decodeArcadeReplay,
  encodeArcadeReplay,
  runArcadeReplay,
} from '@palantir/arcade';
import { describe, expect, it } from 'vitest';
import { RealtimeSession } from './session';

/**
 * Takt und Warteschlange des Echtzeit-Wirts.
 *
 * Entscheidend ist, dass das aufgezeichnete Band beim Nachspielen im Backend
 * genau den Stand ergibt, den der Browser gesehen hat – sonst lehnt das
 * Backend jede Einsendung ab oder, schlimmer, wertet eine andere.
 */

interface Toy {
  ticks: number;
  /** Eingaben in der Reihenfolge, in der sie Schritte erreichten. */
  seen: number[];
  sum: number;
  inputDriven: boolean;
}

function toyGame(
  options: { tickMs?: number; endAfter?: number; inputDriven?: boolean } = {},
): RealtimeGame<Toy> {
  return {
    kind: 'realtime',
    id: 'kriechpfad',
    version: 1,
    create: (seed) => ({
      ticks: 0,
      seen: [],
      sum: seed % 7,
      inputDriven: options.inputDriven ?? false,
    }),
    step: (state, input) => {
      state.ticks += 1;
      if (input) {
        state.seen.push(input);
        state.sum = state.sum * 3 + input;
      }
      return state;
    },
    isOver: (state) => state.ticks >= (options.endAfter ?? 1_000),
    score: (state) => state.sum,
    tickMs: (state) => (state.inputDriven ? 0 : (options.tickMs ?? 10)),
  };
}

describe('RealtimeSession', () => {
  it('rechnet feste Schritte aus der vergangenen Zeit', () => {
    const session = new RealtimeSession(toyGame({ tickMs: 10 }), 1);
    expect(session.advance(25)).toBe(2);
    expect(session.advance(5)).toBe(1);
    expect(session.tick).toBe(3);
  });

  it('holt nach einem Ruckler nur begrenzt auf und verwirft den Rest', () => {
    const session = new RealtimeSession(toyGame({ tickMs: 10 }), 1, { maxCatchUp: 4 });
    expect(session.advance(1_000)).toBe(4);
    // Kein Zeitraffer: Das nächste kurze Bild bringt höchstens einen Schritt.
    expect(session.advance(1)).toBeLessThanOrEqual(1);
  });

  it('gibt je Schritt höchstens eine Eingabe ab', () => {
    const session = new RealtimeSession(toyGame({ tickMs: 10 }), 1);
    session.enqueue(1);
    session.enqueue(2);
    session.enqueue(3);
    session.advance(10);
    expect(session.state.seen).toEqual([1]);
    session.advance(20);
    expect(session.state.seen).toEqual([1, 2, 3]);
    const band = session.finish();
    expect(band.events.map((e) => e.tick)).toEqual([0, 1, 2]);
  });

  it('begrenzt die Warteschlange', () => {
    const session = new RealtimeSession(toyGame({ tickMs: 10 }), 1, { maxQueue: 2 });
    session.enqueue(1);
    session.enqueue(2);
    session.enqueue(3);
    expect(session.pending).toBe(2);
  });

  it('schreitet ohne Zeittakt nur bei Eingaben fort', () => {
    const session = new RealtimeSession(toyGame({ inputDriven: true }), 1);
    expect(session.advance(5_000)).toBe(0);
    session.enqueue(4);
    session.enqueue(2);
    expect(session.advance(0)).toBe(2);
    expect(session.state.seen).toEqual([4, 2]);
  });

  it('bleibt am Ende stehen und nimmt nichts mehr an', () => {
    const session = new RealtimeSession(toyGame({ tickMs: 10, endAfter: 3 }), 1);
    session.advance(100);
    expect(session.over).toBe(true);
    expect(session.tick).toBe(3);
    session.enqueue(1);
    expect(session.pending).toBe(0);
  });

  it('ergibt beim Nachspielen denselben Stand', () => {
    const game = toyGame({ tickMs: 16, endAfter: 40 });
    const session = new RealtimeSession(game, 12345);
    let t = 0;
    while (!session.over) {
      if (t % 3 === 0) session.enqueue((t % 5) + 1);
      session.advance(7 + (t % 11));
      t += 1;
    }
    const bytes = encodeArcadeReplay(session.finish());
    const decoded = decodeArcadeReplay(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const replay = runArcadeReplay(game, 12345, decoded.recording);
    expect(replay.finished).toBe(true);
    expect(replay.score).toBe(session.score);
    expect(replay.ticks).toBe(session.tick);
  });
});
