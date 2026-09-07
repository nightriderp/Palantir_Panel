/**
 * Chat-Repositories gegen echtes SQL (Audit-Maßnahme W2-28,
 * `backend-community-22`).
 *
 * Das Chat-Modul ist auf der Regelebene dicht getestet – aber ausschließlich
 * gegen die In-Memory-Attrappen aus `test-doubles.ts`, die ihre eigene Semantik
 * mitbringen. Ungeprüft blieben damit genau die nicht-trivialen Konstrukte:
 * die Cursor-Pagination über `created_at`, der `left join` der
 * Ungelesen-Zählung, das `on conflict` des Lesestands und das `distinct` über
 * Besitz und Mitgliedschaft.
 *
 * Läuft nur mit `DATABASE_URL` **und** `PALANTIR_TEST_DB=1`.
 */

import { GUEST_ROLE_NAME } from '@palantir/contracts';
import { expect, it } from 'vitest';
import { describeDatenbank } from '../../test-support/db.js';
import {
  legeMitgliedAn,
  legeNodeAn,
  legeNutzerAn,
  legeRolleAn,
  legeServerAn,
  weiseRolleZu,
} from '../../test-support/fixtures.js';
import { ChatError } from './errors.js';
import {
  createDrizzleChatRepository,
  createDrizzleChatUserDirectory,
  createDrizzleServerMembershipSource,
} from './repositories.js';

describeDatenbank('Chat-Repositories gegen PostgreSQL', (kontext) => {
  it('legt Unterhaltung und Teilnehmer in einer Transaktion an', async () => {
    const repository = createDrizzleChatRepository(kontext.db);
    const ersterNutzer = await legeNutzerAn(kontext.db);
    const zweiterNutzer = await legeNutzerAn(kontext.db);

    const unterhaltung = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: `${ersterNutzer}:${zweiterNutzer}`,
      participantIds: [ersterNutzer, zweiterNutzer],
    });

    expect(unterhaltung.type).toBe('dm');
    expect([...(await repository.listDirectParticipants(unterhaltung.id))].sort()).toEqual(
      [ersterNutzer, zweiterNutzer].sort(),
    );
    expect((await repository.findConversationByDmKey(unterhaltung.dmKey ?? ''))?.id).toBe(
      unterhaltung.id,
    );
  });

  it('findet die Unterhaltung eines Servers', async () => {
    const repository = createDrizzleChatRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);
    const serverId = await legeServerAn(kontext.db, { ownerId: besitzer, hostId: node });

    const unterhaltung = await repository.createConversation({
      type: 'server_chat',
      serverId,
      dmKey: null,
      participantIds: [],
    });

    expect((await repository.findConversationByServerId(serverId))?.id).toBe(unterhaltung.id);
    expect(await repository.findConversationByServerId(besitzer)).toBeNull();
  });

  it('blättert über den Anker rückwärts und meldet, ob es noch mehr gibt', async () => {
    const repository = createDrizzleChatRepository(kontext.db);
    const absender = await legeNutzerAn(kontext.db);
    const unterhaltung = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: `anker-${absender}`,
      participantIds: [absender],
    });

    const ids: string[] = [];

    for (let nummer = 0; nummer < 5; nummer += 1) {
      const nachricht = await repository.createMessage({
        conversationId: unterhaltung.id,
        senderId: absender,
        content: `Nachricht ${String(nummer)}`,
      });
      ids.push(nachricht.id);
      // Der Cursor vergleicht `created_at`; ohne Abstand wären die Zeitstempel
      // identisch und die Reihenfolge nicht mehr entscheidbar.
      await new Promise((fertig) => setTimeout(fertig, 5));
    }

    const erste = await repository.listMessages(unterhaltung.id, { limit: 2 });

    expect(erste.hasMore).toBe(true);
    expect(erste.messages.map((nachricht) => nachricht.id)).toEqual([ids[4], ids[3]]);

    const zweite = await repository.listMessages(unterhaltung.id, {
      limit: 2,
      before: ids[3] ?? '',
    });

    expect(zweite.messages.map((nachricht) => nachricht.id)).toEqual([ids[2], ids[1]]);
    expect(zweite.hasMore).toBe(true);

    const letzte = await repository.listMessages(unterhaltung.id, {
      limit: 2,
      before: ids[1] ?? '',
    });

    expect(letzte.messages.map((nachricht) => nachricht.id)).toEqual([ids[0]]);
    expect(letzte.hasMore).toBe(false);
  });

  it('lehnt einen unbekannten Anker ab, statt still die ganze Liste zu liefern', async () => {
    const repository = createDrizzleChatRepository(kontext.db);
    const absender = await legeNutzerAn(kontext.db);
    const unterhaltung = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: `unbekannt-${absender}`,
      participantIds: [absender],
    });

    await repository.createMessage({
      conversationId: unterhaltung.id,
      senderId: absender,
      content: 'Hallo',
    });

    await expect(
      repository.listMessages(unterhaltung.id, {
        limit: 10,
        before: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow(ChatError);
  });

  it('zählt nur fremde, ungelöschte Nachrichten nach dem Lesestand als ungelesen', async () => {
    const repository = createDrizzleChatRepository(kontext.db);
    const leser = await legeNutzerAn(kontext.db);
    const anderer = await legeNutzerAn(kontext.db);
    const unterhaltung = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: `ungelesen-${leser}`,
      participantIds: [leser, anderer],
    });

    // Vor dem Lesestand – zählt nicht mehr.
    const alt = await repository.createMessage({
      conversationId: unterhaltung.id,
      senderId: anderer,
      content: 'alt',
    });

    /*
     * Der Lesestand wird aus der Zeit der Nachricht abgeleitet und nicht aus
     * `new Date()`: Nachrichten tragen die Uhr des Datenbankservers, und ein
     * Vergleich gegen die Uhr des Testprozesses hinge an deren Gleichlauf.
     */
    await repository.markConversationRead(
      unterhaltung.id,
      leser,
      new Date(alt.createdAt.getTime() + 1),
    );
    await new Promise((fertig) => setTimeout(fertig, 5));

    // Nach dem Lesestand – zählt.
    await repository.createMessage({
      conversationId: unterhaltung.id,
      senderId: anderer,
      content: 'neu',
    });
    // Eigene Nachricht – zählt nie.
    await repository.createMessage({
      conversationId: unterhaltung.id,
      senderId: leser,
      content: 'von mir',
    });
    // Gelöschte Nachricht – zählt nicht.
    const geloescht = await repository.createMessage({
      conversationId: unterhaltung.id,
      senderId: anderer,
      content: 'zurückgezogen',
    });
    await repository.markMessageDeleted(geloescht.id, anderer, new Date());

    const anzahl = await repository.unreadCounts(leser, [unterhaltung.id]);

    expect(anzahl.get(unterhaltung.id)).toBe(1);
    expect(await repository.unreadCounts(leser, [])).toEqual(new Map());
  });

  it('zählt ohne Lesestand alles Fremde als ungelesen', async () => {
    /*
     * Der `left join` mit `is null`-Zweig: Fehlt die Zeile in
     * `conversation_reads` ganz, darf die Zählung nicht auf 0 fallen.
     */
    const repository = createDrizzleChatRepository(kontext.db);
    const leser = await legeNutzerAn(kontext.db);
    const anderer = await legeNutzerAn(kontext.db);
    const unterhaltung = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: `ohnelesestand-${leser}`,
      participantIds: [leser, anderer],
    });

    await repository.createMessage({
      conversationId: unterhaltung.id,
      senderId: anderer,
      content: 'eins',
    });
    await repository.createMessage({
      conversationId: unterhaltung.id,
      senderId: anderer,
      content: 'zwei',
    });

    expect((await repository.unreadCounts(leser, [unterhaltung.id])).get(unterhaltung.id)).toBe(2);
  });

  it('schiebt den Lesestand beim zweiten Mal nach vorn, statt zu scheitern', async () => {
    const repository = createDrizzleChatRepository(kontext.db);
    const leser = await legeNutzerAn(kontext.db);
    const unterhaltung = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: `lesestand-${leser}`,
      participantIds: [leser],
    });

    const frueher = new Date('2026-01-01T10:00:00.000Z');
    const spaeter = new Date('2026-01-01T12:00:00.000Z');

    await repository.markConversationRead(unterhaltung.id, leser, frueher);
    await repository.markConversationRead(unterhaltung.id, leser, spaeter);

    const stand = await repository.lastReadAtFor(leser, [unterhaltung.id]);

    expect(stand.get(unterhaltung.id)?.toISOString()).toBe(spaeter.toISOString());
  });

  it('liefert je Unterhaltung die neueste Nachricht', async () => {
    const repository = createDrizzleChatRepository(kontext.db);
    const absender = await legeNutzerAn(kontext.db);
    const eine = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: `letzte-a-${absender}`,
      participantIds: [absender],
    });
    const andere = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: `letzte-b-${absender}`,
      participantIds: [absender],
    });

    await repository.createMessage({
      conversationId: eine.id,
      senderId: absender,
      content: 'alt',
    });
    await new Promise((fertig) => setTimeout(fertig, 5));
    await repository.createMessage({
      conversationId: eine.id,
      senderId: absender,
      content: 'neu',
    });

    const letzte = await repository.lastMessages([eine.id, andere.id]);

    expect(letzte.get(eine.id)?.content).toBe('neu');
    // Eine Unterhaltung ohne Nachrichten fehlt in der Map.
    expect(letzte.has(andere.id)).toBe(false);
  });

  it('führt Meldungen an, zählt sie und schließt sie ab', async () => {
    const repository = createDrizzleChatRepository(kontext.db);
    const melder = await legeNutzerAn(kontext.db);
    const moderator = await legeNutzerAn(kontext.db);
    const unterhaltung = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: `meldung-${melder}`,
      participantIds: [melder],
    });
    const nachricht = await repository.createMessage({
      conversationId: unterhaltung.id,
      senderId: melder,
      content: 'unangebracht',
    });

    const meldung = await repository.createReport({
      messageId: nachricht.id,
      reportedById: melder,
      reason: 'Beleidigung',
      reportedContent: 'unangebracht',
    });

    expect(meldung.status).toBe('open');
    expect((await repository.findReportByMessageAndReporter(nachricht.id, melder))?.id).toBe(
      meldung.id,
    );
    expect([...(await repository.reportedMessageIds(melder, [nachricht.id]))]).toEqual([
      nachricht.id,
    ]);

    const offen = await repository.listReports({ status: 'open', limit: 10, offset: 0 });
    expect(offen.total).toBe(1);
    expect(offen.reports).toHaveLength(1);

    await repository.resolveReport(meldung.id, {
      status: 'resolved',
      actionTaken: 'deleteMessage',
      moderatorNote: 'entfernt',
      resolvedById: moderator,
      resolvedAt: new Date(),
    });

    expect((await repository.listReports({ status: 'open', limit: 10, offset: 0 })).total).toBe(0);
    expect((await repository.findReport(meldung.id))?.status).toBe('resolved');
  });

  it('hält den Owner für freigeschaltet, ein reines Gast-Konto nicht', async () => {
    const directory = createDrizzleChatUserDirectory(kontext.db);
    const gastRolle = await legeRolleAn(kontext.db, GUEST_ROLE_NAME);
    const mitgliedRolle = await legeRolleAn(kontext.db, 'Spieler');

    const owner = await legeNutzerAn(kontext.db, { isOwner: true });
    const gast = await legeNutzerAn(kontext.db);
    const freigeschaltet = await legeNutzerAn(kontext.db);
    const gesperrt = await legeNutzerAn(kontext.db, { banned: true });

    await weiseRolleZu(kontext.db, gast, gastRolle);
    await weiseRolleZu(kontext.db, freigeschaltet, mitgliedRolle);
    await weiseRolleZu(kontext.db, gesperrt, mitgliedRolle);

    expect((await directory.find(owner))?.approved).toBe(true);
    expect((await directory.find(gast))?.approved).toBe(false);
    expect((await directory.find(freigeschaltet))?.approved).toBe(true);
    expect((await directory.find(gesperrt))?.approved).toBe(false);
    expect(await directory.find('00000000-0000-4000-8000-000000000000')).toBeNull();

    const gebuendelt = await directory.listByIds([owner, gast, freigeschaltet]);
    const nachId = new Map(gebuendelt.map((eintrag) => [eintrag.id, eintrag.approved]));

    // Dieselbe Regel gebündelt wie einzeln.
    expect(nachId.get(owner)).toBe(true);
    expect(nachId.get(gast)).toBe(false);
    expect(nachId.get(freigeschaltet)).toBe(true);

    const namen = await directory.displayNames([owner, gast]);
    expect(namen.size).toBe(2);
    expect(await directory.displayNames([])).toEqual(new Map());
  });

  it('führt Besitz und Mitgliedschaft ohne Dopplung zusammen', async () => {
    const quelle = createDrizzleServerMembershipSource(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const mitglied = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);

    const eigener = await legeServerAn(kontext.db, { ownerId: besitzer, hostId: node });
    const fremder = await legeServerAn(kontext.db, { ownerId: mitglied, hostId: node });

    // Der Besitzer ist zusätzlich als Mitglied eingetragen – der Server darf
    // trotzdem nur einmal in der Liste stehen (`selectDistinct`).
    await legeMitgliedAn(kontext.db, eigener, besitzer, 'manager');
    await legeMitgliedAn(kontext.db, fremder, besitzer, 'viewer');

    const ids = [...(await quelle.listServerIdsForUser(besitzer))].sort();

    expect(ids).toEqual([eigener, fremder].sort());
    expect((await quelle.findServer(eigener))?.ownerId).toBe(besitzer);
    expect(await quelle.findServer('00000000-0000-4000-8000-000000000000')).toBeNull();

    const mitglieder = await quelle.listMembers(fremder);
    expect(mitglieder).toEqual([{ userId: besitzer, level: 'viewer' }]);
  });
});
