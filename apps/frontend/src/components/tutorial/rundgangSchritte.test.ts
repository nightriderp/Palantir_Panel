import { describe, expect, it } from 'vitest';
import { parseStand, serializeStand } from './rundgangStand';
import {
  ABBRUCH_KLICKS,
  ABBRUCH_STUFEN,
  AUSSCHNITT_LUFT,
  RUNDGANG_SCHRITTE,
  abbruchBeendet,
  abbruchStufe,
  ZETTEL_ABSTAND,
  ZETTEL_BREITE,
  ausschnittFlaechen,
  istSichtbar,
  naechsterSichtbarer,
  zettelPlatz,
  type Fenster,
} from './rundgangSchritte';

/**
 * Der Rundgang rechnet – und diese Rechnerei trifft man beim Ausprobieren im
 * Browser nie vollständig, weil die interessanten Fälle die seltenen sind: das
 * Ziel ganz unten am Rand, die Seitenleiste aus dem Bild geschoben, der
 * Eintrag, den dieses Konto gar nicht hat.
 */

const FENSTER: Fenster = { breite: 1000, hoehe: 800 };

describe('Sichtbarkeit eines Ziels', () => {
  it('nimmt ein Element mitten im Bild', () => {
    expect(istSichtbar({ top: 100, left: 40, breite: 200, hoehe: 36 }, FENSTER)).toBe(true);
  });

  it('verwirft Ausgeblendetes – Breite oder Höhe null', () => {
    expect(istSichtbar({ top: 100, left: 40, breite: 0, hoehe: 36 }, FENSTER)).toBe(false);
    expect(istSichtbar({ top: 100, left: 40, breite: 200, hoehe: 0 }, FENSTER)).toBe(false);
  });

  it('verwirft die geschlossene Schublade – ganz nach links aus dem Bild', () => {
    expect(istSichtbar({ top: 0, left: -250, breite: 250, hoehe: 800 }, FENSTER)).toBe(false);
  });

  it('nimmt die offene Schublade am linken Rand', () => {
    expect(istSichtbar({ top: 0, left: 0, breite: 250, hoehe: 800 }, FENSTER)).toBe(true);
  });
});

describe('Stationen überspringen', () => {
  const schritte = RUNDGANG_SCHRITTE;

  it('bleibt stehen, wenn die Station selbst sichtbar ist', () => {
    const index = schritte.findIndex((schritt) => schritt.key === 'servers');

    expect(naechsterSichtbarer(schritte, index, 1, () => true)).toBe(index);
  });

  it('überspringt Stationen ohne Ziel im Bild', () => {
    const menue = schritte.findIndex((schritt) => schritt.key === 'menue');
    const servers = schritte.findIndex((schritt) => schritt.key === 'servers');

    // Am Rechner ist der Menü-Knopf ausgeblendet: die nächste Station gewinnt.
    expect(naechsterSichtbarer(schritte, menue, 1, (ziel) => ziel !== 'menue')).toBe(servers);
  });

  it('findet Stationen ohne Ziel immer – sie brauchen kein Element', () => {
    expect(naechsterSichtbarer(schritte, 0, 1, () => false)).toBe(0);
  });

  it('meldet das Ende, wenn nach vorn nichts mehr kommt', () => {
    expect(naechsterSichtbarer(schritte, schritte.length, 1, () => true)).toBeNull();
    expect(naechsterSichtbarer(schritte, -1, -1, () => true)).toBeNull();
  });

  it('läuft auch rückwärts über Übersprungenes hinweg', () => {
    const servers = schritte.findIndex((schritt) => schritt.key === 'servers');

    expect(naechsterSichtbarer(schritte, servers - 1, -1, (ziel) => ziel !== 'menue')).toBe(0);
  });
});

describe('Verdunklung mit Ausschnitt', () => {
  it('deckt ohne Ziel das ganze Fenster ab', () => {
    const flaechen = ausschnittFlaechen(null, FENSTER);

    expect(flaechen).toHaveLength(1);
    expect(flaechen[0]).toEqual({ top: 0, left: 0, breite: 1000, hoehe: 800 });
  });

  it('lässt rund um das Ziel ein Loch – mit etwas Luft', () => {
    const ziel = { top: 100, left: 200, breite: 300, hoehe: 40 };
    const [oben, unten, links, rechts] = ausschnittFlaechen(ziel, FENSTER);

    expect(oben?.hoehe).toBe(100 - AUSSCHNITT_LUFT);
    expect(unten?.top).toBe(140 + AUSSCHNITT_LUFT);
    expect(links?.breite).toBe(200 - AUSSCHNITT_LUFT);
    expect(rechts?.left).toBe(500 + AUSSCHNITT_LUFT);
  });

  it('rechnet am Rand nicht ins Negative', () => {
    const ziel = { top: 0, left: 0, breite: 1000, hoehe: 800 };

    for (const flaeche of ausschnittFlaechen(ziel, FENSTER)) {
      expect(flaeche.breite).toBeGreaterThanOrEqual(0);
      expect(flaeche.hoehe).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Platz für den Zettel', () => {
  it('steht mittig, wenn es kein Ziel gibt', () => {
    const platz = zettelPlatz(null, FENSTER, 200);

    expect(platz.seite).toBe('mitte');
    expect(platz.left).toBe((1000 - ZETTEL_BREITE) / 2);
    expect(platz.top).toBe((800 - 200) / 2);
  });

  it('hängt unter dem Ziel, wenn er dort hinpasst', () => {
    const platz = zettelPlatz({ top: 100, left: 200, breite: 300, hoehe: 40 }, FENSTER, 200);

    expect(platz.seite).toBe('unten');
    expect(platz.top).toBe(140 + ZETTEL_ABSTAND);
    expect(platz.left).toBe(200);
  });

  it('klappt nach oben, wenn unten kein Platz mehr ist', () => {
    const platz = zettelPlatz({ top: 700, left: 200, breite: 300, hoehe: 40 }, FENSTER, 200);

    expect(platz.seite).toBe('oben');
    expect(platz.top).toBe(700 - ZETTEL_ABSTAND - 200);
  });

  it('bleibt im Bild, auch wenn das Ziel ganz rechts klebt', () => {
    const platz = zettelPlatz({ top: 100, left: 960, breite: 30, hoehe: 30 }, FENSTER, 200);

    expect(platz.left + ZETTEL_BREITE).toBeLessThanOrEqual(FENSTER.breite);
    expect(platz.left).toBeGreaterThanOrEqual(ZETTEL_ABSTAND);
  });

  it('gibt lieber unten nach als aus dem Fenster zu laufen', () => {
    // Winziges Fenster: weder oben noch unten ist Platz.
    const eng: Fenster = { breite: 400, hoehe: 260 };
    const platz = zettelPlatz({ top: 120, left: 20, breite: 100, hoehe: 40 }, eng, 200);

    expect(platz.top).toBeGreaterThanOrEqual(ZETTEL_ABSTAND);
    expect(platz.top).toBeLessThanOrEqual(eng.hoehe - ZETTEL_ABSTAND);
  });
});

describe('Gespeicherter Stand', () => {
  it('liest nur „erledigt" als erledigt – alles andere heißt offen', () => {
    expect(parseStand('erledigt')).toBe('erledigt');
    expect(parseStand('offen')).toBe('offen');
    expect(parseStand(null)).toBe('offen');
    expect(parseStand('{"kaputt":true}')).toBe('offen');
  });

  it('schreibt, was es liest', () => {
    expect(parseStand(serializeStand('erledigt'))).toBe('erledigt');
    expect(parseStand(serializeStand('offen'))).toBe('offen');
  });
});

describe('Inhalt des Rundgangs', () => {
  it('beginnt und endet ohne Ziel – Begrüßung und Schluss stehen mittig', () => {
    expect(RUNDGANG_SCHRITTE[0]?.ziel).toBeNull();
    expect(RUNDGANG_SCHRITTE[RUNDGANG_SCHRITTE.length - 1]?.ziel).toBeNull();
  });

  it('vergibt jeden Schlüssel nur einmal', () => {
    const keys = RUNDGANG_SCHRITTE.map((schritt) => schritt.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('Die Leiter beim Abbrechen', () => {
  it('kostet fünf Klicks – vier Rückfragen, dann ist man raus', () => {
    // Der Wunsch war wörtlich „5 mal klicken". Die Zahl steht nur hier im
    // Test; im Code ergibt sie sich aus der Länge des Feldes.
    expect(ABBRUCH_KLICKS).toBe(5);
    expect(ABBRUCH_STUFEN).toHaveLength(5);
  });

  it('fragt vor dem ersten Klick nichts', () => {
    expect(abbruchStufe(0).frage).toBeNull();
    expect(abbruchStufe(0).knopf).toBe('Nicht jetzt');
  });

  it('hat ab dem ersten Klick auf jeder Stufe eine Rückfrage', () => {
    for (let klicks = 1; klicks < ABBRUCH_KLICKS; klicks += 1) {
      expect(abbruchStufe(klicks).frage).toBeTruthy();
    }
  });

  it('beschriftet den Knopf auf jeder Stufe anders', () => {
    const knoepfe = ABBRUCH_STUFEN.map((stufe) => stufe.knopf);

    expect(new Set(knoepfe).size).toBe(knoepfe.length);
  });

  it('hält die Beschriftungen kurz – der Zettel teilt die Fußzeile mit zwei Knöpfen', () => {
    for (const stufe of ABBRUCH_STUFEN) {
      expect(stufe.knopf.length).toBeLessThanOrEqual(12);
    }
  });

  it('beendet erst beim letzten Klick', () => {
    expect(abbruchBeendet(0)).toBe(false);
    expect(abbruchBeendet(ABBRUCH_KLICKS - 2)).toBe(false);
    expect(abbruchBeendet(ABBRUCH_KLICKS - 1)).toBe(true);
  });

  it('klemmt einen Zähler, der über das Feld hinausläuft', () => {
    expect(abbruchStufe(99)).toBe(ABBRUCH_STUFEN[ABBRUCH_STUFEN.length - 1]);
    expect(abbruchStufe(-3)).toBe(ABBRUCH_STUFEN[0]);
  });
});
