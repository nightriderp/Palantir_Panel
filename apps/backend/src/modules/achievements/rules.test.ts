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
  META_ACHIEVEMENTS,
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
  trigger: AchievementTrigger | null,
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

      /*
       * Drei Wege, auf denen eine Regel drankommt: ein Protokolleintrag, ein
       * Arcade-Ergebnis – oder, bei den Bestands-Abzeichen, der Nachschlag des
       * Service, sobald ein Durchgang etwas vergeben hat.
       */
      expect(
        hatAuditAusloeser || regel.onArcadeScore === true || regel.meta === true,
        `${id} könnte nie ausgelöst werden`,
      ).toBe(true);
    }
  });

  it('hängt höchstens ein Abzeichen an **jeder** Aktion – sonst liefe zu viel mit', () => {
    const anJederAktion = ACHIEVEMENT_IDS.filter((id) => ACHIEVEMENT_RULES[id].actions === 'jede');

    expect(anJederAktion).toEqual(['vielbeschaeftigt']);
  });

  it('nimmt Bestands-Abzeichen aus den Ereignis-Auswahlen heraus', () => {
    /*
     * Sie hängen am eigenen Abzeichen-Bestand, nicht an einem Vorgang. Stünden
     * sie in einer Auswahl, liefen sie bei jedem Protokolleintrag mit, nur um
     * fast immer „noch nicht" zu sagen – der Service zieht sie stattdessen
     * nach, sobald ein Durchgang etwas vergeben hat.
     */
    expect(META_ACHIEVEMENTS.length).toBeGreaterThan(0);

    for (const id of META_ACHIEVEMENTS) {
      expect(rulesForAuditAction('server.created'), id).not.toContain(id);
      expect(rulesForArcadeScore(), id).not.toContain(id);
    }
  });
});

describe('Auswahl der zu prüfenden Regeln', () => {
  it('wählt zu einer Aktion die Abzeichen, die daran hängen – samt `vielbeschaeftigt`', () => {
    expect(rulesForAuditAction('backup.restored').sort()).toEqual(
      ['esLiefDochGestern', 'vielbeschaeftigt'].sort(),
    );
  });

  it('wählt zu einer Aktion ohne eigenes Abzeichen nur `vielbeschaeftigt`', () => {
    expect(rulesForAuditAction('role.created')).toEqual(['vielbeschaeftigt']);
  });

  it('wählt nach einem Arcade-Ergebnis die Spielhallen-, Platzierungs- und Runden-Abzeichen', () => {
    const nachDemSpiel = rulesForArcadeScore();

    expect(nachDemSpiel).toEqual(expect.arrayContaining(['eingeworfen', 'alleskoenner']));
    expect(nachDemSpiel).toEqual(expect.arrayContaining(['platz50', 'spielhallenlegende']));
    expect(nachDemSpiel).toEqual(expect.arrayContaining(['runden10', 'runden1000']));
    // Anmeldungen hängen am Protokoll, nicht am Spiel.
    expect(nachDemSpiel).not.toContain('anmeldung10');
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

describe('`vielbeschaeftigt` zählt Handgriffe', () => {
  it('greift beim fünfzigsten protokollierten Handgriff', async () => {
    const neunundvierzig = { auditRows: eintraege('server.settingsChanged', 49) };

    expect(await pruefe('vielbeschaeftigt', auditAuslöser('server.created'), neunundvierzig)).toBe(
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

    expect(await pruefe('vielbeschaeftigt', auditAuslöser('server.created'), nurAbgewiesene)).toBe(
      false,
    );
  });

  it('wird bei einem abgewiesenen oder misslungenen Versuch gar nicht erst geprüft', () => {
    /*
     * Die Ausnahme greift schon bei der Auswahl und nicht erst in der
     * Bedingung: Sonst liefe bei jeder Fehlanmeldung eine Zählung über dem
     * Audit-Log an, um dann „zählt nicht" zu sagen.
     */
    for (const action of KEINE_HANDGRIFFE) {
      expect(rulesForAuditAction(action)).not.toContain('vielbeschaeftigt');
    }
  });

  it('lässt eine Fehlanmeldung ganz ohne Regel durchgehen', () => {
    // Der billigste Fall: Der Service rührt die Datenbank gar nicht erst an.
    expect(rulesForAuditAction('auth.loginFailed')).toEqual([]);
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

  it('lässt den Betreiber aussen vor, der ausserhalb der Wertung steht', async () => {
    /*
     * Das Repository gibt dem Owner `MAX_SAFE_INTEGER` statt seines echten
     * Platzes – sein Konto ist zwangsläufig das erste der Instanz, und „einer
     * der ersten fünf" wäre für ihn keine Auszeichnung (Betreiber,
     * 21.09.2026). Die Regel muss das schlicht durchgehen lassen.
     */
    const trigger = auditAuslöser('auth.loginSucceeded');

    expect(
      await pruefe('ersteStunde', trigger, { registrationRank: Number.MAX_SAFE_INTEGER }),
    ).toBe(false);
  });

  it('staffelt die Anmeldungen, ohne dass etwas dabei verbraucht wird', async () => {
    const trigger = auditAuslöser('auth.loginSucceeded');
    const neun = { auditRows: eintraege('auth.loginSucceeded', 9) };

    // Neun frühere plus die auslösende macht zehn.
    expect(await pruefe('anmeldung10', trigger, neun)).toBe(true);
    expect(await pruefe('anmeldung50', trigger, neun)).toBe(false);
  });

  it('gibt die Runden-Leiter nur bis zur erreichten Stufe', async () => {
    const arcade: AchievementTrigger = { kind: 'arcade', gameId: 'kriechpfad' };
    const dreissig = { arcadeRounds: { kriechpfad: 30 } };

    expect(await pruefe('runden10', arcade, dreissig)).toBe(true);
    expect(await pruefe('hartnaeckig', arcade, dreissig)).toBe(true);
    expect(await pruefe('runden50', arcade, dreissig)).toBe(false);
  });

  it('verlangt für `alleskoenner` jedes Spiel der Kategorie „Arcade"', async () => {
    const arcade: AchievementTrigger = { kind: 'arcade', gameId: 'kriechpfad' };
    const alleArcade = {
      kriechpfad: 1,
      ballwechsel: 1,
      steinbrecher: 1,
      blockstapel: 1,
      punktejaeger: 1,
      invaders: 1,
      flappy: 1,
    };

    // Brett- und Partyspiele zählen nicht mit – Siege dort gibt es teils nur online.
    expect(await pruefe('alleskoenner', arcade, { arcadeRounds: alleArcade })).toBe(true);
    expect(
      await pruefe('alleskoenner', arcade, {
        arcadeRounds: { ...alleArcade, flappy: 0, schach: 3, codenames: 1 },
      }),
    ).toBe(false);

    expect(
      await pruefe('alleskoenner', arcade, { arcadeRounds: { kriechpfad: 40, ballwechsel: 40 } }),
    ).toBe(false);
  });

  it('vergibt die Platzierungs-Leiter nach dem besten Platz über alle Bestenlisten', async () => {
    /*
     * Der Witz an der Leiter: Wer irgendwo vorne steht, bekommt alles darunter
     * gleich mit. Ein Konto auf Platz 3 hat damit auch „Top 50", „Top 20",
     * „Top 10" und „Top 5" – nur Platz 2 und Platz 1 fehlen ihm noch.
     */
    const arcade: AchievementTrigger = { kind: 'arcade', gameId: 'kriechpfad' };
    const dritter = { bestRank: 3 };

    for (const id of ['platz50', 'platz20', 'platz10', 'platz5', 'platz3'] as const) {
      expect(await pruefe(id, arcade, dritter), id).toBe(true);
    }

    expect(await pruefe('platz2', arcade, dritter)).toBe(false);
    expect(await pruefe('spielhallenlegende', arcade, dritter)).toBe(false);
  });

  it('gibt einem Konto ohne Platzierung keine einzige Stufe', async () => {
    const arcade: AchievementTrigger = { kind: 'arcade', gameId: 'kriechpfad' };

    // `bestArcadeRank` liefert `null`, wenn nie gespielt wurde – die unterste
    // Stufe darf daraus keinen Treffer machen.
    expect(await pruefe('platz50', arcade)).toBe(false);
  });
});

describe('Nachvergabe ohne Auslöser', () => {
  /**
   * Die Regel, die alle Regeln zusammenhält.
   *
   * Im laufenden Betrieb genügt manchen Bedingungen das Ereignis selbst – „der
   * Server ist gerade angelegt worden" braucht keine Abfrage. Ohne Auslöser
   * gilt das nicht mehr: Wer dort ein `true` stehen lässt, verteilt das
   * Abzeichen beim Nachvergabe-Lauf an **jedes** Konto der Instanz, auch an
   * die, die nie in die Nähe der Bedingung gekommen sind.
   *
   * Genau so ist `eingeworfen` beim Bauen aufgefallen. Dieser Test fängt den
   * nächsten Fall ab, bevor er jemandem ein Abzeichen schenkt, das er sich
   * nicht verdient hat.
   */
  it('erfüllt kein einziges Abzeichen an einem Konto ohne jede Vorgeschichte', async () => {
    const leer = fakeAchievementRepository();

    for (const id of ACHIEVEMENT_IDS) {
      const erfuellt = await ACHIEVEMENT_RULES[id].check({
        userId: KONTO,
        trigger: null,
        queries: leer,
      });

      expect(erfuellt, `${id} wird ohne Vorgeschichte vergeben`).toBe(false);
    }
  });

  it('erfüllt ein Einmal-Abzeichen, sobald der Vorgang im Protokoll steht', async () => {
    const mitVorgeschichte = { auditRows: [{ id: 'a', action: 'backup.restored' as const }] };

    expect(await pruefe('esLiefDochGestern', null, mitVorgeschichte)).toBe(true);
    // Ein anderer Vorgang reicht dafür nicht.
    expect(await pruefe('doppelgaenger', null, mitVorgeschichte)).toBe(false);
  });

  it('zählt Schwellen ohne den Zuschlag des laufenden Betriebs', async () => {
    // Vier angelegte Server sind vier, nicht fünf: Der Zuschlag gilt dem
    // auslösenden Ereignis, und das gibt es hier nicht.
    expect(
      await pruefe('flottenkommando', null, { auditRows: eintraege('server.created', 4) }),
    ).toBe(false);
    expect(
      await pruefe('flottenkommando', null, { auditRows: eintraege('server.created', 5) }),
    ).toBe(true);
  });

  it('fragt für `nachtschicht` das Protokoll nach der Uhrzeit', async () => {
    const nachts = {
      auditRows: eintraege('auth.loginSucceeded', 1),
      nachtEintrag: true,
    };

    expect(await pruefe('nachtschicht', null, nachts)).toBe(true);
    expect(await pruefe('nachtschicht', null, { ...nachts, nachtEintrag: false })).toBe(false);
  });

  it('nimmt für die Platzierung jede Bestenliste, nicht eine bestimmte', async () => {
    expect(await pruefe('spielhallenlegende', null, { bestRank: 1 })).toBe(true);
    expect(await pruefe('platz10', null, { bestRank: 7 })).toBe(true);
  });
});
