/**
 * REST-Routen des Chats.
 *
 * Geprüft wird, dass die Antworten dem Envelope aus Pflichtenheft §5.1 folgen,
 * dass Fehler benannte Codes tragen – und dass der Moderationsweg ohne
 * `message.moderate` gar nicht erst in den Handler kommt.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ABUSE_LIMITS, ABUSE_LIMIT_ERROR_CODE } from '../../lib/abuse-limits.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { ChatLiveHub } from './live.js';
import { createModerationService, type ModerationService } from './moderation.js';
import { registerChatRoutes } from './routes.js';
import { type ChatService, createChatService } from './service.js';
import {
  ALEX,
  BEA,
  CHRIS,
  MOD,
  SERVER_ID,
  actorWith,
  ctxFor,
  fakeServerMembership,
  fakeUserDirectory,
  inMemoryChatRepository,
  recordingAuditService,
  steppingClock,
} from './test-doubles.js';

const SERVER = { id: SERVER_ID, name: 'Minecraft-Welt', ownerId: ALEX };

const KONTEN: Record<string, { actor: PermissionActor; userId: string; displayName: string }> = {
  alex: { actor: actorWith(), userId: ALEX, displayName: 'Alex' },
  bea: { actor: actorWith(), userId: BEA, displayName: 'Bea' },
  chris: { actor: actorWith(), userId: CHRIS, displayName: 'Chris' },
  mod: { actor: actorWith('message.moderate'), userId: MOD, displayName: 'Mod' },
};

let app: FastifyInstance;
let chat: ChatService;

beforeEach(async () => {
  const clock = steppingClock();
  const repository = inMemoryChatRepository(clock);
  const users = fakeUserDirectory({
    [ALEX]: { displayName: 'Alex' },
    [BEA]: { displayName: 'Bea' },
    [CHRIS]: { displayName: 'Chris' },
    [MOD]: { displayName: 'Mod' },
  });
  const servers = fakeServerMembership([SERVER], { [SERVER_ID]: [BEA] });

  chat = createChatService({ repository, users, servers, clock });

  const moderation = createModerationService({
    repository,
    chat,
    users,
    audit: recordingAuditService(),
    clock,
  });

  app = Fastify({ logger: false });

  /** `x-test-actor` steht für die Sitzungsauflösung aus B1 (wie in B5 und B8). */
  const kontoAus = (request: { headers: Record<string, unknown> }) => {
    const header = request.headers['x-test-actor'];

    return typeof header === 'string' ? (KONTEN[header] ?? null) : null;
  };

  registerRbac(app, { resolveActor: (request) => kontoAus(request)?.actor ?? null });

  await app.register(websocket);
  await app.register(async (instance) => {
    registerChatRoutes(instance, {
      chat,
      moderation,
      live: new (await import('./live.js')).ChatLiveHub(),
      ipHintOf: () => '10.0.0.x',
      resolveViewer: (request) => {
        const konto = kontoAus(request);

        return konto ? { id: konto.userId, displayName: konto.displayName } : null;
      },
    });
  });

  await app.ready();
});

async function anfrage(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  actor: string | null,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    ...(actor === null ? {} : { headers: { 'x-test-actor': actor } }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

describe('Envelope und Schranken', () => {
  it('antwortet ohne Sitzung mit AUTH_REQUIRED', async () => {
    const antwort = await anfrage('GET', '/api/chat/conversations', null);

    expect(antwort.statusCode).toBe(401);
    expect(antwort.json()).toMatchObject({ success: false, data: null });
    expect(antwort.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('liefert die eigene Konversationsliste im Envelope', async () => {
    await chat.openDirectConversation(ctxFor(ALEX), BEA);

    const antwort = await anfrage('GET', '/api/chat/conversations', 'alex');

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toMatchObject({ success: true, error: null });
    expect(antwort.json().data).toHaveLength(1);
  });

  it('lehnt eine ungültige Id als VALIDATION_FAILED ab, nicht mit einem 500er', async () => {
    const antwort = await anfrage('GET', '/api/chat/conversations/keine-uuid', 'alex');

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('meldet eine fremde Konversation als CONVERSATION_NOT_FOUND', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);

    const antwort = await anfrage('GET', `/api/chat/conversations/${conversation.id}`, 'chris');

    expect(antwort.statusCode).toBe(404);
    expect(antwort.json().error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('nimmt eine Nachricht an und gibt sie mit 201 zurück', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);

    const antwort = await anfrage(
      'POST',
      `/api/chat/conversations/${conversation.id}/messages`,
      'alex',
      { content: 'Hallo Bea' },
    );

    expect(antwort.statusCode).toBe(201);
    expect(antwort.json().data.content).toBe('Hallo Bea');
  });

  it('liefert das DM-Verzeichnis der zulässigen Empfänger im Envelope', async () => {
    // Alex besitzt SERVER, Bea ist Mitglied – also darf Alex Bea anschreiben.
    const antwort = await anfrage('GET', '/api/chat/recipients', 'alex');

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toMatchObject({ success: true, error: null });
    expect(antwort.json().data).toEqual([{ recipientId: BEA, displayName: 'Bea' }]);
  });

  it('verschließt das DM-Verzeichnis ohne Sitzung mit AUTH_REQUIRED', async () => {
    const antwort = await anfrage('GET', '/api/chat/recipients', null);

    expect(antwort.statusCode).toBe(401);
    expect(antwort.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('markiert eine Konversation als gelesen und gibt sie mit unreadCount 0 zurück', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    await chat.sendMessage(ctxFor(ALEX), conversation.id, { content: 'Hallo Bea' });

    const antwort = await anfrage('POST', `/api/chat/conversations/${conversation.id}/read`, 'bea');

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toMatchObject({ success: true, error: null });
    expect(antwort.json().data.unreadCount).toBe(0);
    expect(antwort.json().data.lastReadAt).not.toBeNull();
  });

  it('lässt eine fremde Konversation nicht als gelesen markieren', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);

    const antwort = await anfrage(
      'POST',
      `/api/chat/conversations/${conversation.id}/read`,
      'chris',
    );

    expect(antwort.statusCode).toBe(404);
    expect(antwort.json().error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('lehnt eine leere Nachricht mit VALIDATION_FAILED ab', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);

    const antwort = await anfrage(
      'POST',
      `/api/chat/conversations/${conversation.id}/messages`,
      'alex',
      { content: '   ' },
    );

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('Moderationsweg', () => {
  it('ist ohne message.moderate mit PERMISSION_DENIED verschlossen', async () => {
    const antwort = await anfrage('GET', '/api/moderation/reports', 'bea');

    expect(antwort.statusCode).toBe(403);
    expect(antwort.json().error.code).toBe('PERMISSION_DENIED');
  });

  it('zeigt der Moderation die offenen Meldungen', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, {
      content: 'Etwas Unschönes',
    });

    const gemeldet = await anfrage('POST', `/api/chat/messages/${nachricht.id}/report`, 'bea', {
      reason: 'Beleidigung',
    });

    expect(gemeldet.statusCode).toBe(201);

    const uebersicht = await anfrage('GET', '/api/moderation/reports', 'mod');

    expect(uebersicht.statusCode).toBe(200);
    expect(uebersicht.json().data.reports).toHaveLength(1);
    expect(uebersicht.json().data.reports[0].message.content).toBe('Etwas Unschönes');
  });

  /**
   * Der Moderationsweg führt ausschließlich über Meldungen. Es gibt keine
   * Route, die eine Konversation oder einen Verlauf anhand einer Permission
   * herausgibt (Pflichtenheft §15).
   */
  it('bietet keine Route an, die Konversationen anhand einer Permission öffnet', () => {
    const routen = app
      .printRoutes({ commonPrefix: false })
      .split('\n')
      .filter((zeile) => zeile.includes('moderation'));

    expect(routen.join('\n')).not.toMatch(/conversation|message[^R]/i);
  });

  /**
   * Derselbe Code wie für eine Id, die es gar nicht gibt (Audit W3-4,
   * `backend-community-visibility-09`): Der Unterschied zwischen beiden
   * Antworten wäre die Auskunft, dass die Nachricht existiert.
   */
  it('lässt einen Moderator eine fremde Nachricht nicht ohne Meldung anfassen', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, { content: 'Hallo' });

    const fremd = await anfrage('DELETE', `/api/chat/messages/${nachricht.id}`, 'mod');
    const unbekannt = await anfrage(
      'DELETE',
      `/api/chat/messages/00000000-0000-4000-8000-0000000000ff`,
      'mod',
    );

    expect(fremd.statusCode).toBe(404);
    expect(fremd.json().error.code).toBe('MESSAGE_NOT_FOUND');
    expect(unbekannt.statusCode).toBe(404);
    expect(unbekannt.json().error.code).toBe('MESSAGE_NOT_FOUND');
  });
});

/**
 * Missbrauchsgrenzen je Konto (Audit W2-3, `security-matrix-05`,
 * `backend-community-visibility-06`).
 *
 * Geprüft wird an der Route, nicht am Helfer: dass sie überhaupt einen Zähler
 * trägt, dass er je Konto läuft und dass die Ablehnung einen benannten Code im
 * Envelope aus Pflichtenheft §5.1 trägt.
 */
describe('Missbrauchsgrenzen', () => {
  it('lehnt den 31. Beitrag in der Minute mit 429 ab', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const url = `/api/chat/conversations/${conversation.id}/messages`;

    for (let nummer = 1; nummer <= ABUSE_LIMITS['chat.message'].maxAttempts; nummer += 1) {
      const angenommen = await anfrage('POST', url, 'alex', {
        content: `Beitrag ${String(nummer)}`,
      });

      expect(angenommen.statusCode).toBe(201);
    }

    const abgelehnt = await anfrage('POST', url, 'alex', { content: 'einer zu viel' });

    expect(abgelehnt.statusCode).toBe(429);
    expect(abgelehnt.json()).toMatchObject({
      success: false,
      data: null,
      error: { code: ABUSE_LIMIT_ERROR_CODE },
    });
  });

  it('trifft nur das Konto, das die Grenze reißt', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const url = `/api/chat/conversations/${conversation.id}/messages`;

    for (let nummer = 0; nummer <= ABUSE_LIMITS['chat.message'].maxAttempts; nummer += 1) {
      await anfrage('POST', url, 'alex', { content: `Beitrag ${String(nummer)}` });
    }

    expect((await anfrage('POST', url, 'alex', { content: 'noch einer' })).statusCode).toBe(429);
    expect((await anfrage('POST', url, 'bea', { content: 'Hallo Alex' })).statusCode).toBe(201);
  });

  it('lehnt die 11. Meldung in der Stunde mit 429 ab – auch die gescheiterten zählen', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, {
      content: 'Etwas Unschönes',
    });
    const url = `/api/chat/messages/${nachricht.id}/report`;

    /*
     * Nur der erste Versuch wird eine Meldung; die übrigen scheitern fachlich
     * (dieselbe Nachricht). Genau das ist der Punkt: Gezählt wird der Versuch,
     * sonst wäre die Grenze mit einem ungültigen Aufruf zu umgehen.
     */
    for (let nummer = 0; nummer < ABUSE_LIMITS['chat.report'].maxAttempts; nummer += 1) {
      const antwort = await anfrage('POST', url, 'bea', { reason: 'Beleidigung' });

      expect(antwort.statusCode).not.toBe(429);
    }

    const abgelehnt = await anfrage('POST', url, 'bea', { reason: 'Beleidigung' });

    expect(abgelehnt.statusCode).toBe(429);
    expect(abgelehnt.json().error.code).toBe(ABUSE_LIMIT_ERROR_CODE);
  });
});

/**
 * Audit W2-5, `security-matrix-04`: WebSocket-Handshakes unterliegen nicht
 * CORS. Eine fremde Seite konnte `wss://api.<domain>/api/chat/live` öffnen und
 * ab dann jede Nachricht des Opfers mitlesen – der Kanal pusht ohne Abo alle
 * eigenen Konversationen. Der Schutz hing allein an `SameSite=Lax`.
 */
describe('Herkunft des Handshakes (security-matrix-04)', () => {
  const PANEL = 'https://panel.example.tld';

  let kanalApp: FastifyInstance | null = null;

  async function baueApp(): Promise<FastifyInstance> {
    const instanz = Fastify({ logger: false });

    await instanz.register(websocket);
    await instanz.register(async (inner) => {
      registerChatRoutes(inner, {
        chat,
        // Der Live-Kanal fasst die Moderation nicht an; für den Handshake
        // genügt eine Attrappe.
        moderation: {} as ModerationService,
        live: new ChatLiveHub(),
        ipHintOf: () => null,
        resolveViewer: () => ({ id: ALEX, displayName: 'Alex' }),
        allowedOrigin: PANEL,
      });
    });

    await instanz.ready();

    return instanz;
  }

  afterEach(async () => {
    await kanalApp?.close();
    kanalApp = null;
  });

  it('lässt die konfigurierte Panel-Adresse durch', async () => {
    kanalApp = await baueApp();

    const socket = await kanalApp.injectWS('/api/chat/live', { headers: { origin: PANEL } });

    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
  });

  it('weist eine fremde Herkunft schon beim Handshake ab', async () => {
    kanalApp = await baueApp();

    await expect(
      kanalApp.injectWS('/api/chat/live', { headers: { origin: 'https://boese.example' } }),
    ).rejects.toThrow('403');
  });
});
