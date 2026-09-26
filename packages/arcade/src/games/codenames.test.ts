import { describe, expect, it } from 'vitest';
import { applyRawMove, createMatch, type SeatController } from '../turn.js';
import { CODENAMES_KATEGORIEN } from './codenames-woerter.js';
import {
  type CnMove,
  type CnState,
  autoTeams,
  game,
  hinweisFehler,
  normalisiere,
} from './codenames.js';

const menschen = (n: number): SeatController[] =>
  Array.from({ length: n }, () => ({ type: 'human' }));

function apply(state: CnState, seat: number, move: CnMove): CnState {
  const result = game.applyMove(state, seat, move);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

/** Ein Hinweis, der garantiert keinen der Begriffe trifft. */
const HINWEIS = 'Qxyzabc';

describe('Codenames – Wortliste', () => {
  it('hat mindestens 400 eindeutige, einzelne Wörter und volle Kategorien', () => {
    const alle = CODENAMES_KATEGORIEN.flatMap((k) => [...k.woerter]);
    expect(alle.length).toBeGreaterThanOrEqual(400);
    expect(new Set(alle.map(normalisiere)).size).toBe(alle.length);
    for (const w of alle) {
      expect(w).toMatch(/^[A-ZÄÖÜ][\p{L}]+$/u);
      expect(w.length).toBeGreaterThanOrEqual(3);
    }
    for (const k of CODENAMES_KATEGORIEN) expect(k.woerter.length).toBeGreaterThanOrEqual(25);
  });
});

describe('Codenames – Aufbau', () => {
  it('verteilt 9/8/7/1 und nimmt 25 verschiedene Begriffe', () => {
    const s = game.setup({ players: 4, seed: 42, options: game.defaultOptions });
    expect(s.woerter).toHaveLength(25);
    expect(new Set(s.woerter).size).toBe(25);
    const zahl = (f: string) => s.schluessel.filter((x) => x === f).length;
    expect(zahl(s.startTeam)).toBe(9);
    expect(zahl(s.startTeam === 'rot' ? 'blau' : 'rot')).toBe(8);
    expect(zahl('passant')).toBe(7);
    expect(zahl('attentaeter')).toBe(1);
    expect(s.modus).toBe('teams');
  });

  it('ist deterministisch und nutzt die Kategorie', () => {
    const a = game.setup({ players: 6, seed: 7, options: { teams: null, kategorie: 'natur' } });
    const b = game.setup({ players: 6, seed: 7, options: { teams: null, kategorie: 'natur' } });
    expect(a).toEqual(b);
    const natur = CODENAMES_KATEGORIEN.find((k) => k.id === 'natur')?.woerter ?? [];
    for (const w of a.woerter) expect(natur).toContain(w);
  });

  it('setzt Teams automatisch abwechselnd, erster Sitz eines Teams ist Chef', () => {
    expect(autoTeams(5)).toEqual([
      { team: 'rot', rolle: 'chef' },
      { team: 'blau', rolle: 'chef' },
      { team: 'rot', rolle: 'agent' },
      { team: 'blau', rolle: 'agent' },
      { team: 'rot', rolle: 'agent' },
    ]);
    expect(autoTeams(2)).toEqual([
      { team: 'rot', rolle: 'chef' },
      { team: 'rot', rolle: 'agent' },
    ]);
  });
});

describe('Codenames – Einstellungen', () => {
  it('prüft Teams streng', () => {
    expect(game.parseOptions(undefined)).toEqual(game.defaultOptions);
    expect(game.parseOptions({ kategorie: 'quatsch' })).toBeNull();
    expect(game.parseOptions('x')).toBeNull();
    // Blau ohne Chef.
    expect(
      game.parseOptions({
        teams: [
          { team: 'rot', rolle: 'chef' },
          { team: 'rot', rolle: 'agent' },
          { team: 'blau', rolle: 'agent' },
          { team: 'blau', rolle: 'agent' },
        ],
      }),
    ).toBeNull();
    // Rot ohne Agent.
    expect(
      game.parseOptions({
        teams: [
          { team: 'rot', rolle: 'chef' },
          { team: 'blau', rolle: 'chef' },
          { team: 'blau', rolle: 'agent' },
          { team: 'blau', rolle: 'agent' },
        ],
      }),
    ).toBeNull();
    expect(
      game.parseOptions({
        teams: [
          { team: 'rot', rolle: 'boss' },
          { team: 'rot', rolle: 'agent' },
        ],
      }),
    ).toBeNull();
    const ok = game.parseOptions({
      teams: [
        { team: 'blau', rolle: 'agent' },
        { team: 'rot', rolle: 'agent' },
        { team: 'blau', rolle: 'chef' },
        { team: 'rot', rolle: 'chef' },
      ],
      kategorie: 'orte',
    });
    expect(ok?.teams?.[2]).toEqual({ team: 'blau', rolle: 'chef' });
    const s = game.setup({ players: 4, seed: 1, options: ok ?? game.defaultOptions });
    expect(s.sitze[3]).toEqual({ team: 'rot', rolle: 'chef' });
  });

  it('Koop: genau ein Chef', () => {
    expect(
      game.parseOptions({
        teams: [
          { team: 'rot', rolle: 'agent' },
          { team: 'blau', rolle: 'agent' },
        ],
      }),
    ).toBeNull();
    const ok = game.parseOptions({
      teams: [
        { team: 'rot', rolle: 'agent' },
        { team: 'blau', rolle: 'chef' },
        { team: 'blau', rolle: 'agent' },
      ],
    });
    expect(ok?.teams?.every((s) => s.team === 'rot')).toBe(true);
  });
});

describe('Codenames – Züge', () => {
  it('parseMove lehnt Unfug ab', () => {
    for (const raw of [
      null,
      1,
      'tipp',
      { typ: 'tipp' },
      { typ: 'tipp', feld: 25 },
      { typ: 'tipp', feld: -1 },
      { typ: 'tipp', feld: 1.5 },
      { typ: 'hinweis', wort: '', anzahl: 1 },
      { typ: 'hinweis', wort: 'x'.repeat(31), anzahl: 1 },
      { typ: 'hinweis', wort: 'Hund', anzahl: 10 },
      { typ: 'hinweis', wort: 'Hund', anzahl: 'viele' },
      { typ: 'hinweis', wort: 42, anzahl: 1 },
      { typ: 'sprengen' },
    ]) {
      expect(game.parseMove(raw)).toBeNull();
    }
    expect(game.parseMove({ typ: 'hinweis', wort: ' Hund ', anzahl: 'unbegrenzt' })).toEqual({
      typ: 'hinweis',
      wort: 'Hund',
      anzahl: 'unbegrenzt',
    });
  });

  it('prüft Hinweise gegen sichtbare Begriffe, auch mit Umlauten', () => {
    expect(hinweisFehler('Zwei Worte', ['Hund'])).toMatch(/einziges Wort/);
    expect(hinweisFehler('a', ['Hund'])).toMatch(/2 bis 30/);
    expect(hinweisFehler('Hund7', [])).toMatch(/Buchstaben/);
    expect(hinweisFehler('hund', ['Hund'])).toMatch(/liegt selbst/);
    expect(hinweisFehler('Hundehütte', ['Hund'])).toMatch(/enthält/);
    expect(hinweisFehler('Ball', ['Fußball'])).toMatch(/steckt in/);
    expect(hinweisFehler('LOEWENZAHN', ['Löwe'])).toMatch(/enthält/);
    expect(hinweisFehler('Strasse', ['Straße'])).toMatch(/liegt selbst/);
    expect(hinweisFehler('Meer', ['Löwe', 'Hund'])).toBeNull();
  });

  it('nur der Chef am Zug gibt Hinweise, nur seine Agenten raten', () => {
    let s = game.setup({ players: 4, seed: 3, options: game.defaultOptions });
    const chef = s.sitze.findIndex((x) => x.rolle === 'chef' && x.team === s.amZug);
    const agent = s.sitze.findIndex((x) => x.rolle === 'agent' && x.team === s.amZug);
    const fremderChef = s.sitze.findIndex((x) => x.rolle === 'chef' && x.team !== s.amZug);
    expect(game.activeSeats(s)).toEqual([chef]);
    expect(game.applyMove(s, fremderChef, { typ: 'hinweis', wort: HINWEIS, anzahl: 1 }).ok).toBe(
      false,
    );
    expect(game.applyMove(s, agent, { typ: 'hinweis', wort: HINWEIS, anzahl: 1 }).ok).toBe(false);
    expect(game.applyMove(s, chef, { typ: 'tipp', feld: 0 }).ok).toBe(false);
    const sichtbar = s.woerter[0] ?? '';
    expect(game.applyMove(s, chef, { typ: 'hinweis', wort: sichtbar, anzahl: 1 }).ok).toBe(false);
    const vorher = JSON.stringify(s);
    s = apply(s, chef, { typ: 'hinweis', wort: HINWEIS, anzahl: 1 });
    expect(JSON.stringify(game.setup({ players: 4, seed: 3, options: game.defaultOptions }))).toBe(
      vorher,
    );
    expect(game.activeSeats(s)).toEqual([agent]);
    expect(s.tippsUebrig).toBe(2);
  });

  it('eigene Treffer erlauben anzahl+1 Tipps, dann wechselt das Team', () => {
    let s = game.setup({ players: 4, seed: 11, options: game.defaultOptions });
    const team = s.amZug;
    const chef = s.sitze.findIndex((x) => x.rolle === 'chef' && x.team === team);
    const agent = s.sitze.findIndex((x) => x.rolle === 'agent' && x.team === team);
    const eigene = s.schluessel.flatMap((f, i) => (f === team ? [i] : []));
    s = apply(s, chef, { typ: 'hinweis', wort: HINWEIS, anzahl: 1 });
    s = apply(s, agent, { typ: 'tipp', feld: eigene[0] as number });
    expect(s.amZug).toBe(team);
    expect(game.applyMove(s, agent, { typ: 'tipp', feld: eigene[0] as number }).ok).toBe(false);
    s = apply(s, agent, { typ: 'tipp', feld: eigene[1] as number });
    expect(s.amZug).not.toBe(team);
    expect(s.phase).toBe('hinweis');
  });

  it('ein Passant beendet den Zug, Passen auch', () => {
    let s = game.setup({ players: 4, seed: 12, options: game.defaultOptions });
    const team = s.amZug;
    const chef = s.sitze.findIndex((x) => x.rolle === 'chef' && x.team === team);
    const agent = s.sitze.findIndex((x) => x.rolle === 'agent' && x.team === team);
    s = apply(s, chef, { typ: 'hinweis', wort: HINWEIS, anzahl: 'unbegrenzt' });
    expect(s.tippsUebrig).toBeNull();
    s = apply(s, agent, { typ: 'tipp', feld: s.schluessel.indexOf('passant') });
    expect(s.amZug).not.toBe(team);
    const chef2 = s.sitze.findIndex((x) => x.rolle === 'chef' && x.team === s.amZug);
    const agent2 = s.sitze.findIndex((x) => x.rolle === 'agent' && x.team === s.amZug);
    s = apply(s, chef2, { typ: 'hinweis', wort: HINWEIS, anzahl: 0 });
    s = apply(s, agent2, { typ: 'passen' });
    expect(s.amZug).toBe(team);
  });

  it('der Attentäter entscheidet sofort gegen das ratende Team', () => {
    let s = game.setup({ players: 5, seed: 5, options: game.defaultOptions });
    const team = s.amZug;
    const chef = s.sitze.findIndex((x) => x.rolle === 'chef' && x.team === team);
    const agent = s.sitze.findIndex((x) => x.rolle === 'agent' && x.team === team);
    s = apply(s, chef, { typ: 'hinweis', wort: HINWEIS, anzahl: 3 });
    s = apply(s, agent, { typ: 'tipp', feld: s.schluessel.indexOf('attentaeter') });
    const out = game.outcome(s);
    expect(out).not.toBeNull();
    const gegner = s.sitze.flatMap((x, i) => (x.team !== team ? [i] : []));
    expect(out?.winners).toEqual(gegner);
    expect(game.activeSeats(s)).toEqual([]);
  });
});

describe('Codenames – verdeckte Information', () => {
  it('Agenten und Zuschauer sehen den Schlüssel nicht, Chefs schon', () => {
    const s = game.setup({ players: 4, seed: 9, options: game.defaultOptions });
    const agent = s.sitze.findIndex((x) => x.rolle === 'agent');
    const chef = s.sitze.findIndex((x) => x.rolle === 'chef');
    for (const seat of [agent, null]) {
      const v = game.view(s, seat);
      expect(v.schluesselSichtbar).toBe(false);
      expect(v.karten.every((k) => k.farbe === null)).toBe(true);
      const json = JSON.stringify(v);
      expect(json).not.toContain('attentaeter');
      expect(json).not.toContain('passant');
      expect(json).not.toContain('"rng"');
    }
    const cv = game.view(s, chef);
    expect(cv.karten.map((k) => k.farbe)).toEqual(s.schluessel);
  });

  it('aufgedeckte Karten zeigen allen ihre Farbe', () => {
    let s = game.setup({ players: 4, seed: 9, options: game.defaultOptions });
    const chef = s.sitze.findIndex((x) => x.rolle === 'chef' && x.team === s.amZug);
    const agent = s.sitze.findIndex((x) => x.rolle === 'agent' && x.team === s.amZug);
    s = apply(s, chef, { typ: 'hinweis', wort: HINWEIS, anzahl: 1 });
    const feld = s.schluessel.indexOf('passant');
    s = apply(s, agent, { typ: 'tipp', feld });
    const v = game.view(s, agent);
    expect(v.karten[feld]?.farbe).toBe('passant');
    expect(v.karten.filter((k) => k.farbe !== null)).toHaveLength(1);
  });
});

describe('Codenames – ganze Partien', () => {
  it('Teams: geskriptete Partie über applyRawMove bis zum Sieg', () => {
    let match = createMatch(game, 2024, game.defaultOptions, menschen(6));
    let guard = 0;
    while (!game.outcome(match.state) && guard < 200) {
      guard += 1;
      const s = match.state;
      const seat = game.activeSeats(s)[0] as number;
      let move: unknown;
      if (s.phase === 'hinweis') move = { typ: 'hinweis', wort: HINWEIS, anzahl: 2 };
      else {
        // Die Agenten „raten" perfekt, jeder zweite Zug endet mit einem Passanten.
        const eigene = s.schluessel.findIndex((f, i) => f === s.amZug && s.aufgedeckt[i] === null);
        const passant = s.schluessel.findIndex(
          (f, i) => f === 'passant' && s.aufgedeckt[i] === null,
        );
        move =
          s.tippsInZug === 1 && passant >= 0 && guard % 4 === 0
            ? { typ: 'tipp', feld: passant }
            : { typ: 'tipp', feld: eigene };
      }
      const r = applyRawMove(game, match, seat, move);
      if (!r.ok) throw new Error(r.error);
      match = r.state;
    }
    const out = game.outcome(match.state);
    expect(out).not.toBeNull();
    expect(out?.winners.length).toBe(3);
    expect(game.view(match.state, 2).schluesselSichtbar).toBe(true);
    expect(game.log(match.state).length).toBeGreaterThan(3);
  });

  it('Koop mit zwei Sitzen: gewinnen alle', () => {
    let match = createMatch(game, 99, game.defaultOptions, menschen(2));
    expect(match.state.modus).toBe('koop');
    let guard = 0;
    while (!game.outcome(match.state) && guard < 100) {
      guard += 1;
      const s = match.state;
      const seat = game.activeSeats(s)[0] as number;
      const eigene = s.schluessel.findIndex((f, i) => f === 'rot' && s.aufgedeckt[i] === null);
      const move =
        s.phase === 'hinweis'
          ? { typ: 'hinweis', wort: HINWEIS, anzahl: 'unbegrenzt' }
          : { typ: 'tipp', feld: eigene };
      const r = applyRawMove(game, match, seat, move);
      if (!r.ok) throw new Error(r.error);
      match = r.state;
    }
    expect(game.outcome(match.state)?.winners).toEqual([0, 1]);
  });

  it('Koop mit drei Sitzen: die Uhr läuft nach neun Runden ab', () => {
    let match = createMatch(game, 5, game.defaultOptions, menschen(3));
    expect(game.activeSeats(match.state)).toEqual([0]);
    let runden = 0;
    while (!game.outcome(match.state)) {
      const r1 = applyRawMove(game, match, 0, { typ: 'hinweis', wort: HINWEIS, anzahl: 1 });
      if (!r1.ok) throw new Error(r1.error);
      expect(game.activeSeats(r1.state.state)).toEqual([1, 2]);
      const r2 = applyRawMove(game, r1.state, 2, { typ: 'passen' });
      if (!r2.ok) throw new Error(r2.error);
      match = r2.state;
      runden += 1;
    }
    expect(runden).toBe(9);
    const out = game.outcome(match.state);
    expect(out?.winners).toEqual([]);
    // Jede Runde deckt die Uhr einen Gegner-Begriff auf, bis alle acht weg sind.
    const uhr = match.state.aufgedeckt.filter((v) => v === -1).length;
    expect(uhr).toBe(8);
  });

  it('Koop: Attentäter heißt verloren', () => {
    let s = game.setup({ players: 2, seed: 1, options: game.defaultOptions });
    s = apply(s, 0, { typ: 'hinweis', wort: HINWEIS, anzahl: 1 });
    s = apply(s, 1, { typ: 'tipp', feld: s.schluessel.indexOf('attentaeter') });
    expect(game.outcome(s)?.winners).toEqual([]);
  });
});
