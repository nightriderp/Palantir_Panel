/**
 * Die Ereignis-Senke zwischen B3/B5 und B6 (Fundpunkt 233).
 *
 * `createNotificationEventSink()` ist die Stelle, an der **jedes** Ereignis der
 * Orchestrierung und der Sicherungen in die Benachrichtigungen übergeht – und
 * bis hierher lief sie in keinem Test. Sie trifft drei Entscheidungen, die
 * niemand sonst trifft:
 *
 * - Was **kein** benachrichtigungsfähiges Ereignis ist (`server.statsUpdated`
 *   und die anderen reinen Live-Ereignisse), wird still verworfen. Der
 *   Live-Kanal aus F3 hört auf dieselbe Senke; eine Ausnahme hier träfe den
 *   auslösenden Vorgang.
 * - `at` und `actorId` werden ergänzt, wenn die Quelle sie weggelassen hat. B3
 *   meldet über eine schmale Schnittstelle (`emit(event: string, payload:
 *   Record<string, unknown>)`) und kann beides vergessen.
 * - Ein Fehlschlag beim Veröffentlichen darf den Auslöser nicht mitreißen: Der
 *   Aufruf ist ein Hintergrundlauf (`fireAndForget`), kein Teil des Vorgangs.
 *
 * Was hier **nicht** steht: Das Zusammenstecken der Module selbst
 * (`createNotificationModule`, `createChatModule`, `createAdminModule`) läuft
 * bereits in `server-wiring.test.ts` über `buildServer()`, und die drei Hooks
 * aus `auth/plugin.ts` prüft `auth/routes.test.ts` samt ihrer Reihenfolge.
 */

import { describe, expect, it } from 'vitest';
import type { FireAndForgetLogger } from '../../lib/fire-and-forget.js';
import { createNotificationEventSink } from './module.js';
import type { NotificationService } from './service.js';

interface Aufzeichnung {
  readonly sink: ReturnType<typeof createNotificationEventSink>;
  readonly veroeffentlicht: { event: string; payload: Record<string, unknown> }[];
  readonly gemeldet: { details: Record<string, unknown>; message: string }[];
}

function baueSenke(ergebnis: () => Promise<void> = async () => undefined): Aufzeichnung {
  const veroeffentlicht: { event: string; payload: Record<string, unknown> }[] = [];
  const gemeldet: { details: Record<string, unknown>; message: string }[] = [];

  const service = {
    async publish(input: { event: string; payload: Record<string, unknown> }) {
      veroeffentlicht.push({ event: input.event, payload: input.payload });

      await ergebnis();
    },
  } as unknown as NotificationService;

  const log: FireAndForgetLogger = {
    error(details, message) {
      gemeldet.push({ details, message });
    },
  };

  return { sink: createNotificationEventSink(service, log), veroeffentlicht, gemeldet };
}

/** Wartet einen Umlauf der Ereignisschleife ab – die Senke wartet nicht selbst. */
async function umlauf(): Promise<void> {
  await new Promise((fertig) => setImmediate(fertig));
}

describe('Ereignis-Senke der Benachrichtigungen (Fundpunkt 233)', () => {
  it('reicht ein benachrichtigungsfähiges Ereignis weiter', async () => {
    const { sink, veroeffentlicht } = baueSenke();

    sink.emit('server.started', {
      at: '2026-09-11T08:00:00.000Z',
      actorId: 'konto-1',
      serverId: 'server-1',
      serverName: 'Welt',
      ownerId: 'konto-1',
      memberUserIds: [],
      detail: null,
    });
    await umlauf();

    expect(veroeffentlicht).toHaveLength(1);
    expect(veroeffentlicht[0]?.event).toBe('server.started');
    expect(veroeffentlicht[0]?.payload.serverName).toBe('Welt');
  });

  it('verwirft ein reines Live-Ereignis, statt zu werfen', async () => {
    const { sink, veroeffentlicht, gemeldet } = baueSenke();

    // `server.statsUpdated` läuft im Sekundentakt über denselben Weg. Landete
    // es in der Inbox, wäre sie nach einer Minute unbrauchbar.
    sink.emit('server.statsUpdated', { serverId: 'server-1', cpuPercent: 12 });
    await umlauf();

    expect(veroeffentlicht).toHaveLength(0);
    expect(gemeldet).toHaveLength(0);
  });

  it('ergänzt einen fehlenden Zeitstempel', async () => {
    const { sink, veroeffentlicht } = baueSenke();
    const vorher = Date.now();

    // So meldet B3: schmale Senke, Nutzlast ohne die gemeinsame Basis.
    sink.emit('server.crashed', {
      serverId: 'server-1',
      serverName: 'Welt',
      ownerId: 'konto-1',
    } as never);
    await umlauf();

    /*
     * Verglichen wird gegen die Uhr, nicht gegen eine gestellte Zeit: Eine
     * Attrappe der Zeit legt hier auch `setImmediate` still, und dann wartet
     * `umlauf()` auf einen Umlauf, der nie kommt.
     */
    const gesetzt = Date.parse(String(veroeffentlicht[0]?.payload.at));
    expect(gesetzt).toBeGreaterThanOrEqual(vorher);
    expect(gesetzt).toBeLessThanOrEqual(Date.now());
  });

  it('setzt einen fehlenden Handelnden auf „niemand"', async () => {
    const { sink, veroeffentlicht } = baueSenke();

    sink.emit('server.crashed', {
      at: '2026-09-11T08:00:00.000Z',
      serverId: 'server-1',
      serverName: 'Welt',
      ownerId: 'konto-1',
    } as never);
    await umlauf();

    // `null` und nicht `undefined`: Die Empfängerauflösung fragt danach, und
    // ein fehlendes Feld sähe dort aus wie ein vergessener Wert.
    expect(veroeffentlicht[0]?.payload.actorId).toBeNull();
  });

  it('lässt einen mitgegebenen Zeitstempel stehen', async () => {
    const { sink, veroeffentlicht } = baueSenke();

    sink.emit('server.stopped', {
      at: '2026-09-11T07:00:00.000Z',
      actorId: null,
      serverId: 'server-1',
      serverName: 'Welt',
      ownerId: 'konto-1',
      memberUserIds: [],
      detail: null,
    });
    await umlauf();

    expect(veroeffentlicht[0]?.payload.at).toBe('2026-09-11T07:00:00.000Z');
  });

  it('reißt den Auslöser bei einem Fehlschlag nicht mit', async () => {
    const { sink, gemeldet } = baueSenke(async () => {
      throw new Error('Datenbank kurz weg');
    });

    // Nicht abgewartet und trotzdem gefangen: Ein Serverstart soll nicht daran
    // scheitern, dass die Benachrichtigung nicht geschrieben werden konnte.
    expect(() => {
      sink.publish('server.started', {
        at: '2026-09-11T08:00:00.000Z',
        actorId: null,
        serverId: 'server-1',
        serverName: 'Welt',
        ownerId: 'konto-1',
        memberUserIds: [],
        detail: null,
      });
    }).not.toThrow();

    await umlauf();

    expect(gemeldet).toHaveLength(1);
    expect(gemeldet[0]?.details.vorgang).toBe('Benachrichtigung veröffentlichen');
    expect(gemeldet[0]?.details.event).toBe('server.started');
    expect(gemeldet[0]?.details.error).toBe('Datenbank kurz weg');
  });

  it('meldet über beide Namen dasselbe – `emit` für B3, `publish` für B5', async () => {
    const { sink, veroeffentlicht } = baueSenke();

    sink.emit('backup.failed', {
      at: '2026-09-11T08:00:00.000Z',
      actorId: null,
      backupId: 'sicherung-1',
      serverId: 'server-1',
      serverName: 'Welt',
      ownerId: 'konto-1',
      failureCode: 'AGENT_NOT_CONNECTED',
      failureMessage: 'Die Node antwortet nicht.',
    });
    sink.publish('backup.failed', {
      at: '2026-09-11T08:00:01.000Z',
      actorId: null,
      backupId: 'sicherung-2',
      serverId: 'server-1',
      serverName: 'Welt',
      ownerId: 'konto-1',
      failureCode: 'AGENT_NOT_CONNECTED',
      failureMessage: 'Die Node antwortet nicht.',
    });
    await umlauf();

    expect(veroeffentlicht.map((eintrag) => eintrag.payload.backupId)).toEqual([
      'sicherung-1',
      'sicherung-2',
    ]);
  });
});
