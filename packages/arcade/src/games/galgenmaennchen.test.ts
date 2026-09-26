import { describe, expect, it } from 'vitest';
import { applyRawMove, createMatch, replayTurnMatch, type RecordedMove } from '../turn.js';
import { GALGEN_KATEGORIEN } from './galgenmaennchen-woerter.js';
import {
  GALGEN_ALPHABET,
  MAX_WRONG,
  game,
  normalizeWord,
  upperGerman,
  type GalgenMove,
  type GalgenState,
} from './galgenmaennchen.js';

function apply(state: GalgenState, seat: number, move: GalgenMove): GalgenState {
  const result = game.applyMove(state, seat, move);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe('Galgenmännchen – Wortliste', () => {
  it('hat mindestens 300 gültige, eindeutige Wörter', () => {
    const all = GALGEN_KATEGORIEN.flatMap((k) => k.woerter.map((w) => upperGerman(w)));
    expect(all.length).toBeGreaterThanOrEqual(300);
    expect(new Set(all).size).toBe(all.length);
    for (const w of all) expect(normalizeWord(w)).toBe(w);
    expect(GALGEN_KATEGORIEN.length).toBeGreaterThanOrEqual(5);
  });
});

describe('Galgenmännchen – allein', () => {
  it('wählt ein Wort aus der Kategorie und verrät es nicht', () => {
    const state = game.setup({ players: 1, seed: 5, options: { kategorie: 'tiere' } });
    const tiere = GALGEN_KATEGORIEN.find((k) => k.id === 'tiere')?.woerter.map(upperGerman) ?? [];
    expect(tiere).toContain(state.word);
    const view = game.view(state, 0);
    expect(view.word).toBeNull();
    expect(view.pattern.every((c) => c === null)).toBe(true);
    expect(JSON.stringify(view)).not.toContain(state.word);
    expect(view.category).toBe('Tiere');
  });

  it('Sieg durch Buchstaben, Sieger ist Sitz 0', () => {
    let state = game.setup({ players: 1, seed: 8, options: { kategorie: 'alle' } });
    const letters = [...new Set([...state.word].filter((c) => GALGEN_ALPHABET.includes(c)))];
    for (const b of letters) state = apply(state, 0, { type: 'buchstabe', b });
    expect(state.over).toBe(true);
    expect(game.outcome(state)?.winners).toEqual([0]);
    expect(game.view(state, 0).word).toBe(state.word);
  });

  it('nach zehn Fehlern ist die Partie verloren', () => {
    let state = game.setup({ players: 1, seed: 9, options: { kategorie: 'alle' } });
    const wrong = GALGEN_ALPHABET.filter((c) => !state.word.includes(c));
    for (let i = 0; i < MAX_WRONG; i += 1)
      state = apply(state, 0, { type: 'buchstabe', b: wrong[i] as string });
    expect(state.over).toBe(true);
    expect(game.outcome(state)?.winners).toEqual([]);
  });

  it('doppelt geratene Buchstaben werden abgelehnt', () => {
    let state = game.setup({ players: 1, seed: 10, options: { kategorie: 'alle' } });
    const b = state.word[0] as string;
    state = apply(state, 0, { type: 'buchstabe', b });
    expect(game.applyMove(state, 0, { type: 'buchstabe', b }).ok).toBe(false);
  });

  it('ganzes Wort lösen, auch klein geschrieben; Nachrechnen stimmt', () => {
    const match = createMatch(game, 21, { kategorie: 'essen' }, [{ type: 'human' }]);
    const moves: RecordedMove[] = [
      { seat: 0, move: { type: 'loesung', wort: 'xyz' } },
      { seat: 0, move: { type: 'loesung', wort: match.state.word.toLowerCase() } },
    ];
    let current = match;
    for (const m of moves) {
      const r = applyRawMove(game, current, 0, m.move);
      expect(r.ok).toBe(true);
      if (r.ok) current = r.state;
    }
    expect(current.state.wrong).toBe(1);
    expect(game.outcome(current.state)?.winners).toEqual([0]);
    const replay = replayTurnMatch(game, 21, { kategorie: 'essen' }, [{ type: 'human' }], moves);
    expect(replay.ok && replay.outcome.winners).toEqual([0]);
  });
});

describe('Galgenmännchen – zu mehreren', () => {
  it('Wortgeber reihum, nur der Wortgeber sieht das Wort, Punkte am Ende', () => {
    let state = game.setup({ players: 3, seed: 1, options: { kategorie: 'alle' } });
    expect(game.activeSeats(state)).toEqual([0]);
    expect(game.applyMove(state, 1, { type: 'setzeWort', wort: 'Hallo', hinweis: '' }).ok).toBe(
      false,
    );
    expect(game.applyMove(state, 0, { type: 'setzeWort', wort: 'ab', hinweis: '' }).ok).toBe(false);
    expect(game.applyMove(state, 0, { type: 'setzeWort', wort: 'Hallo1', hinweis: '' }).ok).toBe(
      false,
    );
    state = apply(state, 0, {
      type: 'setzeWort',
      wort: 'Straßen-bahn',
      hinweis: 'Fährt auf Schienen',
    });
    expect(state.word).toBe('STRAßEN-BAHN');
    expect(game.view(state, 0).word).toBe('STRAßEN-BAHN');
    expect(game.view(state, 1).word).toBeNull();
    expect(JSON.stringify(game.view(state, 1))).not.toContain('STRAß');
    expect(JSON.stringify(game.view(state, null))).not.toContain('STRAß');
    expect(game.view(state, 1).pattern[7]).toBe('-');
    expect(game.activeSeats(state)).toEqual([1]);

    state = apply(state, 1, { type: 'buchstabe', b: 'A' });
    expect(state.scores[1]).toBe(2);
    expect(game.activeSeats(state)).toEqual([2]);
    state = apply(state, 2, { type: 'loesung', wort: 'strassenbahn' });
    expect(state.wrong).toBe(1);
    state = apply(state, 1, { type: 'loesung', wort: 'straßen - bahn' });
    // Runde 2: Sitz 1 ist Wortgeber
    expect(state.round).toBe(1);
    expect(game.activeSeats(state)).toEqual([1]);
    expect(state.results[0]?.solver).toBe(1);

    // 2 für „A", 3 fürs Lösen, 9 für die noch verdeckten Buchstaben
    expect(state.scores[1]).toBe(14);
    state = apply(state, 1, { type: 'setzeWort', wort: 'Qualm', hinweis: '' });
    expect(game.activeSeats(state)).toEqual([2]);
    const wrong = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
    for (const b of wrong) {
      const seat = game.activeSeats(state)[0] as number;
      expect(seat).not.toBe(1);
      state = apply(state, seat, { type: 'buchstabe', b });
    }
    expect(state.scores[1]).toBe(24);
    expect(state.round).toBe(2);

    state = apply(state, 2, { type: 'setzeWort', wort: 'Eis', hinweis: '' });
    state = apply(state, 0, { type: 'loesung', wort: 'eis' });
    expect(state.over).toBe(true);
    const out = game.outcome(state);
    expect(out?.scores).toEqual(state.scores);
    expect(out?.winners.length).toBeGreaterThan(0);
    expect(game.activeSeats(state)).toEqual([]);
  });

  it('parseMove und parseOptions lehnen Unfug ab', () => {
    expect(game.parseMove({ type: 'buchstabe', b: 'AB' })).toBeNull();
    expect(game.parseMove({ type: 'buchstabe', b: '1' })).toBeNull();
    expect(game.parseMove({ type: 'buchstabe', b: 3 })).toBeNull();
    expect(game.parseMove({ type: 'setzeWort', wort: 'x'.repeat(61) })).toBeNull();
    expect(game.parseMove({ type: 'setzeWort', wort: 'Haus', hinweis: 'x'.repeat(61) })).toBeNull();
    expect(game.parseMove({ type: 'loesung' })).toBeNull();
    expect(game.parseMove('buchstabe')).toBeNull();
    expect(game.parseMove({ type: 'buchstabe', b: 'ß' })).toEqual({ type: 'buchstabe', b: 'ß' });
    expect(game.parseMove({ type: 'buchstabe', b: 'ä' })).toEqual({ type: 'buchstabe', b: 'Ä' });
    expect(game.parseOptions({ kategorie: 'gibtsnicht' })).toBeNull();
    expect(game.parseOptions({ kategorie: 'tiere' })).toEqual({ kategorie: 'tiere' });
    expect(game.parseOptions(undefined)).toEqual({ kategorie: 'alle' });
  });

  it('eine Partie zu sechst endet nach sechs Runden', () => {
    let state = game.setup({ players: 6, seed: 3, options: { kategorie: 'alle' } });
    for (let guard = 0; guard < 500 && !state.over; guard += 1) {
      const seat = game.activeSeats(state)[0] as number;
      if (state.phase === 'wort') {
        state = apply(state, seat, { type: 'setzeWort', wort: 'Kater', hinweis: 'Tier' });
      } else {
        const next = GALGEN_ALPHABET.find(
          (c) => !state.guessed.includes(c) && !state.wrongLetters.includes(c),
        );
        state = apply(state, seat, { type: 'buchstabe', b: next as string });
      }
    }
    expect(state.over).toBe(true);
    expect(state.results).toHaveLength(6);
  });
});
