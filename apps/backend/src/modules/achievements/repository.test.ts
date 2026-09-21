/**
 * Datenzugriffe des Erfolgs-Moduls, soweit ohne Datenbank prüfbar.
 *
 * Die SQL-Abfragen selbst prüft der Betrieb; hier steht die eine Entscheidung,
 * die das Repository für sich trifft: was es aus der Tabelle überhaupt
 * weitergibt.
 */

import { ACHIEVEMENT_IDS } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { nurBekannteAbzeichen } from './repository.js';

const ZEITPUNKT = new Date('2026-09-21T12:00:00Z');

describe('nurBekannteAbzeichen', () => {
  it('lässt Kennungen des Katalogs durch', () => {
    const rows = ACHIEVEMENT_IDS.map((achievementId) => ({ achievementId, unlockedAt: ZEITPUNKT }));

    expect(nurBekannteAbzeichen(rows)).toHaveLength(ACHIEVEMENT_IDS.length);
  });

  it('verwirft Kennungen aus einer zurückgebauten Fassung', () => {
    /*
     * `hausmeisterei` gab es in der ersten Fassung und fiel mit den
     * Verwaltungs-Abzeichen heraus (Betreiber, 21.09.2026). Auf einer Instanz,
     * die beide Fassungen gesehen hat, steht die Zeile noch – sie darf den
     * Bestand nicht mehr vergrößern.
     */
    const rows = [
      { achievementId: 'ersteStunde', unlockedAt: ZEITPUNKT },
      { achievementId: 'hausmeisterei', unlockedAt: ZEITPUNKT },
      { achievementId: 'schriftsetzer', unlockedAt: ZEITPUNKT },
      { achievementId: 'tuersteher', unlockedAt: ZEITPUNKT },
    ];

    expect(nurBekannteAbzeichen(rows).map((row) => row.achievementId)).toEqual(['ersteStunde']);
  });

  it('behält die Reihenfolge der Abfrage bei', () => {
    const rows = [
      { achievementId: 'nachtschicht', unlockedAt: new Date('2026-09-20T03:30:00Z') },
      { achievementId: 'hausmeisterei', unlockedAt: new Date('2026-09-20T04:00:00Z') },
      { achievementId: 'ersteStunde', unlockedAt: new Date('2026-09-20T05:00:00Z') },
    ];

    expect(nurBekannteAbzeichen(rows).map((row) => row.achievementId)).toEqual([
      'nachtschicht',
      'ersteStunde',
    ]);
  });
});
