/**
 * Benachrichtigungs-Repository gegen echtes SQL (Fundpunkt 234).
 *
 * 996 Zeilen Datenzugriff, geprüft bisher nur über die Attrappe aus
 * `test-doubles.ts`. Die trägt ihre eigene Semantik – und genau die
 * nicht-trivialen Konstrukte bildet sie gar nicht ab:
 *
 * - die **Transaktion** von `publishAnnouncement()`: Ankündigung, Inbox-Zeilen
 *   und Audit-Eintrag gelten gemeinsam oder gar nicht (Fundpunkt 150),
 * - der **Unique-Index** `notifications_announcement_user_idx`, der eine
 *   Ankündigung je Konto nur einmal zulässt,
 * - `markRead` mit seiner doppelten Einschränkung (nur eigene Meldungen, nur
 *   die, die noch nicht im Zielzustand stehen),
 * - die **Fristen** des Kehraus (Fundpunkt 230) – gelesene Meldungen und
 *   abgeschlossene Zustellversuche, ungelesene und laufende nicht,
 * - die **Kaskade** von `announcements` auf `notifications`,
 * - und die Auslegung „freigeschaltet" in `listActiveUserIds()`, die über einen
 *   `exists`-Unterabfrage auf Rollen entsteht.
 *
 * Läuft nur mit `DATABASE_URL` **und** `PALANTIR_TEST_DB=1`.
 */

import { GUEST_ROLE_NAME } from '@palantir/contracts';
import { expect, it } from 'vitest';
import { notificationDeliveries, notifications } from '../../db/schema.js';
import { describeDatenbank } from '../../test-support/db.js';
import { legeNutzerAn, legeRolleAn, weiseRolleZu } from '../../test-support/fixtures.js';
import {
  type CreateNotificationData,
  createDrizzleNotificationRepository,
  createDrizzleRecipientDirectory,
} from './repository.js';

/** Meldung mit den Pflichtfeldern; der Test setzt nur, worauf er zielt. */
function meldung(
  userId: string,
  ueberschreibung: Partial<CreateNotificationData> = {},
): CreateNotificationData {
  return {
    userId,
    event: 'server.started',
    severity: 'info',
    title: 'Server gestartet',
    body: 'Welt läuft wieder.',
    subjectType: null,
    subjectId: null,
    subjectName: null,
    data: {},
    ruleId: null,
    announcementId: null,
    ...ueberschreibung,
  };
}

describeDatenbank('Benachrichtigungs-Repository gegen PostgreSQL', (kontext) => {
  // -- Kanäle und Regeln ----------------------------------------------------

  it('findet einen Kanal ohne Rücksicht auf Groß- und Kleinschreibung', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    await repository.createChannel({
      name: 'Betrieb',
      type: 'discordWebhook',
      webhookUrl: null,
      username: null,
      enabled: true,
    });

    expect((await repository.findChannelByName('BETRIEB'))?.name).toBe('Betrieb');
    expect(await repository.findChannelByName('Betriebe')).toBeNull();
  });

  it('hält den Zustellstand am Kanal fest, ohne ihn zu bearbeiten', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const kanal = await repository.createChannel({
      name: 'Betrieb',
      type: 'discordWebhook',
      webhookUrl: null,
      username: null,
      enabled: true,
    });

    await repository.recordChannelOutcome(kanal.id, {
      status: 'failed',
      code: 'NOTIFICATION_DELIVERY_FAILED',
      message: 'Discord antwortet nicht.',
    });
    const nachFehlschlag = await repository.findChannelById(kanal.id);

    expect(nachFehlschlag?.lastFailureCode).toBe('NOTIFICATION_DELIVERY_FAILED');
    // `recordChannelOutcome` ist eine Beobachtung des Betriebs, kein Bearbeiten
    // durch einen Admin – `updatedAt` bleibt deshalb stehen.
    expect(nachFehlschlag?.updatedAt.getTime()).toBe(kanal.updatedAt.getTime());

    const zeitpunkt = new Date('2026-09-11T09:00:00.000Z');
    await repository.recordChannelOutcome(kanal.id, { status: 'delivered', at: zeitpunkt });
    const nachErfolg = await repository.findChannelById(kanal.id);

    // Eine erfolgreiche Zustellung löscht den alten Fehlschlag.
    expect(nachErfolg?.lastDeliveryAt?.getTime()).toBe(zeitpunkt.getTime());
    expect(nachErfolg?.lastFailureCode).toBeNull();
  });

  it('zählt Regeln je Kanal und lässt reine Inbox-Regeln aussen vor', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const kanal = await repository.createChannel({
      name: 'Betrieb',
      type: 'discordWebhook',
      webhookUrl: null,
      username: null,
      enabled: true,
    });

    await repository.createRule({
      event: 'server.crashed',
      channelId: kanal.id,
      recipientScope: 'resourceOwner',
      recipientRoleId: null,
      inboxEnabled: true,
      severity: null,
      enabled: true,
    });
    await repository.createRule({
      event: 'server.started',
      channelId: null,
      recipientScope: 'resourceOwner',
      recipientRoleId: null,
      inboxEnabled: true,
      severity: null,
      enabled: true,
    });

    const zahlen = await repository.countRulesPerChannel();

    expect(zahlen.get(kanal.id)).toBe(1);
    // Die Regel ohne Kanal steht im `group by` als `null`-Gruppe und darf bei
    // keinem Kanal mitzählen.
    expect(zahlen.size).toBe(1);
  });

  it('findet eine gleichartige Regel auch dann, wenn Kanal und Rolle leer sind', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    await repository.createRule({
      event: 'server.started',
      channelId: null,
      recipientScope: 'resourceOwner',
      recipientRoleId: null,
      inboxEnabled: true,
      severity: null,
      enabled: true,
    });

    /*
     * `null` vergleicht sich in SQL nicht mit `=`. Die Umsetzung schaltet
     * deshalb auf `is null` um – eine Attrappe mit `===` merkt davon nichts und
     * würde den Duplikat-Schutz stillschweigend durchlassen.
     */
    const treffer = await repository.findMatchingRule({
      event: 'server.started',
      channelId: null,
      recipientScope: 'resourceOwner',
      recipientRoleId: null,
    });

    expect(treffer).not.toBeNull();
    expect(
      await repository.findMatchingRule({
        event: 'server.stopped',
        channelId: null,
        recipientScope: 'resourceOwner',
        recipientRoleId: null,
      }),
    ).toBeNull();
  });

  // -- Inbox ----------------------------------------------------------------

  it('setzt den Lesestatus nur für eigene und nur für noch ungelesene Meldungen', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);
    const fremder = await legeNutzerAn(kontext.db);

    const angelegt = await repository.createNotifications([
      meldung(nutzer),
      meldung(nutzer),
      meldung(fremder),
    ]);

    expect(angelegt).toHaveLength(3);
    expect(await repository.markRead(nutzer, null, true)).toBe(2);
    // Zweiter Aufruf: Beide stehen schon auf gelesen, also trifft das `UPDATE`
    // keine Zeile mehr – sonst würde `readAt` bei jedem Klick neu gesetzt.
    expect(await repository.markRead(nutzer, null, true)).toBe(0);
    // Der fremde Bestand bleibt unberührt.
    expect(await repository.countUnread(fremder)).toBe(1);
    expect(await repository.countUnread(nutzer)).toBe(0);
  });

  it('filtert, zählt und blättert die Inbox in einem Zug', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);

    await repository.createNotifications([
      meldung(nutzer, { event: 'server.started', severity: 'info' }),
      meldung(nutzer, { event: 'server.crashed', severity: 'error' }),
      meldung(nutzer, { event: 'server.crashed', severity: 'error' }),
    ]);
    const alle = await repository.listNotifications({
      userId: nutzer,
      unreadOnly: false,
      limit: 50,
      offset: 0,
    });
    await repository.markRead(nutzer, [alle.entries[0]?.id ?? ''], true);

    const gefiltert = await repository.listNotifications({
      userId: nutzer,
      unreadOnly: false,
      event: 'server.crashed',
      limit: 1,
      offset: 0,
    });

    expect(gefiltert.entries).toHaveLength(1);
    // `total` zählt den Filter, `unreadCount` den ganzen Bestand des Kontos –
    // zwei verschiedene Zählungen in einer Antwort.
    expect(gefiltert.total).toBe(2);
    expect(gefiltert.unreadCount).toBe(2);
  });

  it('räumt gelesene Meldungen jenseits der Frist weg und lässt ungelesene stehen', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);
    const alt = new Date('2026-06-01T10:00:00.000Z');
    const frist = new Date('2026-07-01T10:00:00.000Z');

    const [alteGelesen, alteUngelesen] = await repository.createNotifications([
      meldung(nutzer, { title: 'alt und gelesen' }),
      meldung(nutzer, { title: 'alt und ungelesen' }),
    ]);

    // Der Datensatz trägt `defaultNow()`; für die Frist muss die Zeit hier
    // gesetzt werden.
    await kontext.roh('update notifications set created_at = $1', [alt]);
    await repository.markRead(nutzer, [alteGelesen?.id ?? ''], true);

    expect(await repository.deleteReadNotificationsBefore(frist)).toBe(1);
    expect(await repository.findNotificationById(alteGelesen?.id ?? '')).toBeNull();
    // Ungelesen heißt: noch nicht erledigt. Alter allein genügt nicht.
    expect(await repository.findNotificationById(alteUngelesen?.id ?? '')).not.toBeNull();
  });

  it('räumt nur abgeschlossene Zustellversuche weg', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const kanal = await repository.createChannel({
      name: 'Betrieb',
      type: 'discordWebhook',
      webhookUrl: null,
      username: null,
      enabled: true,
    });
    const alt = new Date('2026-06-01T10:00:00.000Z');
    const frist = new Date('2026-07-01T10:00:00.000Z');

    for (const status of ['delivered', 'failed', 'pending'] as const) {
      await kontext.db.insert(notificationDeliveries).values({
        channelId: kanal.id,
        ruleId: null,
        event: 'server.crashed',
        status,
        createdAt: alt,
      });
    }

    // Etwas, das noch auf seine Zustellung wartet, wird nicht weggeräumt –
    // auch nicht, wenn es alt ist.
    expect(await repository.deleteFinishedDeliveriesBefore(frist)).toBe(2);
    expect((await repository.listDeliveries(10)).map((eintrag) => eintrag.status)).toEqual([
      'pending',
    ]);
  });

  // -- Einstellungen --------------------------------------------------------

  it('legt die Zustell-Einstellung beim ersten Mal an und ersetzt sie danach', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);

    // Ohne Eintrag: nichts abbestellt, und es wird auch keine Zeile angelegt.
    expect((await repository.findPreferences(nutzer)).mutedEvents).toEqual([]);
    expect((await repository.findPreferences(nutzer)).updatedAt).toBeNull();

    await repository.savePreferences(nutzer, ['server.started']);
    // Zweiter Aufruf trifft den Primärschlüssel und muss über
    // `on conflict do update` gehen, nicht mit 23505 scheitern.
    const ersetzt = await repository.savePreferences(nutzer, ['server.crashed', 'backup.failed']);

    expect([...ersetzt.mutedEvents].sort()).toEqual(['backup.failed', 'server.crashed']);
    expect([...(await repository.findPreferences(nutzer)).mutedEvents].sort()).toEqual([
      'backup.failed',
      'server.crashed',
    ]);
  });

  it('nennt in einer Abfrage, wer das Ereignis abbestellt hat', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const stumm = await legeNutzerAn(kontext.db);
    const anders = await legeNutzerAn(kontext.db);
    const ohne = await legeNutzerAn(kontext.db);

    await repository.savePreferences(stumm, ['server.crashed']);
    await repository.savePreferences(anders, ['server.started']);

    const treffer = await repository.findMutedRecipients([stumm, anders, ohne], 'server.crashed');

    expect([...treffer]).toEqual([stumm]);
    expect([...(await repository.findMutedRecipients([], 'server.crashed'))]).toEqual([]);
  });

  // -- Ankündigungen --------------------------------------------------------

  it('legt Ankündigung und Inbox-Meldungen in einer Klammer an', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const ersterNutzer = await legeNutzerAn(kontext.db);
    const zweiterNutzer = await legeNutzerAn(kontext.db);

    const { announcement, notifications: erzeugt } = await repository.publishAnnouncement(
      {
        title: 'Wartung',
        body: 'Heute Abend ab 22 Uhr.',
        severity: 'warning',
        publishedByUserId: null,
        expiresAt: null,
      },
      (angelegt) =>
        [ersterNutzer, zweiterNutzer].map((userId) =>
          meldung(userId, {
            event: 'announcement.published',
            title: angelegt.title,
            announcementId: angelegt.id,
          }),
        ),
    );

    expect(erzeugt).toHaveLength(2);
    expect((await repository.countNotificationsPerAnnouncement()).get(announcement.id)).toBe(2);
  });

  it('rollt alles zurück, wenn der Audit-Eintrag in der Klammer scheitert', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);

    /*
     * Fundpunkt 150: Lag der Audit-Eintrag hinter dem Commit und scheiterte,
     * existierte die Ankündigung samt Zustellung, der Admin sah aber einen
     * Fehler – und sein zweiter Anlauf legte eine **zweite** an.
     */
    await expect(
      repository.publishAnnouncement(
        {
          title: 'Wartung',
          body: 'Heute Abend ab 22 Uhr.',
          severity: 'warning',
          publishedByUserId: null,
          expiresAt: null,
        },
        (angelegt) => [
          meldung(nutzer, { event: 'announcement.published', announcementId: angelegt.id }),
        ],
        async () => {
          throw new Error('Audit-Log nicht erreichbar');
        },
      ),
    ).rejects.toThrow('Audit-Log nicht erreichbar');

    expect(await repository.listAnnouncements()).toEqual([]);
    expect(await repository.countUnread(nutzer)).toBe(0);
  });

  it('lässt eine zweite Veröffentlichung die vorhandenen Meldungen nicht verdoppeln', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);
    const ankuendigung = await repository.createAnnouncement({
      title: 'Wartung',
      body: 'Heute Abend ab 22 Uhr.',
      severity: 'warning',
      publishedByUserId: null,
      expiresAt: null,
    });

    const eintrag = meldung(nutzer, {
      event: 'announcement.published',
      announcementId: ankuendigung.id,
    });
    await repository.createNotifications([eintrag]);
    const zweiterVersuch = await repository.createNotifications([eintrag]);

    // Der Unique-Index je Ankündigung und Konto greift; `on conflict do
    // nothing` macht daraus ein leeres Ergebnis statt eines Fehlschlags.
    expect(zweiterVersuch).toEqual([]);
    expect(await repository.countUnread(nutzer)).toBe(1);
  });

  it('nimmt beim Zurückziehen einer Ankündigung ihre Meldungen mit', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);
    const { announcement } = await repository.publishAnnouncement(
      {
        title: 'Wartung',
        body: 'Heute Abend ab 22 Uhr.',
        severity: 'warning',
        publishedByUserId: null,
        expiresAt: null,
      },
      (angelegt) => [
        meldung(nutzer, { event: 'announcement.published', announcementId: angelegt.id }),
      ],
    );

    await repository.deleteAnnouncement(announcement.id);

    // `on delete cascade` – ohne die Kaskade bliebe eine Meldung stehen, deren
    // Ankündigung es nicht mehr gibt.
    expect(await repository.findAnnouncementById(announcement.id)).toBeNull();
    expect(await repository.countUnread(nutzer)).toBe(0);
  });

  it('lässt die Ankündigung stehen, wenn der Audit-Eintrag beim Zurückziehen scheitert', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);
    const ankuendigung = await repository.createAnnouncement({
      title: 'Wartung',
      body: 'Heute Abend ab 22 Uhr.',
      severity: 'warning',
      publishedByUserId: null,
      expiresAt: null,
    });

    // Fundpunkt 158: Sonst war sie weg, der Admin sah einen Fehler, und sein
    // zweiter Anlauf endete mit ANNOUNCEMENT_NOT_FOUND.
    await expect(
      repository.deleteAnnouncement(ankuendigung.id, async () => {
        throw new Error('Audit-Log nicht erreichbar');
      }),
    ).rejects.toThrow('Audit-Log nicht erreichbar');

    expect(await repository.findAnnouncementById(ankuendigung.id)).not.toBeNull();
  });

  // -- Empfängerverzeichnis -------------------------------------------------

  it('zählt zu den freigeschalteten Konten weder Gesperrte noch reine Gäste', async () => {
    const directory = createDrizzleRecipientDirectory(kontext.db);
    const gast = await legeRolleAn(kontext.db, GUEST_ROLE_NAME);
    const nutzerRolle = await legeRolleAn(kontext.db, 'Nutzer');

    const freigeschaltet = await legeNutzerAn(kontext.db);
    const wartend = await legeNutzerAn(kontext.db);
    const gesperrt = await legeNutzerAn(kontext.db, { banned: true });
    const besitzer = await legeNutzerAn(kontext.db, { isOwner: true });

    await weiseRolleZu(kontext.db, freigeschaltet, nutzerRolle);
    await weiseRolleZu(kontext.db, wartend, gast);
    await weiseRolleZu(kontext.db, gesperrt, nutzerRolle);

    const aktiv = new Set(await directory.listActiveUserIds());

    /*
     * „Freigeschaltet" ist kein eigenes Feld, sondern eine Auslegung: nicht
     * gesperrt **und** mindestens eine Rolle, die nicht „Gast" ist. Der Owner
     * zählt ohne Rolle mit. Diese Auslegung steckt in einer
     * `exists`-Unterabfrage – die Attrappe bildet sie nach, aber nicht dasselbe
     * SQL.
     */
    expect(aktiv.has(freigeschaltet)).toBe(true);
    expect(aktiv.has(besitzer)).toBe(true);
    expect(aktiv.has(wartend)).toBe(false);
    expect(aktiv.has(gesperrt)).toBe(false);
  });

  it('liefert die Träger einer Rolle ohne die gesperrten', async () => {
    const directory = createDrizzleRecipientDirectory(kontext.db);
    const rolle = await legeRolleAn(kontext.db, 'Moderation');
    const aktiv = await legeNutzerAn(kontext.db);
    const gesperrt = await legeNutzerAn(kontext.db, { banned: true });

    await weiseRolleZu(kontext.db, aktiv, rolle);
    await weiseRolleZu(kontext.db, gesperrt, rolle);

    expect(await directory.listUserIdsWithRole(rolle)).toEqual([aktiv]);
  });

  it('schlägt Anzeigenamen in einer Abfrage nach', async () => {
    const directory = createDrizzleRecipientDirectory(kontext.db);
    const ersterNutzer = await legeNutzerAn(kontext.db, { displayName: 'Alex' });
    const zweiterNutzer = await legeNutzerAn(kontext.db, { displayName: 'Bea' });

    const namen = await directory.findDisplayNames([ersterNutzer, zweiterNutzer]);

    expect(namen.get(ersterNutzer)).toBe('Alex');
    expect(namen.get(zweiterNutzer)).toBe('Bea');
    expect((await directory.findDisplayNames([])).size).toBe(0);
  });

  it('legt bei leerer Eingabe nichts an', async () => {
    const repository = createDrizzleNotificationRepository(kontext.db);

    expect(await repository.createNotifications([])).toEqual([]);
    expect(await kontext.db.select().from(notifications)).toEqual([]);
  });
});
