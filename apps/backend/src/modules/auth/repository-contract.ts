/**
 * Gemeinsame Zusicherungen des {@link AuthRepository} – **nur für Tests**
 * (Audit-Maßnahme W3-12, `test-gaps-07`).
 *
 * ## Warum es diese Datei gibt
 *
 * Die Auth-Regeln sind dicht getestet – aber gegen `test-doubles.ts`, nicht
 * gegen SQL. Jede Regel, die ein Dienst-Test „beweist", ist damit nur gegen die
 * **Semantik der Attrappe** bewiesen. Wo beide auseinanderlaufen, ist der Test
 * grün und der Betrieb kaputt (oder umgekehrt: ein Fehlerpfad, den die
 * Datenbank auslöst, bleibt ungetestet, weil die Attrappe ihn nie erreicht).
 *
 * Diese Suite formuliert die Zusicherungen deshalb **einmal** und lässt sie
 * zweimal laufen:
 *
 * - gegen `createFakeAuthRepository()` in `repository-contract.test.ts` –
 *   läuft immer, auch ohne Datenbank;
 * - gegen `createDrizzleAuthRepository(db)` in `repository.db.test.ts` –
 *   innerhalb von `describeDatenbank`, also nur mit `DATABASE_URL` **und**
 *   `PALANTIR_TEST_DB=1` (Harness aus W2-28).
 *
 * ## Was hier steht und was nicht
 *
 * Aufgenommen sind ausschließlich Zusicherungen, die **beide** Seiten halten
 * müssen, weil ein Dienst sich auf sie verlässt: die Groß-/Kleinschreibung der
 * Anmeldekennung, die Eindeutigkeits-Sperren samt SQLSTATE, das bedingte
 * Rotieren, die Reihenfolge der Sitzungsliste, das Kaskadieren beim Löschen.
 *
 * Bewusst **nicht** aufgenommen: alles, was von der Ablage abhängt statt vom
 * Vertrag – erzeugte Ids, `createdAt` (die Attrappe setzt einen festen Wert),
 * die Genauigkeit von Zeitstempeln.
 *
 * @param baueRepository Liefert für **jeden** Testfall ein frisches, leeres
 *   Repository. Wird erst innerhalb von `it()` aufgerufen: Im DB-Fall steht die
 *   Wegwerf-Datenbank vorher noch nicht bereit.
 */

import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../../db/errors.js';
import type { AuthRepository } from './types.js';

const STUNDE = 60 * 60 * 1000;

/** Fabrik für ein frisches Repository je Testfall. */
export type AuthRepositoryFabrik = () => Promise<AuthRepository> | AuthRepository;

/**
 * Hängt die gemeinsamen Zusicherungen in die umgebende Suite.
 *
 * Kein eigenes `describeDatenbank`/`describe` um den gesamten Satz: Der Aufrufer
 * entscheidet, in welchem Rahmen (und ob übersprungen) sie laufen.
 */
export function describeAuthRepositoryContract(baueRepository: AuthRepositoryFabrik): void {
  const repo = async (): Promise<AuthRepository> => baueRepository();

  describe('Vertrag: Anmeldekennung', () => {
    it('findet ein Konto ohne Rücksicht auf die Groß-/Kleinschreibung', async () => {
      /*
       * Die Attrappe vergleicht mit `toLowerCase()`, die Datenbank über den
       * Index `users_username_lower_idx`. Beide müssen dieselbe Antwort geben,
       * sonst meldet sich ein Konto lokal an und in der Produktion nicht.
       */
      const repository = await repo();
      await repository.createUser({ username: 'Spielerin', displayName: 'Spielerin' });

      expect((await repository.findUserByUsername('spielerin'))?.username).toBe('Spielerin');
      expect((await repository.findUserByUsername('SPIELERIN'))?.username).toBe('Spielerin');
      expect(await repository.usernameExists('sPiElErIn')).toBe(true);
      expect(await repository.findUserByUsername('jemandanderes')).toBeNull();
      expect(await repository.usernameExists('jemandanderes')).toBe(false);
    });

    it('lehnt eine zweite Kennung ab, die sich nur in der Schreibweise unterscheidet', async () => {
      const repository = await repo();
      await repository.createUser({ username: 'Doppelt', displayName: 'Doppelt' });

      await expect(
        repository.createUser({ username: 'doppelt', displayName: 'Doppelt zwei' }),
      ).rejects.toSatisfy(isUniqueViolation);
    });

    it('meldet den Konflikt als SQLSTATE 23505, nicht als beliebigen Fehler', async () => {
      /*
       * `AuthService.register` fängt genau diesen Fehler ab (`isUniqueViolation`)
       * und antwortet mit `AUTH_USERNAME_TAKEN` statt mit einem 500. Eine
       * Attrappe, die irgendeinen `Error` wirft, ließe diesen Zweig ungetestet.
       */
      const repository = await repo();
      await repository.createUser({ username: 'kollision', displayName: 'Erster' });

      const fehler = await repository
        .createUser({ username: 'Kollision', displayName: 'Zweiter' })
        .then(
          () => null,
          (thrown: unknown) => thrown,
        );

      expect(fehler).not.toBeNull();
      expect(isUniqueViolation(fehler)).toBe(true);
    });

    it('lässt beliebig viele Konten ohne Kennung zu', async () => {
      // Reine Provider-Konten haben keine Anmeldekennung; der Unique-Index ist
      // deshalb partiell (`where username is not null`). Ein voller Index
      // ließe nur ein einziges Discord-Konto zu.
      const repository = await repo();

      await repository.createUser({ username: null, displayName: 'Aus Discord' });
      await repository.createUser({ username: null, displayName: 'Aus Twitch' });

      expect(await repository.findUserByUsername('')).toBeNull();
    });

    it('sperrt eine bereits vergebene Kennung auch beim Nachtragen', async () => {
      /*
       * `linkPassword` trägt die Kennung nachträglich ein und übersetzt einen
       * Unique-Fehler in `AUTH_USERNAME_TAKEN` (Audit W2-9). Ohne dieselbe
       * Sperre in der Attrappe bliebe dieser Zweig unbelegt – und ein
       * Provider-Konto könnte sich lokal die Kennung eines fremden Kontos
       * geben.
       */
      const repository = await repo();
      await repository.createUser({ username: 'besetzt', displayName: 'Erster' });
      const zweiter = await repository.createUser({ username: null, displayName: 'Zweiter' });

      const fehler = await repository.setUsername(zweiter.id, 'Besetzt').then(
        () => null,
        (thrown: unknown) => thrown,
      );

      expect(isUniqueViolation(fehler)).toBe(true);
      expect((await repository.findUserByUsername('besetzt'))?.displayName).toBe('Erster');
    });

    it('trägt eine freie Kennung nach und ändert den Anzeigenamen', async () => {
      const repository = await repo();
      const nutzer = await repository.createUser({ username: null, displayName: 'Aus Discord' });

      expect((await repository.setUsername(nutzer.id, 'frisch')).username).toBe('frisch');
      expect((await repository.setDisplayName(nutzer.id, 'Neuer Name')).displayName).toBe(
        'Neuer Name',
      );
      // Der Anzeigename ist bewusst **nicht** eindeutig.
      const zweiter = await repository.createUser({ username: null, displayName: 'Neuer Name' });
      expect(zweiter.displayName).toBe('Neuer Name');
    });

    it('gibt die Kennung mit `null` wieder frei', async () => {
      /*
       * `unlinkMethod('password')` setzt die Kennung auf `null`, damit sie nicht
       * dauerhaft für alle gesperrt bleibt (Audit backend-auth-04). Der Vertrag
       * verlangt zweierlei: Das eigene Konto verliert sie, und ein **anderes**
       * Konto darf sie danach bekommen. Eine Attrappe, die den Wert nur im
       * eigenen Datensatz löscht, aber ihren Eindeutigkeits-Nachbau weiter auf
       * dem alten Namen stehen ließe, meldete hier fälschlich einen Konflikt.
       */
      const repository = await repo();
      const erster = await repository.createUser({ username: 'geteilt', displayName: 'Erster' });

      expect((await repository.setUsername(erster.id, null)).username).toBeNull();
      expect(await repository.findUserByUsername('geteilt')).toBeNull();
      expect(await repository.usernameExists('geteilt')).toBe(false);

      const zweiter = await repository.createUser({ username: 'geteilt', displayName: 'Zweiter' });
      expect((await repository.findUserByUsername('geteilt'))?.id).toBe(zweiter.id);
    });
  });

  describe('Vertrag: Owner-Sonderstatus', () => {
    it('lässt genau ein Owner-Konto zu', async () => {
      const repository = await repo();
      const erster = await repository.createUser({ username: 'owner', displayName: 'Owner' });
      const zweiter = await repository.createUser({ username: 'zweiter', displayName: 'Zweiter' });

      expect(await repository.findOwner()).toBeNull();
      expect((await repository.setOwner(erster.id)).isOwner).toBe(true);
      expect((await repository.findOwner())?.id).toBe(erster.id);

      // Der partielle Index `users_single_owner_idx` – kein zweiter Owner.
      await expect(repository.setOwner(zweiter.id)).rejects.toThrow();
      expect((await repository.findOwner())?.id).toBe(erster.id);
    });
  });

  describe('Vertrag: Login-Methoden', () => {
    it('führt je Konto höchstens eine Methode pro Typ', async () => {
      const repository = await repo();
      const nutzer = await repository.createUser({ username: 'methoden', displayName: 'M' });

      await repository.createAuthMethod({
        userId: nutzer.id,
        type: 'password',
        passwordHash: '$argon2id$attrappe',
      });

      // `auth_methods_user_type_idx`.
      await expect(
        repository.createAuthMethod({
          userId: nutzer.id,
          type: 'password',
          passwordHash: '$argon2id$zweitens',
        }),
      ).rejects.toThrow();
      expect(await repository.listAuthMethods(nutzer.id)).toHaveLength(1);
    });

    it('legt eine neue Methode mit den Vorgaben aus dem Vertrag an', async () => {
      const repository = await repo();
      const nutzer = await repository.createUser({ username: 'vorgaben', displayName: 'V' });

      const methode = await repository.createAuthMethod({
        userId: nutzer.id,
        type: 'password',
        passwordHash: '$argon2id$attrappe',
      });

      // Nicht angegebene Felder stehen auf ihrem Vorgabewert, nicht auf
      // `undefined`: `AccountDto` reicht sie unverändert nach außen.
      expect(methode.mustChangePassword).toBe(false);
      expect(methode.providerUserId).toBeNull();
      expect(methode.providerDisplayName).toBeNull();
      expect(methode.providerAvatarUrl).toBeNull();
      expect(methode.totpSecret).toBeNull();
      expect(methode.totpConfirmedAt).toBeNull();
      expect(methode.lastUsedAt).toBeNull();
    });

    it('findet eine Provider-Methode nur unter ihrem eigenen Anbieter', async () => {
      const repository = await repo();
      const nutzer = await repository.createUser({ username: null, displayName: 'Aus Discord' });

      await repository.createAuthMethod({
        userId: nutzer.id,
        type: 'discord',
        providerUserId: 'konto-42',
        providerDisplayName: 'Spielerin#0001',
      });

      expect((await repository.findAuthMethodByProvider('discord', 'konto-42'))?.userId).toBe(
        nutzer.id,
      );
      // Dieselbe Id bei einem anderen Anbieter ist ein anderes Konto.
      expect(await repository.findAuthMethodByProvider('twitch', 'konto-42')).toBeNull();
      expect(await repository.findAuthMethodByProvider('discord', 'konto-43')).toBeNull();
    });

    it('ändert beim Aktualisieren nur die angegebenen Felder', async () => {
      /*
       * Die 2FA-Einrichtung schreibt `totpSecret`, der erzwungene Wechsel
       * `mustChangePassword`. Würde ein nicht angegebenes Feld dabei auf `null`
       * fallen, verlöre ein Konto beim Bestätigen der 2FA sein Passwort.
       */
      const repository = await repo();
      const nutzer = await repository.createUser({ username: 'update', displayName: 'U' });
      const methode = await repository.createAuthMethod({
        userId: nutzer.id,
        type: 'password',
        passwordHash: '$argon2id$original',
        mustChangePassword: true,
      });

      const bestaetigt = new Date('2026-09-01T12:00:00.000Z');
      const geaendert = await repository.updateAuthMethod(methode.id, {
        totpSecret: 'GEHEIM',
        totpConfirmedAt: bestaetigt,
      });

      expect(geaendert.totpSecret).toBe('GEHEIM');
      expect(geaendert.totpConfirmedAt?.getTime()).toBe(bestaetigt.getTime());
      expect(geaendert.passwordHash).toBe('$argon2id$original');
      expect(geaendert.mustChangePassword).toBe(true);

      // Und `null` als ausdrücklicher Wert löscht das Geheimnis wieder
      // (Admin-Rücksetzung der 2FA).
      const zurueck = await repository.updateAuthMethod(methode.id, {
        totpSecret: null,
        totpConfirmedAt: null,
      });
      expect(zurueck.totpSecret).toBeNull();
      expect(zurueck.totpConfirmedAt).toBeNull();
      expect(zurueck.passwordHash).toBe('$argon2id$original');
    });

    it('entfernt eine Methode, ohne die übrigen anzurühren', async () => {
      const repository = await repo();
      const nutzer = await repository.createUser({ username: 'trennen', displayName: 'T' });
      const passwort = await repository.createAuthMethod({
        userId: nutzer.id,
        type: 'password',
        passwordHash: '$argon2id$attrappe',
      });
      await repository.createAuthMethod({
        userId: nutzer.id,
        type: 'discord',
        providerUserId: 'konto-7',
      });

      await repository.deleteAuthMethod(passwort.id);

      expect(await repository.findAuthMethod(nutzer.id, 'password')).toBeNull();
      expect((await repository.listAuthMethods(nutzer.id)).map((m) => m.type)).toEqual(['discord']);
    });
  });

  describe('Vertrag: Sitzungen', () => {
    /** Legt eine Sitzung mit Vorgaben an. */
    const lege = async (
      repository: AuthRepository,
      userId: string,
      hash: string,
      ablaufIn = STUNDE,
    ) =>
      repository.createSession({
        userId,
        refreshTokenHash: hash,
        deviceInfo: null,
        ipHint: null,
        expiresAt: new Date(Date.now() + ablaufIn),
      });

    it('legt eine Sitzung ohne Rotationsspuren an', async () => {
      const repository = await repo();
      const nutzer = await repository.createUser({ username: 'sitzung', displayName: 'S' });

      const sitzung = await lege(repository, nutzer.id, 'hash-neu');

      // `withinRotationGrace` verlangt `rotatedAt !== null`; eine Attrappe, die
      // hier schon einen Zeitstempel setzte, öffnete die Kulanzfrist für nie
      // rotierte Sitzungen.
      expect(sitzung.rotatedAt).toBeNull();
      expect(sitzung.previousRefreshTokenHash).toBeNull();
      expect(sitzung.revokedAt).toBeNull();
      expect((await repository.findSessionByTokenHash('hash-neu'))?.id).toBe(sitzung.id);
      expect(await repository.findSessionByTokenHash('unbekannt')).toBeNull();
    });

    it('rotiert nur, solange der vorgelegte Hash noch der aktuelle ist', async () => {
      const repository = await repo();
      const nutzer = await repository.createUser({ username: 'rotation', displayName: 'R' });
      const sitzung = await lege(repository, nutzer.id, 'hash-1');
      const jetzt = new Date();

      const rotiert = await repository.rotateSession(sitzung.id, {
        refreshTokenHash: 'hash-2',
        previousRefreshTokenHash: 'hash-1',
        expiresAt: new Date(jetzt.getTime() + 2 * STUNDE),
        lastUsedAt: jetzt,
        rotatedAt: jetzt,
      });

      expect(rotiert?.refreshTokenHash).toBe('hash-2');
      expect(rotiert?.previousRefreshTokenHash).toBe('hash-1');
      expect(rotiert?.rotatedAt).not.toBeNull();

      // Zweiter Versuch mit dem inzwischen ersetzten Hash: `null`, kein Fehler –
      // der Aufrufer entscheidet, ob er es noch einmal versucht.
      const nochmal = await repository.rotateSession(sitzung.id, {
        refreshTokenHash: 'hash-3',
        previousRefreshTokenHash: 'hash-1',
        expiresAt: new Date(jetzt.getTime() + 3 * STUNDE),
        lastUsedAt: jetzt,
        rotatedAt: jetzt,
      });

      expect(nochmal).toBeNull();
      expect((await repository.findSessionById(sitzung.id))?.refreshTokenHash).toBe('hash-2');
      expect((await repository.findSessionByPreviousTokenHash('hash-1'))?.id).toBe(sitzung.id);
    });

    it('lässt von zwei gleichzeitigen Rotationen nur eine gewinnen', async () => {
      const repository = await repo();
      const nutzer = await repository.createUser({ username: 'rennen', displayName: 'R' });
      const sitzung = await lege(repository, nutzer.id, 'gleichzeitig-0');
      const jetzt = new Date();

      const rotation = (neu: string): Promise<unknown> =>
        repository.rotateSession(sitzung.id, {
          refreshTokenHash: neu,
          previousRefreshTokenHash: 'gleichzeitig-0',
          expiresAt: new Date(jetzt.getTime() + 2 * STUNDE),
          lastUsedAt: jetzt,
          rotatedAt: jetzt,
        });

      const ergebnisse = await Promise.all([rotation('a'), rotation('b')]);

      expect(ergebnisse.filter((ergebnis) => ergebnis !== null)).toHaveLength(1);
    });

    it('listet nur gültige Sitzungen und die zuletzt benutzte zuerst', async () => {
      /*
       * Die Reihenfolge steht im Vertrag (`AuthRepository.listActiveSessions`:
       * „neueste zuerst") und trägt die Sitzungsübersicht in F1. Das SQL sortiert
       * nach `last_used_at desc`; eine Attrappe in Einfügereihenfolge zeigte
       * dieselbe Liste in anderer Ordnung.
       */
      const repository = await repo();
      const nutzer = await repository.createUser({ username: 'liste', displayName: 'L' });
      const jetzt = Date.now();

      const alt = await lege(repository, nutzer.id, 'alt');
      const jung = await lege(repository, nutzer.id, 'jung');
      const abgelaufen = await lege(repository, nutzer.id, 'abgelaufen', -STUNDE);
      const widerrufen = await lege(repository, nutzer.id, 'widerrufen');
      await repository.revokeSession(widerrufen.id, new Date(jetzt));

      // Die zuletzt angelegte Sitzung noch einmal benutzen …
      await repository.rotateSession(jung.id, {
        refreshTokenHash: 'jung-2',
        previousRefreshTokenHash: 'jung',
        expiresAt: new Date(jetzt + 2 * STUNDE),
        lastUsedAt: new Date(jetzt + 60_000),
        rotatedAt: new Date(jetzt + 60_000),
      });

      const aktiv = await repository.listActiveSessions(nutzer.id, jetzt);

      /*
       * … womit sie vor die zuerst angelegte rückt. Genau dieser Unterschied
       * trennt „nach Nutzung sortiert" von „in Einfügereihenfolge geliefert" –
       * ohne ihn wäre die Zusicherung leer.
       */
      expect(aktiv.map((sitzung) => sitzung.id)).toEqual([jung.id, alt.id]);
      expect(aktiv.map((sitzung) => sitzung.id)).not.toContain(abgelaufen.id);
      expect(aktiv.map((sitzung) => sitzung.id)).not.toContain(widerrufen.id);
    });

    it('widerruft eine einzelne Sitzung und danach alle offenen', async () => {
      const repository = await repo();
      const nutzer = await repository.createUser({ username: 'widerruf', displayName: 'W' });
      const jetzt = Date.now();
      const eine = await lege(repository, nutzer.id, 'eine');
      await lege(repository, nutzer.id, 'andere');

      await repository.revokeSession(eine.id, new Date(jetzt));
      expect(
        (await repository.listActiveSessions(nutzer.id, jetzt)).map((s) => s.id),
      ).not.toContain(eine.id);

      const zuerst = (await repository.findSessionById(eine.id))?.revokedAt;

      // Ein zweiter Widerruf verschiebt den Zeitpunkt nicht (`is null`-Filter).
      await repository.revokeAllSessions(nutzer.id, new Date(jetzt + STUNDE));
      expect((await repository.findSessionById(eine.id))?.revokedAt?.getTime()).toBe(
        zuerst?.getTime(),
      );
      expect(await repository.listActiveSessions(nutzer.id, jetzt)).toEqual([]);
    });

    it('hält die Sitzungen zweier Konten auseinander', async () => {
      const repository = await repo();
      const jetzt = Date.now();
      const einer = await repository.createUser({ username: 'einer', displayName: 'E' });
      const anderer = await repository.createUser({ username: 'anderer', displayName: 'A' });
      await lege(repository, einer.id, 'seine');
      const fremde = await lege(repository, anderer.id, 'fremde');

      await repository.revokeAllSessions(einer.id, new Date(jetzt));

      expect((await repository.listActiveSessions(anderer.id, jetzt)).map((s) => s.id)).toEqual([
        fremde.id,
      ]);
    });
  });

  describe('Vertrag: Konto löschen', () => {
    it('zählt für ein Konto ohne Server und Sicherungen überall null', async () => {
      const repository = await repo();
      const nutzer = await repository.createUser({ username: 'frei', displayName: 'F' });

      expect(await repository.countAccountBlockers(nutzer.id)).toEqual({
        servers: 0,
        backups: 0,
        activeBackups: 0,
      });
    });

    it('nimmt Login-Methoden und Sitzungen mit (ON DELETE CASCADE)', async () => {
      const repository = await repo();
      const nutzer = await repository.createUser({ username: 'weg', displayName: 'W' });
      await repository.createAuthMethod({
        userId: nutzer.id,
        type: 'password',
        passwordHash: '$argon2id$attrappe',
      });
      await repository.createSession({
        userId: nutzer.id,
        refreshTokenHash: 'kaskade',
        deviceInfo: null,
        ipHint: null,
        expiresAt: new Date(Date.now() + STUNDE),
      });

      await repository.deleteUser(nutzer.id);

      expect(await repository.findUserById(nutzer.id)).toBeNull();
      expect(await repository.listAuthMethods(nutzer.id)).toEqual([]);
      expect(await repository.findSessionByTokenHash('kaskade')).toBeNull();
    });

    it('lässt fremde Konten unberührt', async () => {
      const repository = await repo();
      const weg = await repository.createUser({ username: 'weg', displayName: 'W' });
      const bleibt = await repository.createUser({ username: 'bleibt', displayName: 'B' });
      await repository.createSession({
        userId: bleibt.id,
        refreshTokenHash: 'bleibt',
        deviceInfo: null,
        ipHint: null,
        expiresAt: new Date(Date.now() + STUNDE),
      });

      await repository.deleteUser(weg.id);

      expect((await repository.findUserById(bleibt.id))?.username).toBe('bleibt');
      expect(await repository.findSessionByTokenHash('bleibt')).not.toBeNull();
    });
  });
}
