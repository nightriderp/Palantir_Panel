/**
 * REST-Routen des Chats.
 *
 * Geprüft wird, dass die Antworten dem Envelope aus Pflichtenheft §5.1 folgen,
 * dass Fehler benannte Codes tragen – und dass der Moderationsweg ohne
 * `message.moderate` gar nicht erst in den Handler kommt.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { beforeEach, describe, expect, it } from 'vitest';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { createModerationService } from './moderation.js';
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

  it('lässt einen Moderator eine fremde Nachricht nicht ohne Meldung anfassen', async () => {
    const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversation.id, { content: 'Hallo' });

    const antwort = await anfrage('DELETE', `/api/chat/messages/${nachricht.id}`, 'mod');

    expect(antwort.statusCode).toBe(404);
    expect(antwort.json().error.code).toBe('CONVERSATION_NOT_FOUND');
  });
});
