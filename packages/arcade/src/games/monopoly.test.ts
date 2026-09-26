import { describe, expect, it } from 'vitest';
import { rollDie } from '../rng.js';
import { createMatch, runBots, stepBot, type BotLevel, type SeatController } from '../turn.js';
import { game, type MonopolyZustand, type MonopolyZug } from './monopoly.js';
import { kannBauen, kannHypothek, miete, abloeseBetrag } from './monopoly-kern.js';

function neu(
  players = 2,
  options: Partial<MonopolyZustand['optionen']> = {},
  seed = 7,
): MonopolyZustand {
  return game.setup({ players, seed, options: { ...game.defaultOptions, ...options } });
}

function zug(s: MonopolyZustand, seat: number, m: MonopolyZug): MonopolyZustand {
  const r = game.applyMove(s, seat, m);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** Augensumme des nächsten Wurfs, ohne den Zufall weiterzudrehen. */
function naechsterWurf(s: MonopolyZustand): [number, number] {
  const r = { ...s.rng };
  return [rollDie(r), rollDie(r)];
}

/** Stellt Sitz `seat` so hin, dass der nächste Wurf auf `ziel` endet (ohne Pasch-Sonderfälle). */
function stelleVor(s: MonopolyZustand, seat: number, ziel: number): number {
  const [a, b] = naechsterWurf(s);
  const p = s.spieler[seat]!;
  p.pos = (ziel - (a + b) + 40) % 40;
  return a + b;
}

describe('monopoly – Optionen und fremde Daten', () => {
  it('füllt Vorgaben auf und lehnt Unfug ab', () => {
    expect(game.parseOptions({})).toEqual(game.defaultOptions);
    expect(game.parseOptions({ startgeld: 2000, rundenlimit: 0 })?.startgeld).toBe(2000);
    expect(game.parseOptions({ startgeld: 1234 })).toBeNull();
    expect(game.parseOptions({ rundenlimit: 25 })).toBeNull();
    expect(game.parseOptions({ versteigerung: 'ja' })).toBeNull();
    expect(game.parseOptions('x')).toBeNull();
  });

  it('parseMove prüft Form und Wertebereiche', () => {
    expect(game.parseMove({ type: 'wuerfeln' })).toEqual({ type: 'wuerfeln' });
    expect(game.parseMove({ type: 'bauen', feld: 39 })).toEqual({ type: 'bauen', feld: 39 });
    expect(game.parseMove({ type: 'bauen', feld: 40 })).toBeNull();
    expect(game.parseMove({ type: 'bauen', feld: 1.5 })).toBeNull();
    expect(game.parseMove({ type: 'bieten', betrag: -5 })).toBeNull();
    expect(game.parseMove({ type: 'foo' })).toBeNull();
    expect(game.parseMove(null)).toBeNull();
    expect(game.parseMove([1, 2])).toBeNull();
    const handel = {
      type: 'handel',
      an: 1,
      gebeFelder: [1, 1],
      nehmeFelder: [],
      gebeGeld: 0,
      nehmeGeld: 0,
      gebeKarten: 0,
      nehmeKarten: 0,
    };
    expect(game.parseMove(handel)).toBeNull();
    expect(game.parseMove({ ...handel, gebeFelder: [1] })).not.toBeNull();
    expect(game.parseMove({ ...handel, gebeFelder: [1], nehmeKarten: 5 })).toBeNull();
    expect(game.parseMove({ ...handel, gebeFelder: 'alles' })).toBeNull();
  });

  it('die Sicht verrät die Reihenfolge der Kartenstapel nicht', () => {
    const s = neu(3);
    const v = game.view(s, 0) as unknown as Record<string, unknown>;
    expect(JSON.stringify(v)).not.toContain('stapel":{');
    expect(v).not.toHaveProperty('rng');
    expect(v).not.toHaveProperty('stapel');
  });
});

describe('monopoly – Kaufen, Miete, Versteigerung', () => {
  it('kauft ein Grundstück und zahlt Miete (Farbgruppe doppelt)', () => {
    let s = neu(2, { versteigerung: false });
    // Von hinten kommend geht es über Los (+200).
    stelleVor(s, 0, 1);
    s = zug(s, 0, { type: 'wuerfeln' });
    expect(s.phase).toBe('kaufen');
    expect(s.kaufFeld).toBe(1);
    s = zug(s, 0, { type: 'kaufen' });
    expect(s.besitzer[1]).toBe(0);
    expect(s.spieler[0]!.geld).toBe(1500 + 200 - 60);
    expect(miete(s, 1, 7)).toBe(2);
    s.besitzer[3] = 0;
    expect(miete(s, 1, 7)).toBe(4);
    s.haeuser[3] = 5;
    expect(miete(s, 3, 7)).toBe(450);

    // Sitz 1 landet auf der Badstraße und zahlt die doppelte Miete.
    s.phase = 'wuerfeln';
    s.am = 1;
    s.paschNochmal = false;
    stelleVor(s, 1, 1);
    const vorher = s.spieler[1]!.geld;
    s = zug(s, 1, { type: 'wuerfeln' });
    expect(s.spieler[1]!.geld).toBe(vorher + 200 - 4);
    expect(s.spieler[0]!.geld).toBe(1500 + 200 - 60 + 4);
  });

  it('Bahnhöfe und Werke', () => {
    const s = neu(2);
    s.besitzer[5] = 1;
    expect(miete(s, 5, 7)).toBe(25);
    s.besitzer[15] = 1;
    s.besitzer[25] = 1;
    expect(miete(s, 5, 7)).toBe(100);
    expect(miete(s, 5, 7, { bahnhofDoppelt: true })).toBe(200);
    s.besitzer[12] = 1;
    expect(miete(s, 12, 8)).toBe(32);
    s.besitzer[28] = 1;
    expect(miete(s, 12, 8)).toBe(80);
    s.hypothek[12] = true;
    expect(miete(s, 12, 8)).toBe(0);
  });

  it('versteigert ein abgelehntes Grundstück', () => {
    let s = neu(3);
    stelleVor(s, 0, 1);
    s = zug(s, 0, { type: 'wuerfeln' });
    s = zug(s, 0, { type: 'ablehnen' });
    expect(s.phase).toBe('versteigerung');
    expect(game.activeSeats(s)).toEqual([1]);
    expect(game.applyMove(s, 1, { type: 'bieten', betrag: 5 }).ok).toBe(false);
    s = zug(s, 1, { type: 'bieten', betrag: 20 });
    expect(game.activeSeats(s)).toEqual([2]);
    s = zug(s, 2, { type: 'bieten', betrag: 40 });
    s = zug(s, 0, { type: 'passen' });
    s = zug(s, 1, { type: 'passen' });
    expect(s.phase).not.toBe('versteigerung');
    expect(s.besitzer[1]).toBe(2);
    expect(s.spieler[2]!.geld).toBe(1460);
  });
});

describe('monopoly – Bauen und Hypotheken', () => {
  it('baut nur mit ganzer Gruppe und gleichmäßig', () => {
    let s = neu(2);
    s.besitzer[1] = 0;
    expect(kannBauen(s, 0, 1)).not.toBeNull();
    s.besitzer[3] = 0;
    expect(kannBauen(s, 0, 1)).toBeNull();
    s = zug(s, 0, { type: 'bauen', feld: 1 });
    expect(s.haeuser[1]).toBe(1);
    expect(s.bankHaeuser).toBe(31);
    expect(game.applyMove(s, 0, { type: 'bauen', feld: 1 }).ok).toBe(false);
    s = zug(s, 0, { type: 'bauen', feld: 3 });
    // Hypothek geht nicht, solange die Gruppe bebaut ist.
    expect(kannHypothek(s, 0, 1)).not.toBeNull();
    expect(game.applyMove(s, 0, { type: 'verkaufen', feld: 1 }).ok).toBe(true);
    // Bis zum Hotel: vier Häuser gehen zurück an die Bank.
    for (let i = 0; i < 6; i += 1) s = zug(s, 0, { type: 'bauen', feld: i % 2 === 0 ? 1 : 3 });
    expect(s.haeuser[1]).toBe(4);
    s = zug(s, 0, { type: 'bauen', feld: 1 });
    expect(s.haeuser[1]).toBe(5);
    expect(s.bankHotels).toBe(11);
    expect(s.bankHaeuser).toBe(32 - 4);
  });

  it('beachtet den Häuservorrat der Bank', () => {
    const s = neu(2);
    s.besitzer[1] = 0;
    s.besitzer[3] = 0;
    s.bankHaeuser = 0;
    expect(kannBauen(s, 0, 1)).toMatch(/keine Häuser/);
  });

  it('Hypothek bringt den halben Preis, Ablösen kostet 10 % mehr', () => {
    let s = neu(2);
    s.besitzer[1] = 0;
    s = zug(s, 0, { type: 'hypothek', feld: 1 });
    expect(s.spieler[0]!.geld).toBe(1530);
    expect(miete(s, 1, 7)).toBe(0);
    expect(abloeseBetrag(1)).toBe(33);
    s = zug(s, 0, { type: 'abloesen', feld: 1 });
    expect(s.spieler[0]!.geld).toBe(1497);
    expect(s.hypothek[1]).toBe(false);
  });
});

describe('monopoly – Gefängnis', () => {
  it('Freikaufen und Freikarte', () => {
    let s = neu(2);
    s.spieler[0]!.gefaengnis = true;
    s.spieler[0]!.pos = 10;
    expect(game.applyMove(s, 0, { type: 'karteNutzen' }).ok).toBe(false);
    s = zug(s, 0, { type: 'freikaufen' });
    expect(s.spieler[0]!.gefaengnis).toBe(false);
    expect(s.spieler[0]!.geld).toBe(1450);
    expect(s.phase).toBe('wuerfeln');
  });

  it('nach drei Fehlversuchen wird die Kaution fällig', () => {
    // Einen Startwert suchen, bei dem der nächste Wurf kein Pasch ist.
    let s = neu(2);
    for (let seed = 1; ; seed += 1) {
      s = neu(2, {}, seed);
      const [a, b] = naechsterWurf(s);
      if (a !== b) break;
    }
    s.spieler[0]!.gefaengnis = true;
    s.spieler[0]!.pos = 10;
    s.spieler[0]!.versuche = 2;
    s = zug(s, 0, { type: 'wuerfeln' });
    expect(s.spieler[0]!.gefaengnis).toBe(false);
    expect(s.spieler[0]!.pos).not.toBe(10);
    expect(s.spieler[0]!.geld).toBeLessThanOrEqual(1450 + 200);
  });
});

describe('monopoly – Schulden und Bankrott', () => {
  it('wer nicht zahlen kann, muss verkaufen oder aufgeben – alles geht an den Gläubiger', () => {
    let s = neu(2);
    s.besitzer[37] = 1;
    s.besitzer[39] = 1;
    s.haeuser[37] = 3;
    s.haeuser[39] = 3;
    s.besitzer[5] = 0;
    s.spieler[0]!.geld = 50;
    stelleVor(s, 0, 39);
    s = zug(s, 0, { type: 'wuerfeln' });
    expect(s.phase).toBe('zahlen');
    expect(game.activeSeats(s)).toEqual([0]);
    expect(game.applyMove(s, 0, { type: 'bezahlen' }).ok).toBe(false);
    expect(game.applyMove(s, 0, { type: 'zugEnde' }).ok).toBe(false);
    s = zug(s, 0, { type: 'hypothek', feld: 5 });
    expect(s.phase).toBe('zahlen');
    s = zug(s, 0, { type: 'aufgeben' });
    expect(s.spieler[0]!.bankrott).toBe(true);
    expect(s.besitzer[5]).toBe(1);
    const o = game.outcome(s);
    expect(o?.winners).toEqual([1]);
    expect(o?.scores?.[0]).toBe(0);
  });

  it('Bankrott gegenüber der Bank gibt die Grundstücke frei', () => {
    let s = neu(3);
    s.besitzer[1] = 0;
    s.hypothek[1] = true;
    s.spieler[0]!.geld = 10;
    stelleVor(s, 0, 38);
    s = zug(s, 0, { type: 'wuerfeln' });
    expect(s.phase).toBe('zahlen');
    s = zug(s, 0, { type: 'aufgeben' });
    expect(s.besitzer[1]).toBeNull();
    expect(s.hypothek[1]).toBe(false);
    expect(s.phase).toBe('wuerfeln');
    expect(s.am).toBe(1);
    expect(game.outcome(s)).toBeNull();
  });
});

describe('monopoly – Handel', () => {
  const angebot = (an: number): MonopolyZug => ({
    type: 'handel',
    an,
    gebeFelder: [1],
    nehmeFelder: [3],
    gebeGeld: 100,
    nehmeGeld: 0,
    gebeKarten: 0,
    nehmeKarten: 0,
  });

  it('der Empfänger wird kurz aktiv und kann annehmen', () => {
    let s = neu(3);
    s.besitzer[1] = 0;
    s.besitzer[3] = 2;
    s = zug(s, 0, angebot(2));
    expect(s.phase).toBe('handel');
    expect(game.activeSeats(s)).toEqual([2]);
    expect(game.applyMove(s, 0, { type: 'handelAnnehmen' }).ok).toBe(false);
    s = zug(s, 2, { type: 'handelAnnehmen' });
    expect(s.phase).toBe('wuerfeln');
    expect(game.activeSeats(s)).toEqual([0]);
    expect(s.besitzer[1]).toBe(2);
    expect(s.besitzer[3]).toBe(0);
    expect(s.spieler[0]!.geld).toBe(1400);
    expect(s.spieler[2]!.geld).toBe(1600);
  });

  it('lehnt ungültige Angebote ab und begrenzt Angebote je Zug', () => {
    let s = neu(3);
    s.besitzer[1] = 0;
    s.besitzer[3] = 2;
    expect(game.applyMove(s, 0, angebot(1)).ok).toBe(false);
    expect(game.applyMove(s, 0, { ...angebot(2), gebeGeld: 99_999 } as MonopolyZug).ok).toBe(false);
    for (let i = 0; i < 3; i += 1) {
      s = zug(s, 0, angebot(2));
      s = zug(s, 2, { type: 'handelAblehnen' });
    }
    expect(s.besitzer[1]).toBe(0);
    expect(game.applyMove(s, 0, angebot(2)).ok).toBe(false);
  });

  it('ein schwerer Bot erkennt, dass ein Tausch eine Gruppe schließt', () => {
    // Sitz 1 (Bot) besitzt Turmstraße, Sitz 0 die Badstraße. Reines Geldangebot
    // unter Wert lehnt er ab, für die eigene Gruppe gibt er mehr her.
    let s = neu(2);
    s.besitzer[1] = 0;
    s.besitzer[3] = 1;
    s = zug(s, 0, { ...angebot(1), gebeFelder: [], nehmeFelder: [3], gebeGeld: 10 } as MonopolyZug);
    const antwort = game.bot!(s, 1, 'schwer', { s: 1 });
    expect(antwort).toEqual({ type: 'handelAblehnen' });
  });
});

describe('monopoly – Bot-Partien', () => {
  const stufen: BotLevel[] = ['leicht', 'mittel', 'schwer'];

  it.each([1, 2, 3, 4])('vier Bots spielen mit Rundenlimit bis zum Ende (Startwert %i)', (seed) => {
    const seats: SeatController[] = [0, 1, 2, 3].map((i) => ({
      type: 'bot',
      level: stufen[(i + seed) % 3]!,
    }));
    let match = createMatch(game, seed * 7919, { ...game.defaultOptions, rundenlimit: 30 }, seats);
    match = runBots(game, match);
    const o = game.outcome(match.state);
    expect(o).not.toBeNull();
    expect(o!.winners.length).toBeGreaterThan(0);
    expect(o!.scores).toHaveLength(4);
  });

  it('zwei schwere Bots ohne Versteigerung, mit Topf, kleinem Startgeld', () => {
    const seats: SeatController[] = [
      { type: 'bot', level: 'schwer' },
      { type: 'bot', level: 'schwer' },
    ];
    let match = createMatch(
      game,
      99,
      { startgeld: 1000, versteigerung: false, freiParkenTopf: true, rundenlimit: 50 },
      seats,
    );
    match = runBots(game, match);
    expect(game.outcome(match.state)).not.toBeNull();
  });

  it('sechs Bots, Schritt für Schritt: jeder Zug legal, Zustand bleibt reines JSON', () => {
    const seats: SeatController[] = Array.from({ length: 6 }, (_, i) => ({
      type: 'bot',
      level: stufen[i % 3]!,
    }));
    let match = createMatch(game, 4242, { ...game.defaultOptions, rundenlimit: 20 }, seats);
    for (let i = 0; i < 5000; i += 1) {
      const next = stepBot(game, match);
      if (!next) break;
      match = next;
    }
    expect(game.outcome(match.state)).not.toBeNull();
    expect(JSON.parse(JSON.stringify(match.state))).toEqual(match.state);
    const s = match.state;
    // Vorrat der Bank stimmt mit den Gebäuden auf dem Brett überein.
    const haeuser = s.haeuser.reduce((a, h) => a + (h < 5 ? h : 0), 0);
    const hotels = s.haeuser.filter((h) => h === 5).length;
    expect(s.bankHaeuser + haeuser).toBe(32);
    expect(s.bankHotels + hotels).toBe(12);
  });
});
