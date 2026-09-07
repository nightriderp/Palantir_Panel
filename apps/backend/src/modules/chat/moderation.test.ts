/**
 * Melden und Moderieren – die zweite Hälfte des Datenschutz-Prinzips aus
 * Pflichtenheft §15.
 *
 * Diese Tests sind laut Arbeitsauftrag zwingend: Sie halten fest, **was genau**
 * ein Moderator bei einer Meldung sieht – und dass er ohne Meldung gar nichts
 * sieht.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ChatError } from './errors.js';
import { type ModerationService, createModerationService } from './moderation.js';
import { type ChatService, createChatService } from './service.js';
import {
  ALEX,
  BEA,
  CHRIS,
  MOD,
  SERVER_ID,
  type InMemoryChatRepository,
  type RecordingAuditService,
  type RecordingDelivery,
  type RecordingEventPublisher,
  actorWith,
  ctxFor,
  fakeServerMembership,
  fakeUserDirectory,
  inMemoryChatRepository,
  ownerActor,
  recordingAuditService,
  recordingDelivery,
  recordingEventPublisher,
  steppingClock,
} from './test-doubles.js';

const SERVER = { id: SERVER_ID, name: 'Minecraft-Welt', ownerId: ALEX };

const NAMEN = {
  [ALEX]: { displayName: 'Alex' },
  [BEA]: { displayName: 'Bea' },
  [CHRIS]: { displayName: 'Chris' },
  [MOD]: { displayName: 'Mod' },
};

const MODERATOR = ctxFor(MOD, actorWith('message.moderate'));
/** Zweiter Moderator – für die gleichzeitige Entscheidung über dieselbe Meldung. */
const ZWEITER_MODERATOR = ctxFor(CHRIS, actorWith('message.moderate'));
const OFFEN = { status: 'open' as const, limit: 50, offset: 0 };

let repository: InMemoryChatRepository;
let chat: ChatService;
let moderation: ModerationService;
let audit: RecordingAuditService;
let events: RecordingEventPublisher;
let delivery: RecordingDelivery;

beforeEach(() => {
  const clock = steppingClock();

  repository = inMemoryChatRepository(clock);
  audit = recordingAuditService();
  events = recordingEventPublisher();
  delivery = recordingDelivery();

  const users = fakeUserDirectory(NAMEN);
  const servers = fakeServerMembership([SERVER], { [SERVER_ID]: [BEA] });

  chat = createChatService({ repository, users, servers, delivery, clock });
  moderation = createModerationService({
    repository,
    chat,
    users,
    audit,
    events,
    delivery,
    clock,
  });
});

/** Alex schreibt Bea etwas, Bea meldet es. */
async function gemeldeteNachricht(): Promise<{ messageId: string; reportId: string }> {
  const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
  const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, {
    content: 'Etwas Unschönes',
  });
  const meldung = await moderation.reportMessage(ctxFor(BEA), nachricht.id, 'Beleidigung');

  return { messageId: nachricht.id, reportId: meldung.id };
}

describe('Melden', () => {
  it('setzt Teilnahme an der Konversation voraus', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, { content: 'Hallo' });

    /*
     * Ohne diese Prüfung wäre die Melde-Funktion der Umweg, über den sich
     * jeder beliebige fremde Nachrichteninhalt in die Moderationsansicht
     * heben ließe.
     */
    await expect(
      moderation.reportMessage(ctxFor(CHRIS), nachricht.id, 'Neugier'),
    ).rejects.toThrowError(new ChatError('MESSAGE_NOT_FOUND'));

    await expect(moderation.reportMessage(MODERATOR, nachricht.id, 'Neugier')).rejects.toThrowError(
      new ChatError('MESSAGE_NOT_FOUND'),
    );
  });

  /**
   * Audit W3-4, `backend-community-visibility-09`: Eine unbekannte Id ergab
   * `MESSAGE_NOT_FOUND`, eine vorhandene in fremder Konversation
   * `CONVERSATION_NOT_FOUND` – der Unterschied zwischen beiden Antworten war
   * genau die Auskunft, die der Melde-Endpunkt nicht geben soll. Beide Wege
   * (Melden und Löschen) tragen jetzt denselben Code.
   */
  it('antwortet auf eine fremde und auf eine unbekannte Nachricht gleich', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, { content: 'Hallo' });

    const fremd = await moderation
      .reportMessage(ctxFor(CHRIS), nachricht.id, 'Neugier')
      .catch((error: unknown) => error);
    const unbekannt = await moderation
      .reportMessage(ctxFor(CHRIS), SERVER_ID.replace('5e', 'ff'), 'Neugier')
      .catch((error: unknown) => error);
    const geloescht = await chat
      .deleteOwnMessage(ctxFor(CHRIS), nachricht.id)
      .catch((error: unknown) => error);

    expect(fremd).toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
    expect(unbekannt).toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
    expect(geloescht).toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
  });

  it('lehnt die eigene Nachricht ab', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, { content: 'Hallo' });

    await expect(
      moderation.reportMessage(ctxFor(ALEX), nachricht.id, 'Test'),
    ).rejects.toMatchObject({ code: 'MESSAGE_REPORT_NOT_ALLOWED' });
  });

  /**
   * Audit W2-2, `backend-community-01` (= `backend-community-visibility-01`):
   * Der Melde-Endpunkt war der Weg, auf dem der Inhalt einer zurückgenommenen
   * Nachricht wieder lesbar wurde – `reportedContent` kopiert ihn aus der
   * Datenbank, und das Antwort-DTO gibt ihn dem Melder zurück. Pflichtenheft
   * §15 sichert das Gegenteil zu; `canReport: false` kündigte die Regel im DTO
   * schon an, der Dienst setzte sie nicht durch.
   */
  it('lehnt die Meldung einer vom Absender gelöschten Nachricht ab', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, {
      content: 'Etwas Unschönes',
    });

    await chat.deleteOwnMessage(ctxFor(ALEX), nachricht.id);

    await expect(
      moderation.reportMessage(ctxFor(BEA), nachricht.id, 'Beleidigung'),
    ).rejects.toMatchObject({ code: 'MESSAGE_REPORT_NOT_ALLOWED' });
  });

  it('hebt den Inhalt einer gelöschten Nachricht nicht in die Moderationsansicht', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, {
      content: 'Etwas Unschönes',
    });

    await chat.deleteOwnMessage(ctxFor(ALEX), nachricht.id);
    await expect(moderation.reportMessage(ctxFor(BEA), nachricht.id, 'Grund')).rejects.toThrow();

    const seite = await moderation.listReports(MODERATOR, OFFEN);

    expect(seite.total).toBe(0);
    // `reportedContent` stammt nie aus einer gelöschten Nachricht.
    expect(JSON.stringify(seite)).not.toContain('Unschönes');
  });

  it('lehnt die Meldung auch nach einer Moderationslöschung ab', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, {
      content: 'Etwas Unschönes',
    });
    const meldung = await moderation.reportMessage(ctxFor(BEA), nachricht.id, 'Beleidigung');

    await moderation.resolveReport(MODERATOR, meldung.id, { action: 'deleteMessage' });

    // Auch der Absender selbst kommt so nicht mehr an den Text heran.
    await expect(
      moderation.reportMessage(ctxFor(BEA), nachricht.id, 'Nochmal'),
    ).rejects.toMatchObject({ code: 'MESSAGE_REPORT_NOT_ALLOWED' });
  });

  it('lehnt die zweite Meldung derselben Person ab', async () => {
    const { messageId } = await gemeldeteNachricht();

    await expect(moderation.reportMessage(ctxFor(BEA), messageId, 'Nochmal')).rejects.toThrowError(
      new ChatError('MESSAGE_REPORT_DUPLICATE'),
    );
  });

  /**
   * Audit W2-9, `backend-community-05`: Doppelklick auf „Melden". Beide Aufrufe
   * finden über `findReportByMessageAndReporter` nichts, den zweiten Insert
   * fängt `message_reports_message_reporter_idx` – bisher als roher 23505 und
   * damit als 500 statt als `MESSAGE_REPORT_DUPLICATE` (409).
   */
  it('beantwortet den Unique-Index (23505) mit MESSAGE_REPORT_DUPLICATE', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, {
      content: 'Etwas Unschönes',
    });

    // Der Gewinner des Rennens hat seinen Insert noch nicht abgeschlossen.
    repository.findReportByMessageAndReporter = (): Promise<null> => Promise.resolve(null);
    repository.createReport = (): Promise<never> =>
      Promise.reject(
        Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
        }),
      );

    await expect(
      moderation.reportMessage(ctxFor(BEA), nachricht.id, 'Beleidigung'),
    ).rejects.toThrowError(new ChatError('MESSAGE_REPORT_DUPLICATE'));
  });

  /**
   * `message.reported` ist das einzige Chat-Ereignis, das laut Pflichtenheft
   * §14 eine Benachrichtigung auslösen darf – und es trägt keinen Inhalt: Eine
   * Benachrichtigung geht an einen Discord-Webhook, dorthin gehört kein
   * privater Text.
   */
  it('meldet das Ereignis message.reported ohne Nachrichteninhalt', async () => {
    await gemeldeteNachricht();

    const ereignis = events.published.find((entry) => entry.event === 'message.reported');

    expect(ereignis).toBeDefined();
    expect(JSON.stringify(ereignis?.payload)).not.toContain('Unschönes');
  });

  /**
   * Die Nutzlast folgte bisher eigenen Feldnamen (`reportedById`, dazu
   * `conversationType`/`serverId`) und ließ `conversationId` und `reason` weg –
   * die Meldung in der Inbox blieb deshalb ohne Detail, ein Sprung in die
   * Unterhaltung war nicht möglich (Audit W1-7,
   * backend-community-visibility-04).
   */
  it('trägt Konversation, Melder und Begründung wie im Vertrag', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, {
      content: 'Etwas Unschönes',
    });
    const meldung = await moderation.reportMessage(ctxFor(BEA), nachricht.id, 'Beleidigung');

    const ereignis = events.published.find((entry) => entry.event === 'message.reported');

    expect(ereignis?.payload).toEqual({
      at: expect.any(String) as unknown as string,
      // Ausgelöst hat die Meldung, wer sie abgeschickt hat.
      actorId: BEA,
      reportId: meldung.id,
      messageId: nachricht.id,
      conversationId: conversation.id,
      reportedByUserId: BEA,
      reason: 'Beleidigung',
    });
  });

  it('merkt sich die Meldung am DTO der Nachricht', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, { content: 'Hallo' });

    await moderation.reportMessage(ctxFor(BEA), nachricht.id, 'Beleidigung');

    const fuerBea = await chat.listMessages(ctxFor(BEA), conversation.id, { limit: 50 });
    const fuerAlex = await chat.listMessages(ctxFor(ALEX), conversation.id, { limit: 50 });

    expect(fuerBea.messages[0]?.reportedByViewer).toBe(true);
    expect(fuerBea.messages[0]?.permissions.canReport).toBe(false);
    // Der Absender erfährt nicht, dass gemeldet wurde.
    expect(fuerAlex.messages[0]?.reportedByViewer).toBe(false);
  });
});

describe('Moderationsansicht', () => {
  it('verlangt message.moderate – ein Owner-Flag ersetzt sie, sonst niemand', async () => {
    await gemeldeteNachricht();

    await expect(moderation.listReports(ctxFor(CHRIS), OFFEN)).rejects.toThrowError(
      new ChatError('PERMISSION_DENIED'),
    );

    // Der Owner trägt den vollen Katalog (Pflichtenheft §8) und damit auch
    // `message.moderate` – aber eben über den Katalog, nicht über eine
    // Sonderregel im Chat.
    await expect(moderation.listReports(ctxFor(CHRIS, ownerActor()), OFFEN)).resolves.toBeDefined();
  });

  it('zeigt ausschließlich gemeldete Nachrichten', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);

    await chat.sendMessage(ctxFor(ALEX), conversation.id, { content: 'harmlos eins' });
    const auffaellig = await chat.sendMessage(ctxFor(ALEX), conversation.id, {
      content: 'Etwas Unschönes',
    });

    await chat.sendMessage(ctxFor(ALEX), conversation.id, { content: 'harmlos zwei' });
    await moderation.reportMessage(ctxFor(BEA), auffaellig.id, 'Beleidigung');

    const seite = await moderation.listReports(MODERATOR, OFFEN);

    expect(seite.total).toBe(1);
    expect(seite.reports).toHaveLength(1);
    expect(seite.reports[0]?.message.id).toBe(auffaellig.id);

    // Kein Verlauf drumherum: Die harmlosen Nachrichten tauchen nirgends auf.
    const roh = JSON.stringify(seite);

    expect(roh).toContain('Etwas Unschönes');
    expect(roh).not.toContain('harmlos eins');
    expect(roh).not.toContain('harmlos zwei');
  });

  /** Genau der Satz an Feldern aus `ReportedMessageDto` – nichts darüber hinaus. */
  it('gibt zur gemeldeten Nachricht genau Absender, Inhalt, Zeit und Löschstand heraus', async () => {
    const { reportId } = await gemeldeteNachricht();
    const meldung = await moderation.getReport(MODERATOR, reportId);

    expect(Object.keys(meldung.message).sort()).toEqual(
      ['content', 'createdAt', 'deletedAt', 'id', 'senderDisplayName', 'senderId'].sort(),
    );
  });

  /**
   * Die Einordnung „private Unterhaltung oder Server-Chat" darf der Moderator
   * sehen; die Teilnehmer einer DM nicht.
   */
  it('nennt die Art der Konversation, aber keine Teilnehmerliste', async () => {
    const { reportId } = await gemeldeteNachricht();
    const meldung = await moderation.getReport(MODERATOR, reportId);

    expect(meldung.conversationType).toBe('dm');
    expect(meldung.serverId).toBeNull();
    expect(meldung).not.toHaveProperty('participants');
    expect(meldung).not.toHaveProperty('messages');
  });

  it('nennt beim Server-Chat den Server, damit der Vorfall einzuordnen ist', async () => {
    const conversation = await chat.openServerConversation(ctxFor(ALEX), SERVER_ID);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, { content: 'Frech' });
    const meldung = await moderation.reportMessage(ctxFor(BEA), nachricht.id, 'Beleidigung');

    expect(meldung.conversationType).toBe('server_chat');
    expect(meldung.serverId).toBe(SERVER_ID);
  });

  it('bietet keinen Weg an, mit dem sich der Rest der Konversation nachladen ließe', () => {
    /*
     * Der Dienst hat bewusst keine Methode, die eine Konversation oder einen
     * Verlauf liefert. Fällt hier je eine dazu, ist das kein neues Feature,
     * sondern ein Bruch der Zusicherung aus Pflichtenheft §15.
     */
    expect(Object.keys(moderation).sort()).toEqual(
      ['getReport', 'listReports', 'reportMessage', 'resolveReport'].sort(),
    );
  });
});

describe('Entscheidung über eine Meldung', () => {
  it('verwirft die Meldung, ohne die Nachricht anzutasten', async () => {
    const { messageId, reportId } = await gemeldeteNachricht();

    const entschieden = await moderation.resolveReport(MODERATOR, reportId, { action: 'dismiss' });

    expect(entschieden.status).toBe('dismissed');
    expect(entschieden.actionTaken).toBe('dismiss');
    expect((await repository.findMessage(messageId))?.deletedAt).toBeNull();
  });

  it('löscht die Nachricht und meldet das den Teilnehmern als Moderationslöschung', async () => {
    const { messageId, reportId } = await gemeldeteNachricht();

    await moderation.resolveReport(MODERATOR, reportId, {
      action: 'deleteMessage',
      note: 'Wiederholt beleidigend',
    });

    expect((await repository.findMessage(messageId))?.deletedAt).not.toBeNull();

    const zustellung = delivery.delivered.filter(
      (entry) => entry.frame.event === 'message.deleted',
    );

    expect(zustellung.map((entry) => entry.userId).sort()).toEqual([ALEX, BEA].sort());
    expect((zustellung[0]?.frame.data as { byModerator: boolean }).byModerator).toBe(true);
  });

  it('schreibt jede Entscheidung ins Audit-Log – ohne Nachrichteninhalt', async () => {
    const { reportId } = await gemeldeteNachricht();

    await moderation.resolveReport(MODERATOR, reportId, { action: 'deleteMessage' });

    expect(audit.actions()).toEqual(['message.moderated']);

    const eintrag = audit.entries[0];

    expect(eintrag?.targetType).toBe('message');
    expect(eintrag?.actorId).toBe(MOD);
    // Das Audit-Log sieht jeder mit `audit.view` – ein größerer Kreis als der,
    // den eine Meldung öffnen soll.
    expect(JSON.stringify(eintrag?.metadata)).not.toContain('Unschönes');
  });

  it('lässt über dieselbe Meldung nicht zweimal entscheiden', async () => {
    const { reportId } = await gemeldeteNachricht();

    await moderation.resolveReport(MODERATOR, reportId, { action: 'dismiss' });

    await expect(
      moderation.resolveReport(MODERATOR, reportId, { action: 'deleteMessage' }),
    ).rejects.toThrowError(new ChatError('MESSAGE_REPORT_ALREADY_RESOLVED'));
  });

  /**
   * Audit W3-4, `backend-community-12`: Zwei Moderatoren entscheiden dieselbe
   * offene Meldung gleichzeitig. Beide kommen an der Vorprüfung vorbei, weil
   * beide denselben offenen Stand gelesen haben. Vorher liefen beide Updates
   * durch – der letzte gewann Status und `actionTaken`, und es entstanden zwei
   * Audit-Einträge zu einer Meldung.
   */
  it('lässt bei zwei gleichzeitigen Entscheidungen genau eine gewinnen', async () => {
    const { reportId } = await gemeldeteNachricht();
    const offen = await repository.findReport(reportId);

    // Beide haben denselben offenen Stand gelesen, bevor einer geschrieben hat.
    repository.findReport = (): Promise<typeof offen> => Promise.resolve(offen);

    const ergebnisse = await Promise.allSettled([
      moderation.resolveReport(MODERATOR, reportId, { action: 'deleteMessage' }),
      moderation.resolveReport(ZWEITER_MODERATOR, reportId, { action: 'dismiss' }),
    ]);

    const abgelehnt = ergebnisse.filter(
      (eintrag): eintrag is PromiseRejectedResult => eintrag.status === 'rejected',
    );

    expect(ergebnisse.filter((eintrag) => eintrag.status === 'fulfilled')).toHaveLength(1);
    // Der Verlierer bekommt einen Fachcode aus dem Katalog, keinen 500er.
    expect(abgelehnt).toHaveLength(1);
    expect(abgelehnt[0]?.reason).toMatchObject({ code: 'MESSAGE_REPORT_ALREADY_RESOLVED' });

    // Genau eine Entscheidung, genau ein Audit-Eintrag.
    expect(repository.reports[0]?.resolvedAt).not.toBeNull();
    expect(audit.entries).toHaveLength(1);
  });

  /**
   * Dieselbe Nachricht, zwei Löschwege (Audit W3-4, `backend-community-12`):
   * Der Absender löscht selbst, während ein Moderator entscheidet. Ohne
   * Bedingung im `UPDATE` überschrieb der zweite Schreiber `deletedById`, und
   * das DTO-Flag `deletedByModerator` kippte je nach Reihenfolge.
   */
  it('überschreibt eine zeitgleiche Selbstlöschung nicht', async () => {
    const { messageId, reportId } = await gemeldeteNachricht();
    const frisch = await repository.findMessage(messageId);

    await chat.deleteOwnMessage(ctxFor(ALEX), messageId);

    // Die Moderation hat die Nachricht noch als ungelöscht gelesen.
    repository.findMessage = (): Promise<typeof frisch> => Promise.resolve(frisch);

    const entschieden = await moderation.resolveReport(MODERATOR, reportId, {
      action: 'deleteMessage',
    });

    // Die Entscheidung gilt und ist protokolliert …
    expect(entschieden.status).toBe('resolved');
    expect(audit.actions()).toEqual(['message.moderated']);

    // … die Löschung bleibt aber die des Absenders, und es geht kein zweites
    // `message.deleted` hinaus.
    expect(repository.messages[0]?.deletedById).toBe(ALEX);
    expect(
      delivery.delivered
        .filter((eintrag) => eintrag.frame.event === 'message.deleted')
        .map((eintrag) => (eintrag.frame.data as { byModerator: boolean }).byModerator),
    ).toEqual([false, false]);
  });

  it('bleibt gültig, wenn der Absender die Nachricht inzwischen selbst gelöscht hat', async () => {
    const { messageId, reportId } = await gemeldeteNachricht();

    await chat.deleteOwnMessage(ctxFor(ALEX), messageId);

    const entschieden = await moderation.resolveReport(MODERATOR, reportId, {
      action: 'deleteMessage',
    });

    expect(entschieden.status).toBe('resolved');
    // Der Inhalt der Meldung bleibt lesbar, damit die Entscheidung
    // nachvollziehbar ist – die Nachricht selbst gibt nichts mehr heraus.
    expect(entschieden.message.content).toBe('Etwas Unschönes');
    expect(entschieden.message.deletedAt).not.toBeNull();
  });

  it('verlangt auch für die Entscheidung message.moderate', async () => {
    const { reportId } = await gemeldeteNachricht();

    await expect(
      moderation.resolveReport(ctxFor(BEA), reportId, { action: 'dismiss' }),
    ).rejects.toThrowError(new ChatError('PERMISSION_DENIED'));
  });

  it('meldet eine unbekannte Meldung als MESSAGE_REPORT_NOT_FOUND', async () => {
    await expect(
      moderation.getReport(MODERATOR, SERVER_ID.replace('5e', 'aa')),
    ).rejects.toThrowError(new ChatError('MESSAGE_REPORT_NOT_FOUND'));
  });
});
