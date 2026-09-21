import { describe, expect, it } from 'vitest';
import {
  FLUCHT_MAX,
  LESEZEIT_MAX_MS,
  LESEZEIT_MIN_MS,
  angezeigteGesamt,
  fliehtNoch,
  fluchtText,
  fluchtVersatz,
  gesamtHinweis,
  lesezeitSpruch,
  lesezeitUrteil,
  luegenProzent,
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
  const sauber = { ueberflogen: 0, fluchtversuche: 0, quizPunkte: 3, quizFragen: 3 };

  it('gibt die Eins nur für einen tadellosen Durchlauf', () => {
    expect(zeugnis(sauber).wert).toBe(1);
  });

  it('rechnet jedes Vergehen an', () => {
    expect(zeugnis({ ...sauber, ueberflogen: 1 }).wert).toBe(2);
    expect(zeugnis({ ...sauber, ueberflogen: 3 }).wert).toBe(3);
    expect(zeugnis({ ...sauber, quizPunkte: 0 }).wert).toBe(2);
  });

  it('bleibt zwischen 1 und 5 – eine Sechs gibt es nicht', () => {
    const katastrophe = { ueberflogen: 50, fluchtversuche: 40, quizPunkte: 0, quizFragen: 3 };

    expect(zeugnis(katastrophe).wert).toBe(5);
    expect(notentext(zeugnis(katastrophe).wert)).toBeTruthy();
  });

  it('begründet die Note mit dem, was tatsächlich passiert ist', () => {
    const text = zeugnis({ ...sauber, ueberflogen: 2, fluchtversuche: 3 }).begruendung;

    expect(text).toContain('3 von 3');
    expect(text).toContain('2-mal zu früh');
    expect(text).toContain('3-mal');
  });
});
