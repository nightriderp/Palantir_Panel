import { describe, expect, it } from 'vitest';
import {
  FRAGEN_PRO_SEITE,
  KATALOG_GEBIETE,
  QUIZ_FRAGEN,
  SEITEN_GESAMT,
  frageNummer,
  quizBeantwortet,
  quizPunkte,
  seitenFragen,
} from './fragenkatalog';

/**
 * Der Fragenkatalog.
 *
 * Bei über hundert von Hand geschriebenen Fragen ist der wahrscheinlichste
 * Fehler kein Denkfehler, sondern ein Tippfehler: ein `richtig`, das auf eine
 * Antwort zeigt, die es nicht gibt, ein doppelter Schlüssel nach dem
 * Kopieren, eine Frage ohne Pointe. Nichts davon fällt beim Durchklicken auf –
 * man müsste jede einzelne Frage sehen. Deshalb hier.
 */

describe('Katalog – Vollständigkeit', () => {
  it('hat über hundert Fragen; alles darunter wäre kein Scherz, sondern ein Quiz', () => {
    expect(QUIZ_FRAGEN.length).toBeGreaterThan(100);
  });

  it('vergibt jeden Schlüssel nur einmal', () => {
    const keys = QUIZ_FRAGEN.map((frage) => frage.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('zeigt bei jeder Frage auf eine Antwort, die es wirklich gibt', () => {
    for (const frage of QUIZ_FRAGEN) {
      expect(frage.antworten.length).toBeGreaterThanOrEqual(3);
      expect(frage.richtig).toBeGreaterThanOrEqual(0);
      expect(frage.richtig).toBeLessThan(frage.antworten.length);
    }
  });

  it('gibt jeder Frage einen Text, Antworten ohne Dubletten und eine Pointe', () => {
    for (const frage of QUIZ_FRAGEN) {
      expect(frage.frage.length).toBeGreaterThan(10);
      expect(frage.echo.length).toBeGreaterThan(10);
      expect(new Set(frage.antworten).size).toBe(frage.antworten.length);
    }
  });

  it('kennt zu jeder Frage ein Gebiet mit Beschriftung', () => {
    for (const frage of QUIZ_FRAGEN) {
      expect(KATALOG_GEBIETE[frage.gebiet]).toBeTruthy();
    }
  });

  it('beginnt mit den drei Panel-Fragen, die das Tutorial verspricht', () => {
    expect(QUIZ_FRAGEN.slice(0, 3).map((frage) => frage.gebiet)).toEqual([
      'panel',
      'panel',
      'panel',
    ]);
  });

  it('legt die richtige Antwort über den Katalog hinweg nicht auf einen Platz', () => {
    const plaetze = new Set(QUIZ_FRAGEN.map((frage) => frage.richtig));

    // „Immer die erste" darf niemals eine Strategie sein.
    expect(plaetze.size).toBeGreaterThan(2);

    const ersteHaelfte = QUIZ_FRAGEN.filter((frage) => frage.richtig === 0).length;
    expect(ersteHaelfte).toBeLessThan(QUIZ_FRAGEN.length / 2);
  });

  it('mischt die Gebiete, statt sie am Stück zu fragen', () => {
    // Nach den drei Panel-Fragen folgen acht verschiedene Gebiete hintereinander.
    const gebiete = QUIZ_FRAGEN.slice(3, 11).map((frage) => frage.gebiet);

    expect(new Set(gebiete).size).toBe(gebiete.length);
  });
});

describe('Katalog – Seiten', () => {
  it('rechnet die Seitenzahl aus Fragen und Seitengröße', () => {
    expect(SEITEN_GESAMT).toBe(Math.ceil(QUIZ_FRAGEN.length / FRAGEN_PRO_SEITE));
  });

  it('gibt der ersten Seite genau die drei versprochenen Fragen', () => {
    const erste = seitenFragen(1);

    expect(erste).toHaveLength(3);
    expect(erste.every((frage) => frage.gebiet === 'panel')).toBe(true);
  });

  it('deckt mit allen Seiten zusammen den ganzen Katalog ab, ohne Dubletten', () => {
    const gesehen: string[] = [];
    for (let seite = 1; seite <= SEITEN_GESAMT; seite += 1) {
      gesehen.push(...seitenFragen(seite).map((frage) => frage.key));
    }

    expect(gesehen).toHaveLength(QUIZ_FRAGEN.length);
    expect(new Set(gesehen).size).toBe(QUIZ_FRAGEN.length);
  });

  it('nummeriert die Fragen fortlaufend über die Seiten', () => {
    expect(frageNummer(1, 0)).toBe(1);
    expect(frageNummer(1, 2)).toBe(3);
    expect(frageNummer(2, 0)).toBe(4);
    expect(frageNummer(5, 1)).toBe(14);
  });

  it('läuft am Ende nicht über', () => {
    expect(seitenFragen(SEITEN_GESAMT).length).toBeGreaterThan(0);
    expect(seitenFragen(SEITEN_GESAMT + 5)).toHaveLength(0);
  });
});

describe('Katalog – Auswertung', () => {
  const leer: (number | null)[] = QUIZ_FRAGEN.map(() => null);

  it('zählt eine leere Liste als null Punkte und null Antworten', () => {
    expect(quizPunkte(leer)).toBe(0);
    expect(quizBeantwortet(leer)).toBe(0);
  });

  it('zählt eine falsche Antwort als beantwortet, aber nicht als Punkt', () => {
    const antworten = [...leer];
    const erste = QUIZ_FRAGEN[0];
    antworten[0] = erste && erste.richtig === 0 ? 1 : 0;

    expect(quizBeantwortet(antworten)).toBe(1);
    expect(quizPunkte(antworten)).toBe(0);
  });

  it('zählt jede richtige Antwort', () => {
    const alleRichtig = QUIZ_FRAGEN.map((frage) => frage.richtig);

    expect(quizPunkte(alleRichtig)).toBe(QUIZ_FRAGEN.length);
    expect(quizBeantwortet(alleRichtig)).toBe(QUIZ_FRAGEN.length);
  });

  it('kommt mit einem halb ausgefüllten Bogen zurecht – der Normalfall', () => {
    const antworten = [...leer];
    for (let i = 0; i < 5; i += 1) antworten[i] = QUIZ_FRAGEN[i]?.richtig ?? 0;

    expect(quizBeantwortet(antworten)).toBe(5);
    expect(quizPunkte(antworten)).toBe(5);
  });
});
