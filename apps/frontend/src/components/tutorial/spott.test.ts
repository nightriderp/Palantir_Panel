import { describe, expect, it } from 'vitest';
import {
  FLUCHT_MAX,
  LESEZEIT_MAX_MS,
  LESEZEIT_MIN_MS,
  NACHFRAGE_SCHWELLEN,
  angezeigteGesamt,
  antwortEcho,
  ausdauerTitel,
  fliehtNoch,
  fluchtText,
  fluchtVersatz,
  gesamtHinweis,
  lesezeitSpruch,
  lesezeitUrteil,
  luegenProzent,
  nachfrage,
  nachfrageFaellig,
  notentext,
  sekunden,
  zeugnis,
} from './spott';

/**
 * Der Spott der Einweisung ist reine Logik und deshalb prüfbar.
 *
 * Genau darum steht er in einer eigenen Datei und würfelt nicht: Ein Tutorial,
 * dessen Sprüche `Math.random()` zieht, lässt sich nicht festhalten – hier ist
 * bei jedem Lauf dieselbe Zeile dasselbe Ergebnis.
 */

describe('Lesezeit', () => {
  it('erkennt Überflogenes, Gelesenes und Eingeschlafenes', () => {
    expect(lesezeitUrteil(LESEZEIT_MIN_MS - 1)).toBe('ueberflogen');
    expect(lesezeitUrteil(LESEZEIT_MIN_MS)).toBe('gelesen');
    expect(lesezeitUrteil(LESEZEIT_MAX_MS)).toBe('gelesen');
    expect(lesezeitUrteil(LESEZEIT_MAX_MS + 1)).toBe('eingeschlafen');
  });

  it('schweigt, wenn die Lesezeit in Ordnung war', () => {
    expect(lesezeitSpruch(5_000, 0)).toBeNull();
  });

  it('nennt die gebrauchte Zeit mit deutschem Komma', () => {
    expect(sekunden(1_234)).toBe('1,2');
    expect(lesezeitSpruch(800, 0)).toContain('0,8');
  });

  it('wiederholt sich beim zweiten Verstoß nicht', () => {
    const erster = lesezeitSpruch(900, 0);
    const zweiter = lesezeitSpruch(900, 1);

    expect(erster).not.toBeNull();
    expect(zweiter).not.toBe(erster);
  });

  it('dreht auch bei sehr vielen Verstößen nicht ins Leere', () => {
    expect(lesezeitSpruch(900, 99)).toBeTruthy();
    expect(lesezeitSpruch(10 * LESEZEIT_MAX_MS, 7)).toBeTruthy();
  });
});

describe('Überspringen-Knopf', () => {
  it('weicht genau FLUCHT_MAX-mal aus und bleibt dann stehen', () => {
    expect(fliehtNoch(0)).toBe(true);
    expect(fliehtNoch(FLUCHT_MAX - 1)).toBe(true);
    expect(fliehtNoch(FLUCHT_MAX)).toBe(false);
  });

  it('steht beim ersten Versuch an seinem Platz', () => {
    expect(fluchtVersatz(0)).toEqual({ x: 0, y: 0 });
  });

  it('bleibt in jedem Zustand im Panel – höchstens 112 Pixel zur Seite', () => {
    for (let versuche = 0; versuche <= FLUCHT_MAX + 3; versuche += 1) {
      const versatz = fluchtVersatz(versuche);
      expect(Math.abs(versatz.x)).toBeLessThanOrEqual(112);
      expect(Math.abs(versatz.y)).toBeLessThanOrEqual(28);
    }
  });

  it('gibt am Ende sichtbar auf', () => {
    expect(fluchtText(0)).toBe('Überspringen');
    expect(fluchtText(FLUCHT_MAX)).toBe('Na gut. Du gewinnst.');
    expect(fluchtText(99)).toBe(fluchtText(FLUCHT_MAX));
  });
});

describe('Fortschritt – die eingebauten Lügen', () => {
  it('stimmt am Anfang und am Ende, nur dazwischen nicht', () => {
    expect(angezeigteGesamt(0, 8)).toBe(8);
    expect(angezeigteGesamt(4, 8)).toBe(9);
    expect(angezeigteGesamt(7, 8)).toBe(8);
  });

  it('kommentiert die Zahl genau dann, wenn sie sich geändert hat', () => {
    expect(gesamtHinweis(0, 8)).toBeNull();
    expect(gesamtHinweis(4, 8)).toContain('gefunden');
    expect(gesamtHinweis(7, 8)).toContain('erledigt');
  });

  it('hängt am letzten Schritt bei 99 Prozent fest', () => {
    expect(luegenProzent(7, 8)).toBe(99);
    expect(luegenProzent(1, 8)).toBe(3);
    expect(luegenProzent(4, 8)).toBe(50);
  });

  it('bleibt bei leerer Liste bei null statt durch null zu teilen', () => {
    expect(luegenProzent(0, 0)).toBe(0);
  });
});

describe('Zeugnis', () => {
  /** Ruhig gelesen, zwölf Fragen beantwortet, alle richtig. */
  const sauber = {
    ueberflogen: 0,
    fluchtversuche: 0,
    quizPunkte: 12,
    quizBeantwortet: 12,
    quizGesamt: 124,
  };

  it('gibt die Eins für einen tadellosen Durchlauf mit guter Quote', () => {
    expect(zeugnis(sauber).wert).toBe(1);
  });

  it('rechnet jedes Vergehen an', () => {
    expect(zeugnis({ ...sauber, ueberflogen: 1 }).wert).toBe(2);
    expect(zeugnis({ ...sauber, ueberflogen: 3 }).wert).toBe(3);
  });

  it('gibt den Wissensbonus erst ab einer Menge, bei der Raten nicht mehr trägt', () => {
    // Drei von drei sieht gut aus, ist aber zu wenig für einen Bonus.
    const dreiVonDrei = { ...sauber, quizPunkte: 3, quizBeantwortet: 3 };

    expect(zeugnis(dreiVonDrei).wert).toBe(2);
  });

  it('erkennt den ganzen Bogen an – wer alles beantwortet, bekommt die Eins', () => {
    const alles = { ...sauber, quizPunkte: 60, quizBeantwortet: 124, quizGesamt: 124 };

    // Quote unter 80 Prozent, also kein Wissensbonus – die Strecke reicht trotzdem.
    expect(zeugnis(alles).wert).toBe(1);
  });

  it('bleibt zwischen 1 und 5 – eine Sechs gibt es nicht', () => {
    const katastrophe = {
      ueberflogen: 50,
      fluchtversuche: 40,
      quizPunkte: 0,
      quizBeantwortet: 3,
      quizGesamt: 124,
    };

    expect(zeugnis(katastrophe).wert).toBe(5);
    expect(notentext(zeugnis(katastrophe).wert)).toBeTruthy();
  });

  it('begründet die Note mit dem, was tatsächlich passiert ist', () => {
    const text = zeugnis({ ...sauber, ueberflogen: 2, fluchtversuche: 3 }).begruendung;

    expect(text).toContain('12 von 12');
    expect(text).toContain('2-mal zu früh');
    expect(text).toContain('3-mal');
  });
});

describe('Ausdauer – wie weit jemand gekommen ist', () => {
  it('unterscheidet Aufhören nach drei Fragen von Aufhören nach achtzig', () => {
    expect(ausdauerTitel(3, 124)).not.toBe(ausdauerTitel(80, 124));
  });

  it('würdigt den vollständigen Bogen eigens', () => {
    expect(ausdauerTitel(124, 124)).toContain('Vollständig');
  });

  it('hat auch für den Abbruch vor der dritten Frage einen Satz', () => {
    expect(ausdauerTitel(0, 124).length).toBeGreaterThan(10);
  });

  it('steigt mit jeder Schwelle, ohne Lücke', () => {
    const saetze = [0, 3, 6, 12, 24, 45, 75, 124].map((n) => ausdauerTitel(n, 124));

    expect(new Set(saetze).size).toBe(saetze.length);
  });
});

describe('Nachfrage – „willst du das wirklich?"', () => {
  it('kommt genau an den festgelegten Schwellen', () => {
    for (const schwelle of NACHFRAGE_SCHWELLEN) {
      expect(nachfrageFaellig(schwelle)).toBe(true);
    }

    expect(nachfrageFaellig(1)).toBe(false);
    expect(nachfrageFaellig(7)).toBe(false);
    expect(nachfrageFaellig(0)).toBe(false);
  });

  it('setzt die Zahlen in den Text ein', () => {
    const erste = nachfrage(6, 124);

    expect(erste?.text).toContain('124');
    expect(erste?.text).toContain('5');
  });

  it('nennt bei zwölf die Zahl der übrigen Fragen', () => {
    expect(nachfrage(12, 124)?.text).toContain('112');
  });

  it('bietet an jeder Schwelle beide Wege an', () => {
    for (const schwelle of NACHFRAGE_SCHWELLEN) {
      const frage = nachfrage(schwelle, 124);

      expect(frage?.weiter.length).toBeGreaterThan(2);
      expect(frage?.raus.length).toBeGreaterThan(2);
    }
  });

  it('schweigt zwischen den Schwellen', () => {
    expect(nachfrage(13, 124)).toBeNull();
  });
});

describe('Rückmeldung je Antwort', () => {
  it('unterscheidet richtig und falsch', () => {
    expect(antwortEcho(true, 0)).not.toBe(antwortEcho(false, 0));
  });

  it('wiederholt sich nicht sofort', () => {
    expect(antwortEcho(true, 0)).not.toBe(antwortEcho(true, 1));
  });

  it('läuft auch bei hundert Fragen nicht ins Leere', () => {
    expect(antwortEcho(false, 117)).toBeTruthy();
  });
});
