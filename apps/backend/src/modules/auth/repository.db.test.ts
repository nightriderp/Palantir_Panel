/**
 * Auth-Repository gegen echtes SQL (Audit-Maßnahme W2-28, `test-gaps-05`).
 *
 * `service.test.ts` deckt die Auth-Regeln gegen eine Attrappe ab, die
 * Groß-/Kleinschreibung mit `toLowerCase()` vergleicht und Sitzungen in einer
 * Map hält. In der Datenbank hängt dieselbe Zusicherung an einem partiellen
 * Unique-Index auf `lower(username)` und an einem bedingten `UPDATE` – beides
 * ist bis hierher nie ausgeführt worden.
 *
 * Am Ende der Datei läuft zusätzlich die **gemeinsame Vertrags-Suite**
 * (`repository-contract.ts`, Audit W3-12 / `test-gaps-07`) gegen dieses
 * Repository – dieselben Erwartungen, die `repository-contract.test.ts` an die
 * Attrappe stellt. Läuft eine Seite grün und die andere rot, sind Attrappe und
 * Produktion auseinandergelaufen.
 *
 * Läuft nur mit `DATABASE_URL` **und** `PALANTIR_TEST_DB=1`.
 */

import { expect, it } from 'vitest';
import { describeDatenbank } from '../../test-support/db.js';
import {
  legeNodeAn,
  legeNutzerAn,
  legePasswortMethodeAn,
  legeServerAn,
} from '../../test-support/fixtures.js';
import { backups } from '../../db/schema.js';
import { describeAuthRepositoryContract } from './repository-contract.js';
import { createDrizzleAuthRepository } from './repository.js';

const STUNDE = 60 * 60 * 1000;

describeDatenbank('AuthRepository gegen PostgreSQL', (kontext) => {
  it('findet ein Konto unabhängig von der Groß-/Kleinschreibung', async () => {
    const repository = createDrizzleAuthRepository(kontext.db);
    await repository.createUser({ username: 'Spielerin', displayName: 'Spielerin' });

    expect((await repository.findUserByUsername('spielerin'))?.username).toBe('Spielerin');
    expect((await repository.findUserByUsername('SPIELERIN'))?.username).toBe('Spielerin');
    expect(await repository.usernameExists('sPiElErIn')).toBe(true);
    expect(await repository.findUserByUsername('jemandanderes')).toBeNull();
    expect(await repository.usernameExists('jemandanderes')).toBe(false);
  });

  it('lässt keine zweite Anmeldekennung zu, die sich nur in der Schreibweise unterscheidet', async () => {
    const repository = createDrizzleAuthRepository(kontext.db);
    await repository.createUser({ username: 'Doppelt', displayName: 'Doppelt' });

    // `users_username_lower_idx` – die Datenbank ist die letzte Instanz, auch
    // wenn zwei Registrierungen gleichzeitig durchlaufen.
    await expect(
      repository.createUser({ username: 'doppelt', displayName: 'Doppelt zwei' }),
    ).rejects.toThrow();
  });

  it('lässt nur ein Owner-Konto zu', async () => {
    const repository = createDrizzleAuthRepository(kontext.db);
    const ersterNutzer = await legeNutzerAn(kontext.db);
    const zweiterNutzer = await legeNutzerAn(kontext.db);

    await repository.setOwner(ersterNutzer);

    expect((await repository.findOwner())?.id).toBe(ersterNutzer);
    // `users_single_owner_idx` (partiell auf `is_owner`).
    await expect(repository.setOwner(zweiterNutzer)).rejects.toThrow();
  });

  it('liefert die Login-Methoden eines Kontos und findet sie über den Provider', async () => {
    const repository = createDrizzleAuthRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);

    const passwort = await repository.createAuthMethod({
      userId: nutzer,
      type: 'password',
      passwordHash: '$argon2id$attrappe',
    });
    await repository.createAuthMethod({
      userId: nutzer,
      type: 'discord',
      providerUserId: 'discord-42',
      providerDisplayName: 'Spielerin#0001',
    });

    expect(
      (await repository.listAuthMethods(nutzer)).map((methode) => methode.type).sort(),
    ).toEqual(['discord', 'password']);
    expect((await repository.findAuthMethod(nutzer, 'password'))?.id).toBe(passwort.id);
    expect((await repository.findAuthMethodByProvider('discord', 'discord-42'))?.userId).toBe(
      nutzer,
    );
    expect(await repository.findAuthMethodByProvider('twitch', 'discord-42')).toBeNull();

    const geaendert = await repository.updateAuthMethod(passwort.id, {
      mustChangePassword: true,
      totpSecret: 'GEHEIM',
    });

    expect(geaendert.mustChangePassword).toBe(true);
    expect(geaendert.totpSecret).toBe('GEHEIM');
    // Nicht angegebene Felder bleiben, wie sie waren.
    expect(geaendert.passwordHash).toBe('$argon2id$attrappe');

    await repository.deleteAuthMethod(passwort.id);
    expect(await repository.findAuthMethod(nutzer, 'password')).toBeNull();
  });

  it('rotiert eine Sitzung nur, solange der vorgefundene Hash noch der aktuelle ist', async () => {
    /*
     * Das bedingte `UPDATE` ist der Schutz gegen zwei gleichzeitige
     * Erneuerungen mit demselben Token (backend-auth-02). Ohne Datenbank ließ
     * sich nur die Attrappe prüfen, die die Bedingung nachbaut.
     */
    const repository = createDrizzleAuthRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);
    const jetzt = Date.now();

    const sitzung = await repository.createSession({
      userId: nutzer,
      refreshTokenHash: 'hash-1',
      deviceInfo: 'Testgerät',
      ipHint: '203.0.113.0',
      expiresAt: new Date(jetzt + STUNDE),
    });

    const rotiert = await repository.rotateSession(sitzung.id, {
      refreshTokenHash: 'hash-2',
      previousRefreshTokenHash: 'hash-1',
      expiresAt: new Date(jetzt + 2 * STUNDE),
      lastUsedAt: new Date(jetzt),
      rotatedAt: new Date(jetzt),
    });

    expect(rotiert?.refreshTokenHash).toBe('hash-2');
    expect(rotiert?.previousRefreshTokenHash).toBe('hash-1');

    // Zweiter Versuch mit demselben (inzwischen ersetzten) Token: keine Zeile.
    const nochmal = await repository.rotateSession(sitzung.id, {
      refreshTokenHash: 'hash-3',
      previousRefreshTokenHash: 'hash-1',
      expiresAt: new Date(jetzt + 3 * STUNDE),
      lastUsedAt: new Date(jetzt),
      rotatedAt: new Date(jetzt),
    });

    expect(nochmal).toBeNull();
    expect((await repository.findSessionById(sitzung.id))?.refreshTokenHash).toBe('hash-2');
    expect((await repository.findSessionByPreviousTokenHash('hash-1'))?.id).toBe(sitzung.id);
  });

  it('lässt von zwei gleichzeitigen Rotationen nur eine gewinnen', async () => {
    const repository = createDrizzleAuthRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);
    const jetzt = Date.now();

    const sitzung = await repository.createSession({
      userId: nutzer,
      refreshTokenHash: 'gleichzeitig-0',
      deviceInfo: null,
      ipHint: null,
      expiresAt: new Date(jetzt + STUNDE),
    });

    const rotation = (neuerHash: string): Promise<unknown> =>
      repository.rotateSession(sitzung.id, {
        refreshTokenHash: neuerHash,
        previousRefreshTokenHash: 'gleichzeitig-0',
        expiresAt: new Date(jetzt + 2 * STUNDE),
        lastUsedAt: new Date(jetzt),
        rotatedAt: new Date(jetzt),
      });

    const ergebnisse = await Promise.all([rotation('gleichzeitig-a'), rotation('gleichzeitig-b')]);

    expect(ergebnisse.filter((ergebnis) => ergebnis !== null)).toHaveLength(1);
  });

  it('listet nur gültige Sitzungen, neueste zuerst', async () => {
    const repository = createDrizzleAuthRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);
    const jetzt = Date.now();

    const gueltig = await repository.createSession({
      userId: nutzer,
      refreshTokenHash: 'gueltig',
      deviceInfo: null,
      ipHint: null,
      expiresAt: new Date(jetzt + STUNDE),
    });
    const abgelaufen = await repository.createSession({
      userId: nutzer,
      refreshTokenHash: 'abgelaufen',
      deviceInfo: null,
      ipHint: null,
      expiresAt: new Date(jetzt - STUNDE),
    });
    const widerrufen = await repository.createSession({
      userId: nutzer,
      refreshTokenHash: 'widerrufen',
      deviceInfo: null,
      ipHint: null,
      expiresAt: new Date(jetzt + STUNDE),
    });

    await repository.revokeSession(widerrufen.id, new Date(jetzt));

    const aktiv = await repository.listActiveSessions(nutzer, jetzt);

    expect(aktiv.map((sitzung) => sitzung.id)).toEqual([gueltig.id]);
    expect(aktiv.map((sitzung) => sitzung.id)).not.toContain(abgelaufen.id);

    await repository.revokeAllSessions(nutzer, new Date(jetzt));
    expect(await repository.listActiveSessions(nutzer, jetzt)).toEqual([]);
  });

  it('zählt Server und Sicherungen, die einer Kontolöschung im Weg stehen', async () => {
    const repository = createDrizzleAuthRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);

    await legeServerAn(kontext.db, { ownerId: nutzer, hostId: node });
    await kontext.db.insert(backups).values([
      { ownerId: nutzer, type: 'manual', status: 'completed' },
      { ownerId: nutzer, type: 'automatic', status: 'running' },
      { ownerId: nutzer, type: 'manual', status: 'pending' },
    ]);

    const blocker = await repository.countAccountBlockers(nutzer);

    expect(blocker.servers).toBe(1);
    expect(blocker.backups).toBe(3);
    // `count(*) filter (where status in ('pending','running'))`
    expect(blocker.activeBackups).toBe(2);
  });

  it('nimmt Login-Methoden und Sitzungen mit, wenn das Konto verschwindet', async () => {
    const repository = createDrizzleAuthRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);
    await legePasswortMethodeAn(kontext.db, nutzer);
    await repository.createSession({
      userId: nutzer,
      refreshTokenHash: 'kaskade',
      deviceInfo: null,
      ipHint: null,
      expiresAt: new Date(Date.now() + STUNDE),
    });

    await repository.deleteUser(nutzer);

    expect(await repository.findUserById(nutzer)).toBeNull();
    // ON DELETE CASCADE an `auth_methods` und `sessions` (Pflichtenheft §6).
    expect(await repository.listAuthMethods(nutzer)).toEqual([]);
    expect(await repository.findSessionByTokenHash('kaskade')).toBeNull();
  });

  it('lässt ein Konto mit Server nicht löschen (ON DELETE RESTRICT)', async () => {
    const repository = createDrizzleAuthRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);
    await legeServerAn(kontext.db, { ownerId: nutzer, hostId: node });

    // Genau der Fremdschlüsselfehler, den `countAccountBlockers` vorher abfängt.
    await expect(repository.deleteUser(nutzer)).rejects.toThrow();
  });

  it('ändert Anmeldekennung und Anzeigename', async () => {
    const repository = createDrizzleAuthRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db, { username: 'vorher' });

    expect((await repository.setUsername(nutzer, 'nachher')).username).toBe('nachher');
    expect((await repository.setDisplayName(nutzer, 'Neuer Name')).displayName).toBe('Neuer Name');
  });

  /*
   * Die gemeinsame Vertrags-Suite. `kontext.db` steht erst innerhalb eines
   * Testfalls bereit – deshalb eine Fabrik und kein fertiges Repository.
   */
  describeAuthRepositoryContract(() => createDrizzleAuthRepository(kontext.db));
});
