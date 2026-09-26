import { describe, expect, it } from 'vitest';
import { applyRawMove, createMatch, type SeatController } from '../turn.js';
import { BLACK_STORIES } from './black-stories-raetsel.js';
import {
  type BsMove,
  type BsState,
  BS_FRAGEN_FUER_MEISTER,
  game,
  meisterVon,
} from './black-stories.js';

const menschen = (n: number): SeatController[] =>
  Array.from({ length: n }, () => ({ type: 'human' }));

function apply(state: BsState, seat: number, move: BsMove): BsState {
  const result = game.applyMove(state, seat, move);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function neu(players = 3, runden: number | null = null): BsState {
  return game.setup({ players, seed: 17, options: { runden } });
}

describe('Black Stories – Rätselsammlung', () => {
  it('hat mindestens 60 vollständige, eindeutige Rätsel', () => {
    expect(BLACK_STORIES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(BLACK_STORIES.map((r) => r.id)).size).toBe(BLACK_STORIES.length);
    expect(new Set(BLACK_STORIES.map((r) => r.titel)).size).toBe(BLACK_STORIES.length);
    for (const r of BLACK_STORIES) {
      expect(r.titel.length).toBeGreaterThan(2);
      expect(r.text.length).toBeGreaterThan(20);
      expect(r.loesung.length).toBeGreaterThan(r.text.length);
      expect([1, 2, 3]).toContain(r.stufe);
    }
    for (const stufe of [1, 2, 3]) expect(BLACK_STORIES.some((r) => r.stufe === stufe)).toBe(true);
  });
});

describe('Black Stories – Einstellungen und Züge', () => {
  it('parseOptions prüft die Rundenzahl', () => {
    expect(game.parseOptions(undefined)).toEqual({ runden: null });
    expect(game.parseOptions({ runden: 4 })).toEqual({ runden: 4 });
    expect(game.parseOptions({ runden: 0 })).toBeNull();
    expect(game.parseOptions({ runden: 21 })).toBeNull();
    expect(game.parseOptions({ runden: 'drei' })).toBeNull();
    expect(game.parseOptions([])).toBeNull();
    expect(neu(4).runden).toBe(4);
    expect(neu(4, 2).runden).toBe(2);
  });

  it('parseMove lehnt Unfug ab', () => {
    for (const raw of [
      null,
      'frage',
      { typ: 'frage' },
      { typ: 'frage', text: '' },
      { typ: 'frage', text: '   ' },
      { typ: 'frage', text: 'x'.repeat(201) },
      { typ: 'loesung', text: 'x'.repeat(301) },
      { typ: 'antwort', frage: 1, antwort: 'vielleicht' },
      { typ: 'antwort', frage: 'eins', antwort: 'ja' },
      { typ: 'bewerte', versuch: 1, urteil: 'super' },
      { typ: 'geloest', sitz: 10 },
      { typ: 'waehle', raetsel: 'zufall' },
      { typ: 'waehle', raetsel: 0 },
      { typ: 'muendlich', antwort: 'jein' },
      { typ: 'schummeln' },
    ]) {
      expect(game.parseMove(raw)).toBeNull();
    }
    expect(game.parseMove({ typ: 'frage', text: ' Ist er ertrunken? ' })).toEqual({
      typ: 'frage',
      text: 'Ist er ertrunken?',
    });
    expect(game.parseMove({ typ: 'waehle', raetsel: null })).toEqual({
      typ: 'waehle',
      raetsel: null,
    });
  });

  it('nur der Meister wählt, antwortet und bewertet; Rater fragen', () => {
    let s = neu(3);
    expect(game.activeSeats(s)).toEqual([0]);
    expect(game.applyMove(s, 1, { typ: 'waehle', raetsel: 1 }).ok).toBe(false);
    expect(game.applyMove(s, 0, { typ: 'frage', text: 'Hallo?' }).ok).toBe(false);
    expect(game.applyMove(s, 0, { typ: 'waehle', raetsel: 99_999 }).ok).toBe(false);
    s = apply(s, 0, { typ: 'waehle', raetsel: 5 });
    expect(s.raetsel).toBe(5);
    expect(game.activeSeats(s)).toEqual([0, 1, 2]);
    expect(game.applyMove(s, 0, { typ: 'frage', text: 'Ich frage mich selbst' }).ok).toBe(false);
    s = apply(s, 1, { typ: 'frage', text: 'Ist jemand gestorben?' });
    expect(game.applyMove(s, 2, { typ: 'antwort', frage: 1, antwort: 'ja' }).ok).toBe(false);
    s = apply(s, 0, { typ: 'antwort', frage: 1, antwort: 'nein' });
    expect(game.applyMove(s, 0, { typ: 'antwort', frage: 1, antwort: 'ja' }).ok).toBe(false);
    expect(s.fragen[0]?.antwort).toBe('nein');
  });

  it('höchstens drei offene Fragen und ein offener Versuch je Rater', () => {
    let s = apply(neu(2), 0, { typ: 'waehle', raetsel: null });
    for (let i = 0; i < 3; i += 1) s = apply(s, 1, { typ: 'frage', text: `Frage ${i}` });
    expect(game.applyMove(s, 1, { typ: 'frage', text: 'Noch eine' }).ok).toBe(false);
    s = apply(s, 1, { typ: 'loesung', text: 'Es war der Gärtner.' });
    expect(game.applyMove(s, 1, { typ: 'loesung', text: 'Oder doch der Butler?' }).ok).toBe(false);
    // Blockiert in beidem – dann ist der Rater gerade nicht aktiv.
    expect(game.activeSeats(s)).toEqual([0]);
    s = apply(s, 0, { typ: 'bewerte', versuch: s.versuche[0]?.id ?? 0, urteil: 'fast' });
    expect(game.activeSeats(s)).toEqual([0, 1]);
    expect(s.phase).toBe('raten');
  });

  it('eine Wahl ist nur einmal pro Partie möglich', () => {
    let s = neu(2);
    s = apply(s, 0, { typ: 'waehle', raetsel: 7 });
    s = apply(s, 0, { typ: 'aufloesen' });
    expect(game.applyMove(s, 1, { typ: 'waehle', raetsel: 7 }).ok).toBe(false);
  });
});

describe('Black Stories – Punkte', () => {
  it('richtige Lösung: Punkt für den Rater, Meister geht leer aus', () => {
    let s = apply(neu(3), 0, { typ: 'waehle', raetsel: 1 });
    s = apply(s, 2, { typ: 'loesung', text: 'Seine eigene Beerdigung.' });
    s = apply(s, 0, { typ: 'bewerte', versuch: s.versuche[0]?.id ?? 0, urteil: 'richtig' });
    expect(s.punkte).toEqual([0, 0, 1]);
    expect(s.phase).toBe('waehlen');
    expect(meisterVon(s)).toBe(1);
  });

  it('nach 20 Fragen punktet auch der Meister, mündliche Fragen zählen mit', () => {
    let s = apply(neu(3), 0, { typ: 'waehle', raetsel: 2 });
    for (let i = 0; i < BS_FRAGEN_FUER_MEISTER - 1; i += 1)
      s = apply(s, 0, { typ: 'muendlich', antwort: 'nein' });
    s = apply(s, 1, { typ: 'frage', text: 'Geht es um Geld?' });
    s = apply(s, 0, { typ: 'antwort', frage: s.fragen[0]?.id ?? 0, antwort: 'ja' });
    expect(game.view(s, 1).fragenGesamt).toBe(20);
    s = apply(s, 0, { typ: 'geloest', sitz: 1 });
    expect(s.punkte).toEqual([1, 1, 0]);
  });

  it('Auflösen gibt dem Meister einen Punkt, geloest prüft den Sitz', () => {
    let s = apply(neu(2), 0, { typ: 'waehle', raetsel: 3 });
    expect(game.applyMove(s, 0, { typ: 'geloest', sitz: 0 }).ok).toBe(false);
    expect(game.applyMove(s, 1, { typ: 'aufloesen' }).ok).toBe(false);
    s = apply(s, 0, { typ: 'aufloesen' });
    expect(s.punkte).toEqual([1, 0]);
  });
});

describe('Black Stories – verdeckte Information', () => {
  it('die Lösung sieht nur der Meister – bis die Runde vorbei ist', () => {
    let s = apply(neu(3), 0, { typ: 'waehle', raetsel: 13 });
    const loesung = BLACK_STORIES.find((r) => r.id === 13)?.loesung ?? '';
    expect(game.view(s, 0).loesung).toBe(loesung);
    for (const seat of [1, 2, null]) {
      const v = game.view(s, seat);
      expect(v.loesung).toBeNull();
      expect(v.auswahl).toBeNull();
      expect(JSON.stringify(v)).not.toContain(loesung.slice(0, 40));
      expect(JSON.stringify(v)).not.toContain('"rng"');
    }
    expect(JSON.stringify(game.log(s))).not.toContain(loesung.slice(0, 40));
    s = apply(s, 0, { typ: 'aufloesen' });
    expect(game.view(s, 2).letzte?.loesung).toBe(loesung);
  });

  it('die Auswahl des Meisters enthält keine Lösungen', () => {
    const v = game.view(neu(3), 0);
    expect(v.auswahl?.length).toBe(BLACK_STORIES.length);
    expect(JSON.stringify(v)).not.toContain(BLACK_STORIES[0]?.loesung.slice(0, 40) ?? '###');
  });
});

describe('Black Stories – ganze Partie', () => {
  it('geskriptete Partie mit vier Sitzen bis zum Ende', () => {
    let match = createMatch(game, 321, game.defaultOptions, menschen(4));
    const zug = (seat: number, move: unknown) => {
      const r = applyRawMove(game, match, seat, move);
      if (!r.ok) throw new Error(r.error);
      match = r.state;
    };
    for (let runde = 0; runde < 4; runde += 1) {
      const meister = meisterVon(match.state);
      expect(meister).toBe(runde);
      zug(meister, { typ: 'waehle', raetsel: null });
      const rater = [0, 1, 2, 3].filter((s) => s !== meister);
      for (const s of rater) zug(s, { typ: 'frage', text: `Frage von ${s}` });
      for (const f of match.state.fragen)
        zug(meister, { typ: 'antwort', frage: f.id, antwort: 'irrelevant' });
      if (runde === 3) {
        zug(meister, { typ: 'aufloesen' });
      } else {
        const loeser = rater[runde % rater.length] as number;
        zug(loeser, { typ: 'loesung', text: 'So war es!' });
        zug(meister, {
          typ: 'bewerte',
          versuch: match.state.versuche[0]?.id ?? 0,
          urteil: 'richtig',
        });
      }
    }
    const out = game.outcome(match.state);
    expect(out).not.toBeNull();
    expect(out?.scores?.reduce((a, b) => a + b, 0)).toBe(4);
    expect(game.activeSeats(match.state)).toEqual([]);
    expect(new Set(match.state.benutzt).size).toBe(4);
    expect(applyRawMove(game, match, 0, { typ: 'aufloesen' }).ok).toBe(false);
  });
});
