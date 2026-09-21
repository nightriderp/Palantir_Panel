/**
 * Auslöser der Abzeichen (Betreiber-Wunsch 21.09.2026).
 *
 * Geprüft wird dreierlei: dass jedes Abzeichen im Katalog überhaupt erreichbar
 * ist, dass keine Regel eine teure Wiederholung hochzählt, und dass die
 * Schwellen genau dann greifen, wenn sie sollen – einschließlich des
 * auslösenden Eintrags, der aus der Zählung ausgeschlossen und wieder
 * hinzugerechnet wird.
 */

import { ACHIEVEMENT_IDS, type AchievementId, type AuditAction } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_RULES,
  KEINE_HANDGRIFFE,
  type AchievementTrigger,
  rulesForArcadeScore,
  rulesForAuditAction,
  stundeInInstanzZeit,
} from './rules.js';
import { type FakeOptions, fakeAchievementRepository } from './test-support.js';

const KONTO = '11111111-1111-4111-8111-000000000001';

/** Führt die Regel eines Abzeichens gegen eine Attrappe aus. */
function pruefe(
  id: AchievementId,
  trigger: AchievementTrigger,
  options: FakeOptions = {},
): Promise<boolean> {
  return ACHIEVEMENT_RULES[id].check({
    userId: KONTO,
    trigger,
    queries: fakeAchievementRepository(options),
  });
}

/** Ein Audit-Auslöser mit frei wählbarer Uhrzeit. */
function auditAuslöser(
  action: AuditAction,
  at = new Date('2026-09-21T12:00:00Z'),
): AchievementTrigger {
  return { kind: 'audit', action, entryId: 'ausloeser', at };
}

/** Erzeugt `anzahl` Protokolleinträge derselben Aktion. */
function eintraege(action: AuditAction, anzahl: number) {
  return Array.from({ length: anzahl }, (_, index) => ({ id: `eintrag-${index}`, action }));
}

describe('Vollständigkeit der Regel-Tabelle', () => {
  it('kennt zu jedem Abzeichen des Katalogs eine Regel', () => {
    expect(Object.keys(ACHIEVEMENT_RULES).sort()).toEqual([...ACHIEVEMENT_IDS].sort());
  });

  it('lässt kein Abzeichen unerreichbar – jede Regel hat einen Auslöser', () => {
    for (const id of ACHIEVEMENT_IDS) {
      const regel = ACHIEVEMENT_RULES[id];
      const hatAuditAusloeser = regel.actions === 'jede' || regel.actions.length > 0;

      expect(
        hatAuditAusloeser || regel.onArcadeScore === true,
        `${id} könnte nie ausgelöst werden`,
      ).toBe(true);
    }
  });

  it('hängt höchstens ein Abzeichen an **jeder** Aktion – sonst liefe zu viel mit', () => {
    const anJederAktion = ACHIEVEMENT_IDS.filter((id) => ACHIEVEMENT_RULES[id].actions === 'jede');

    expect(anJederAktion).toEqual(['hausmeisterei']);
  });
});

describe('Auswahl der zu prüfenden Regeln', () => {
  it('wählt zu einer Aktion die Abzeichen, die daran hängen – samt `hausmeisterei`', () => {
    expect(rulesForAuditAction('backup.restored').sort()).toEqual(
      ['esLiefDochGestern', 'hausmeisterei'].sort(),
    );
  });

  it('wählt zu einer Aktion ohne eigenes Abzeichen nur `hausmeisterei`', () => {
    expect(rulesForAuditAction('role.created')).toEqual(['hausmeisterei']);
  });

  it('wählt nach einem Arcade-Ergebnis genau die Spielhallen-Abzeichen', () => {
    expect(rulesForArcadeScore().sort()).toEqual(
      ['alleskoenner', 'eingeworfen', 'hartnaeckig', 'spielhallenlegende'].sort(),
    );
  });
});

describe('Einmal-Abzeichen', () => {
  it('greift beim ersten Vorkommen seiner Aktion', async () => {
    expect(await pruefe('grundsteinleger', auditAuslöser('server.created'))).toBe(true);
    expect(await pruefe('esLiefDochGestern', auditAuslöser('backup.restored'))).toBe(true);
    expect(await pruefe('doppelgaenger', auditAuslöser('server.cloned'))).toBe(true);
  });

  it('fragt dafür gar nicht erst die Datenbank', async () => {
    const repository = fakeAchievementRepository();

    await ACHIEVEMENT_RULES.aufraeumer.check({
      userId: KONTO,
      trigger: auditAuslöser('server.deleted'),
      queries: repository,
    });

    expect(repository.zugriffe).toEqual({});
  });
});

describe('Schwellen-Abzeichen', () => {
  it('zählt den auslösenden Eintrag mit, auch wenn er noch nicht festgeschrieben ist', async () => {
    // Vier frühere Einträge plus der auslösende macht fünf.
    const vier = { auditRows: eintraege('server.created', 4) };

    expect(await pruefe('flottenkommando', auditAuslöser('server.created'), vier)).toBe(true);
  });

  it('greift eine Stufe darunter noch nicht', async () => {
    const drei = { auditRows: eintraege('server.created', 3) };

    expect(await pruefe('flottenkommando', auditAuslöser('server.created'), drei)).toBe(false);
  });

  it('zählt den auslösenden Eintrag nicht doppelt, wenn er bereits festgeschrieben ist', async () => {
    /*
     * Der Regelfall im Betrieb: Der Eintrag steht schon in der Tabelle, wenn
     * der Beobachter läuft. Er wird über `exceptEntryId` ausgeschlossen und von
     * der Regel wieder hinzugezählt – sonst löste die fünfte Zeile das
     * Abzeichen zweimal aus oder die vierte schon.
     */
    const mitAusloeser = {
      auditRows: [
        ...eintraege('server.created', 3),
        { id: 'ausloeser', action: 'server.created' as const },
      ],
    };

    expect(await pruefe('flottenkommando', auditAuslöser('server.created'), mitAusloeser)).toBe(
      false,
    );
  });

  it('zählt nur die Aktion, um die es geht', async () => {
    const gemischt = {
      auditRows: [...eintraege('backup.created', 4), ...eintraege('backup.deleted', 20)],
    };

    expect(await pruefe('vorsorglich', auditAuslöser('backup.created'), gemischt)).toBe(false);
  });
});

describe('`hausmeisterei` zählt Handgriffe', () => {
  it('greift beim fünfzigsten protokollierten Handgriff', async () => {
    const neunundvierzig = { auditRows: eintraege('server.settingsChanged', 49) };

    expect(await pruefe('hausmeisterei', auditAuslöser('server.created'), neunundvierzig)).toBe(
      true,
    );
  });

  it('zählt abgewiesene und misslungene Versuche nicht mit', async () => {
    /*
     * Sonst wäre das die einzige Stelle im Katalog, an der sich etwas
     * hochzählen ließe: Fehlanmeldungen und abgeprallte Zugriffe kann jeder
     * beliebig oft erzeugen.
     */
    const nurAbgewiesene = { auditRows: eintraege('access.denied', 200) };

    expect(await pruefe('hausmeisterei', auditAuslöser('server.created'), nurAbgewiesene)).toBe(
      false,
    );
  });

  it('löst auch nicht aus, wenn der auslösende Eintrag selbst keiner ist', async () => {
    const fastVoll = { auditRows: eintraege('server.settingsChanged', 49) };

    for (const action of KEINE_HANDGRIFFE) {
      expect(await pruefe('hausmeisterei', auditAuslöser(action), fastVoll)).toBe(false);
    }
  });
});

describe('`nachtschicht` hängt an der örtlichen Uhrzeit', () => {
  it('greift zwischen drei und fünf Uhr in der Zeitzone der Instanz', async () => {
    // 02:30 UTC ist im September 04:30 in Berlin – mitten im Fenster.
    const nachts = auditAuslöser('auth.loginSucceeded', new Date('2026-09-21T02:30:00Z'));

    expect(await pruefe('nachtschicht', nachts)).toBe(true);
  });

  it('greift tagsüber nicht', async () => {
    const mittags = auditAuslöser('auth.loginSucceeded', new Date('2026-09-21T12:00:00Z'));

    expect(await pruefe('nachtschicht', mittags)).toBe(false);
  });

  it('rechnet in Ortszeit und nicht in UTC – im Winter verschiebt sich das Fenster', () => {
    // 03:30 UTC im Januar ist 04:30 in Berlin (MEZ, +1).
    expect(stundeInInstanzZeit(new Date('2026-01-21T03:30:00Z'))).toBe(4);
    // Dieselbe UTC-Uhrzeit im Sommer ist 05:30 (MESZ, +2) – außerhalb.
    expect(stundeInInstanzZeit(new Date('2026-07-21T03:30:00Z'))).toBe(5);
  });
});

describe('Konto- und Spielhallen-Abzeichen', () => {
  it('erkennt eines der ersten fünf Konten', async () => {
    const trigger = auditAuslöser('auth.loginSucceeded');

    expect(await pruefe('ersteStunde', trigger, { registrationRank: 5 })).toBe(true);
    expect(await pruefe('ersteStunde', trigger, { registrationRank: 6 })).toBe(false);
  });

  it('verlangt für `alleskoenner` jedes Minispiel', async () => {
    const arcade: AchievementTrigger = { kind: 'arcade', gameId: 'kriechpfad' };

    expect(
      await pruefe('alleskoenner', arcade, {
        arcadeRounds: {
          kriechpfad: 1,
          ballwechsel: 1,
          steinbrecher: 1,
          blockstapel: 1,
          punktejaeger: 1,
        },
      }),
    ).toBe(true);

    expect(
      await pruefe('alleskoenner', arcade, { arcadeRounds: { kriechpfad: 40, ballwechsel: 40 } }),
    ).toBe(false);
  });

  it('gibt `spielhallenlegende` nur für das Spiel, in dem gerade gespielt wurde', async () => {
    const imFuehrenden: AchievementTrigger = { kind: 'arcade', gameId: 'kriechpfad' };
    const imAnderen: AchievementTrigger = { kind: 'arcade', gameId: 'ballwechsel' };

    expect(await pruefe('spielhallenlegende', imFuehrenden, { topOf: ['kriechpfad'] })).toBe(true);
    expect(await pruefe('spielhallenlegende', imAnderen, { topOf: ['kriechpfad'] })).toBe(false);
  });
});
