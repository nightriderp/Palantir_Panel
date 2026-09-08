import { describe, expect, it } from 'vitest';
import { FREIGABE_VARIABLE, istVerbindungsabbruch, pruefeFreigabe } from './db.js';

/**
 * Der Prüfstand selbst (W2-28) – die beiden Entscheidungen, die er trifft.
 *
 * **Warum es diese Datei gibt.** Ein CI-Lauf ist mit Exit 1 gescheitert, dessen
 * Zusammenfassung 2276 bestandene und **null** fehlgeschlagene Tests auswies.
 * Ursache war der Abbau: `DROP DATABASE … WITH (FORCE)` trennt jede noch offene
 * Verbindung, die betroffenen Clients melden das als SQLSTATE 57P01, und ein
 * `error`-Ereignis ohne Zuhörer wird in Node zur unbehandelten Ausnahme. Vitest
 * zählt die als „Unhandled Error" und beendet den Lauf rot.
 *
 * Die Unterscheidung „erwarteter Abbruch" gegen „echter Fehler" ist damit die
 * Stelle, an der ein zu weit gefasster Fänger echte Verbindungsprobleme still
 * verschlucken würde. Deshalb steht sie hier.
 */

/** Baut einen Fehler, wie `pg` ihn auf den Pool wirft. */
function pgFehler(code: string): Error {
  return Object.assign(new Error('terminating connection due to administrator command'), { code });
}

describe('istVerbindungsabbruch', () => {
  it('erkennt den Abbruch, den das Wegräumen der Datenbank auslöst', () => {
    // 57P01 ist genau der Fall aus `DROP DATABASE … WITH (FORCE)`.
    expect(istVerbindungsabbruch(pgFehler('57P01'))).toBe(true);
  });

  it('erkennt auch die übrigen Formen eines beendeten Kanals', () => {
    for (const code of ['57P02', '57P03', '08006', '08003']) {
      expect(istVerbindungsabbruch(pgFehler(code)), code).toBe(true);
    }
  });

  it('lässt echte Fehler durch', () => {
    // Die Gegenprobe zum Zweck dieser Prüfung: Ein Fänger, der alles
    // verschluckt, verstiege sich zum Verstecken echter Probleme.
    expect(istVerbindungsabbruch(pgFehler('23505'))).toBe(false);
    expect(istVerbindungsabbruch(pgFehler('28P01'))).toBe(false);
    expect(istVerbindungsabbruch(pgFehler('53300'))).toBe(false);
  });

  it('wirft nicht bei Werten ohne code-Feld', () => {
    expect(istVerbindungsabbruch(null)).toBe(false);
    expect(istVerbindungsabbruch(undefined)).toBe(false);
    expect(istVerbindungsabbruch('57P01')).toBe(false);
    expect(istVerbindungsabbruch(new Error('irgendwas'))).toBe(false);
    expect(istVerbindungsabbruch({ code: 57 })).toBe(false);
  });
});

describe('pruefeFreigabe', () => {
  it('verlangt beide Schalter', () => {
    expect(pruefeFreigabe({}).aktiv).toBe(false);
    expect(pruefeFreigabe({ DATABASE_URL: 'postgres://x/y' }).aktiv).toBe(false);
    expect(pruefeFreigabe({ [FREIGABE_VARIABLE]: '1' }).aktiv).toBe(false);

    const frei = pruefeFreigabe({ DATABASE_URL: 'postgres://x/y', [FREIGABE_VARIABLE]: '1' });

    expect(frei.aktiv && frei.url).toBe('postgres://x/y');
  });

  it('nennt bei jeder Ablehnung einen Grund', () => {
    // Eine übersprungene Suite ohne Begründung sieht aus wie eine bestandene.
    for (const umgebung of [{}, { DATABASE_URL: '   ' }, { DATABASE_URL: 'postgres://x/y' }]) {
      const ergebnis = pruefeFreigabe(umgebung);

      expect(ergebnis.aktiv).toBe(false);
      expect(!ergebnis.aktiv && ergebnis.grund.length).toBeGreaterThan(20);
    }
  });
});
