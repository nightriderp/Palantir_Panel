/**
 * Fachliche Logik des Erfolgs-Moduls (Betreiber-Wunsch 21.09.2026).
 *
 * Schwerpunkte: die Übersicht (Stufe, Titel, geheime Abzeichen), die Vergabe
 * (einmalig, nie zweimal) und die Zusicherung, auf der alles andere ruht –
 * **die Vergabe wirft nie**. Ein Abzeichen hängt an einem fremden Vorgang, der
 * gerade gelungen ist; scheitert es, bleibt der Vorgang gelungen.
 */

import { ACHIEVEMENT_IDS, ACHIEVEMENTS } from '@palantir/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AchievementError } from './errors.js';
import type { AchievementRepository } from './repository.js';
import { createAchievementService } from './service.js';
import { type FakeOptions, fakeAchievementRepository } from './test-support.js';

const KONTO = '11111111-1111-4111-8111-000000000001';

function service(options: FakeOptions = {}) {
  const repository = fakeAchievementRepository(options);

  return { repository, achievements: createAchievementService({ repository }) };
}

describe('Übersicht', () => {
  it('führt jedes Abzeichen des Katalogs, auch die verschlossenen', async () => {
    const { achievements } = service();

    const uebersicht = await achievements.overviewFor(KONTO);

    expect(uebersicht.entries).toHaveLength(ACHIEVEMENT_IDS.length);
    expect(uebersicht.totalCount).toBe(ACHIEVEMENT_IDS.length);
    expect(uebersicht.unlockedCount).toBe(0);
  });

  it('zeigt bei verschlossenen Abzeichen den Hinweis und danach die Beschreibung', async () => {
    const offen = service();
    const verschlossen = (await offen.achievements.overviewFor(KONTO)).entries.find(
      (eintrag) => eintrag.id === 'grundsteinleger',
    );

    expect(verschlossen?.description).toBe('Lege einen Server an.');
    expect(verschlossen?.unlockedAt).toBeNull();

    const frei = service({ unlocked: ['grundsteinleger'] });
    const freigeschaltet = (await frei.achievements.overviewFor(KONTO)).entries.find(
      (eintrag) => eintrag.id === 'grundsteinleger',
    );

    expect(freigeschaltet?.description).toBe('Du hast deinen ersten Server angelegt.');
    expect(freigeschaltet?.unlockedAt).not.toBeNull();
  });

  it('verrät von einem verschlossenen geheimen Abzeichen weder Namen noch Hinweis', async () => {
    const { achievements } = service();

    const geheim = (await achievements.overviewFor(KONTO)).entries.find(
      (eintrag) => eintrag.id === 'nachtschicht',
    );

    expect(geheim?.secret).toBe(true);
    expect(geheim?.name).toBe('');
    expect(geheim?.description).toBe('');
    expect(geheim?.title).toBeNull();
  });

  it('gibt ein freigeschaltetes Geheimnis vollständig preis', async () => {
    const { achievements } = service({ unlocked: ['nachtschicht'] });

    const geheim = (await achievements.overviewFor(KONTO)).entries.find(
      (eintrag) => eintrag.id === 'nachtschicht',
    );

    expect(geheim?.secret).toBe(false);
    expect(geheim?.name).toBe('Nachtschicht');
    expect(geheim?.title).toBe('Nachtschicht');
  });

  it('leitet die Stufe aus der Zahl der Abzeichen ab', async () => {
    const { achievements } = service({ unlocked: ['grundsteinleger', 'doppelgaenger'] });

    const uebersicht = await achievements.overviewFor(KONTO);

    expect(uebersicht.unlockedCount).toBe(2);
    expect(uebersicht.level.label).toBe('Eingelebt');
    expect(uebersicht.nextLevel?.label).toBe('Stammgast');
  });

  it('bietet nur Titel aus freigeschalteten Abzeichen an', async () => {
    const { achievements } = service({ unlocked: ['nachtschicht', 'grundsteinleger'] });

    const uebersicht = await achievements.overviewFor(KONTO);

    // `grundsteinleger` bringt keinen Titel mit und taucht deshalb nicht auf.
    expect(uebersicht.availableTitles).toEqual([
      { achievementId: 'nachtschicht', title: 'Nachtschicht' },
    ]);
    expect(uebersicht.permissions.canChooseTitle).toBe(true);
  });

  it('meldet ohne Titel-Abzeichen, dass es nichts zu wählen gibt', async () => {
    const { achievements } = service({ unlocked: ['grundsteinleger'] });

    const uebersicht = await achievements.overviewFor(KONTO);

    expect(uebersicht.availableTitles).toEqual([]);
    expect(uebersicht.permissions.canChooseTitle).toBe(false);
    expect(uebersicht.selectedTitle).toBeNull();
  });

  it('übergeht eine gespeicherte Kennung, die der Katalog nicht kennt', async () => {
    /*
     * Kann im Betrieb nur nach einem Rückbau entstehen – die Übersicht läuft
     * über den Katalog und nicht über die Zeilen, deshalb sprengt so eine
     * Zeile nichts.
     */
    const { achievements } = service({
      unlocked: ['grundsteinleger', 'gibtsNichtMehr' as (typeof ACHIEVEMENT_IDS)[number]],
    });

    const uebersicht = await achievements.overviewFor(KONTO);

    expect(uebersicht.entries).toHaveLength(ACHIEVEMENTS.length);
    expect(uebersicht.unlockedCount).toBe(1);
  });
});

describe('Titel wählen', () => {
  it('trägt einen freigeschalteten Titel ein und liefert die neue Übersicht', async () => {
    const { achievements, repository } = service({ unlocked: ['nachtschicht'] });

    const uebersicht = await achievements.chooseTitle(KONTO, 'nachtschicht');

    expect(uebersicht.selectedTitle).toEqual({
      achievementId: 'nachtschicht',
      title: 'Nachtschicht',
    });
    expect(await repository.selectedTitle(KONTO)).toBe('nachtschicht');
  });

  it('legt den Titel mit `null` wieder ab', async () => {
    const { achievements } = service({ unlocked: ['nachtschicht'], selectedTitle: 'nachtschicht' });

    const uebersicht = await achievements.chooseTitle(KONTO, null);

    expect(uebersicht.selectedTitle).toBeNull();
  });

  it('lehnt einen Titel ab, dessen Abzeichen nicht freigeschaltet ist', async () => {
    const { achievements, repository } = service();

    await expect(achievements.chooseTitle(KONTO, 'nachtschicht')).rejects.toMatchObject({
      code: 'ACHIEVEMENT_NOT_UNLOCKED',
    });
    // Nichts geschrieben – die Ablehnung ist vollständig.
    expect(repository.zugriffe.setSelectedTitle).toBeUndefined();
  });

  it('lehnt ein freigeschaltetes Abzeichen ohne Titel ab', async () => {
    const { achievements } = service({ unlocked: ['grundsteinleger'] });

    const fehler = await achievements
      .chooseTitle(KONTO, 'grundsteinleger')
      .catch((e: unknown) => e);

    expect(fehler).toBeInstanceOf(AchievementError);
    expect(fehler).toMatchObject({ code: 'ACHIEVEMENT_WITHOUT_TITLE' });
  });
});

describe('Vergabe', () => {
  it('schaltet ein Abzeichen frei, wenn seine Bedingung erfüllt ist', async () => {
    const { achievements, repository } = service();

    const neu = await achievements.evaluate(KONTO, 'server.created');

    expect(neu).toContain('grundsteinleger');
    expect(repository.vergeben).toContain('grundsteinleger');
  });

  it('vergibt dasselbe Abzeichen kein zweites Mal', async () => {
    const { achievements, repository } = service({ unlocked: ['grundsteinleger'] });

    const neu = await achievements.evaluate(KONTO, 'server.created');

    expect(neu).not.toContain('grundsteinleger');
    expect(repository.vergeben).toEqual([]);
  });

  it('prüft bereits freigeschaltete Regeln gar nicht erst nach', async () => {
    // Jede übersprungene Regel spart eine Zählung über dem Audit-Log.
    const { achievements, repository } = service({
      unlocked: ['grundsteinleger', 'flottenkommando', 'nachtschicht', 'hausmeisterei'],
    });

    await achievements.evaluate(KONTO, 'server.created');

    expect(repository.zugriffe.countAuditEntries).toBeUndefined();
    expect(repository.zugriffe.award).toBeUndefined();
  });

  it('schreibt auch dann nicht, wenn zwar geprüft wurde, aber nichts fällig ist', async () => {
    const { achievements, repository } = service();

    // Mittags – `nachtschicht` greift nicht, `flottenkommando` erst ab fünf.
    await achievements.evaluate(KONTO, 'auth.loginSucceeded', {
      at: new Date('2026-09-21T12:00:00Z'),
    });

    expect(repository.vergeben).toEqual([]);
    expect(repository.zugriffe.award).toBeUndefined();
  });

  it('schaltet nach einem Arcade-Ergebnis die Spielhallen-Abzeichen frei', async () => {
    const { achievements } = service({ arcadeRounds: { kriechpfad: 1 }, topOf: ['kriechpfad'] });

    const neu = await achievements.evaluateArcade(KONTO, 'kriechpfad');

    expect(neu).toEqual(expect.arrayContaining(['eingeworfen', 'spielhallenlegende']));
    expect(neu).not.toContain('alleskoenner');
  });
});

describe('Vergabe wirft nie', () => {
  /**
   * Die wichtigste Zusicherung des Moduls: Ein Abzeichen hängt an einem
   * Vorgang, der gerade gelungen ist. Scheitert die Prüfung, ist das kein
   * Grund, dem Nutzer einen gelungenen Vorgang als fehlgeschlagen zu melden.
   */
  function kaputtesRepository(): AchievementRepository {
    const repository = fakeAchievementRepository();

    return {
      ...repository,
      unlocked: () => Promise.reject(new Error('Datenbank weg')),
    };
  }

  it('verschluckt einen Fehler beim Prüfen und meldet nichts Neues', async () => {
    const achievements = createAchievementService({ repository: kaputtesRepository() });

    await expect(achievements.evaluate(KONTO, 'server.created')).resolves.toEqual([]);
  });

  it('verschluckt ihn auch auf dem Arcade-Weg', async () => {
    const achievements = createAchievementService({ repository: kaputtesRepository() });

    await expect(achievements.evaluateArcade(KONTO, 'kriechpfad')).resolves.toEqual([]);
  });

  it('meldet den verschluckten Fehler aber am Logger', async () => {
    const warn = vi.fn();
    const achievements = createAchievementService({
      repository: kaputtesRepository(),
      logger: { warn },
    });

    await achievements.evaluate(KONTO, 'server.created');

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ userId: KONTO });
  });

  it('bleibt ohne Logger still, statt zu scheitern', async () => {
    const achievements = createAchievementService({ repository: kaputtesRepository() });

    await expect(achievements.evaluate(KONTO, 'server.created')).resolves.toEqual([]);
  });
});
