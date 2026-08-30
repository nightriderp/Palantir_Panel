/**
 * REST- und WebSocket-Routen des Chats (Pflichtenheft §5, §15).
 *
 * Alle Antworten laufen über `ok()`/`fail()` aus `@palantir/contracts` – der
 * Envelope aus §5.1 wird nirgends von Hand gebaut. Eingaben werden
 * ausschließlich gegen die Zod-Schemas aus `@palantir/validation` geprüft.
 *
 * **Zwei getrennte Wege, mit Absicht:**
 * - `/api/chat/...` – der Teilnehmerweg. Rechte hängen an der Teilnahme, nicht
 *   an einer Permission; deshalb steht vor diesen Routen kein `requirePermission`.
 * - `/api/moderation/reports...` – der Moderationsweg. Hier steht der Guard aus
 *   B2 mit `message.moderate` davor, und dahinter prüft der Dienst noch einmal.
 *   Über diesen Weg ist ausschließlich Gemeldetes erreichbar.
 *
 * Es gibt bewusst **keine** Route, die eine Konversation oder einen Verlauf
 * anhand einer Permission statt anhand der Teilnahme herausgibt
 * (Pflichtenheft §15, CLAUDE.md §2).
 */

import { fail, httpStatusForErrorCode, ok } from '@palantir/contracts';
import {
  createDirectConversationInputSchema,
  idSchema,
  messagePageQuerySchema,
  messageReportQuerySchema,
  reportMessageInputSchema,
  resolveMessageReportInputSchema,
  sendMessageInputSchema,
} from '@palantir/validation';
import { type WebSocket } from '@fastify/websocket';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isRbacError, requireActor, requirePermission } from '../rbac/index.js';
import { type ChatContext, contextOf } from './context.js';
import { isChatError } from './errors.js';
import { type ChatLiveHub } from './live.js';
import { type ModerationService } from './moderation.js';
import { type ChatService } from './service.js';

const conversationParamsSchema = z.object({ conversationId: idSchema });
const messageParamsSchema = z.object({ messageId: idSchema });
const reportParamsSchema = z.object({ reportId: idSchema });
const serverParamsSchema = z.object({ serverId: idSchema });

export interface ChatRoutesOptions {
  readonly chat: ChatService;
  readonly moderation: ModerationService;
  readonly live: ChatLiveHub;
  /** Grobe Herkunft des Requests für den Audit-Eintrag (Pflichtenheft §6). */
  ipHintOf(request: FastifyRequest): string | null;
  /** Konto des Aufrufers aus der Sitzung (B1). */
  resolveViewer(request: FastifyRequest): { id: string; displayName: string } | null;
}

/** Verdichtet die Zod-Fehler zu einer lesbaren Meldung – ohne den Rohbaum auszuliefern. */
function describeValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');
}

/**
 * Wandelt einen Fehler in die Antwort aus §5.1 um.
 *
 * Ungültige Pfad-, Query- oder Körperwerte werden zu `VALIDATION_FAILED` – wie
 * in B5 und B8, damit eine falsche Eingabe nicht als 500er erscheint.
 */
async function replyWithError(reply: FastifyReply, error: unknown): Promise<void> {
  if (isChatError(error)) {
    await reply.status(httpStatusForErrorCode(error.code)).send(fail(error.code, error.message));

    return;
  }

  if (isRbacError(error)) {
    await reply.status(httpStatusForErrorCode(error.code)).send(fail(error.code, error.message));

    return;
  }

  if (error instanceof z.ZodError) {
    await reply
      .status(httpStatusForErrorCode('VALIDATION_FAILED'))
      .send(fail('VALIDATION_FAILED', describeValidationError(error)));

    return;
  }

  throw error;
}

export function registerChatRoutes(app: FastifyInstance, options: ChatRoutesOptions): void {
  const { chat, moderation, live } = options;

  function contextFrom(request: FastifyRequest): ChatContext {
    const actor = requireActor(request);
    const viewer = options.resolveViewer(request);

    return contextOf(actor, {
      userId: viewer?.id ?? null,
      displayName: viewer?.displayName ?? null,
      ipHint: options.ipHintOf(request),
    });
  }

  // -- Konversationen ---------------------------------------------------------

  app.get('/api/chat/conversations', async (request, reply) => {
    try {
      return await reply.send(ok(await chat.listConversations(contextFrom(request))));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.get('/api/chat/conversations/:conversationId', async (request, reply) => {
    try {
      const { conversationId } = conversationParamsSchema.parse(request.params);

      return await reply.send(ok(await chat.getConversation(contextFrom(request), conversationId)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  /** Öffnet die Unterhaltung mit einem anderen Konto und legt sie beim ersten Mal an. */
  app.post('/api/chat/conversations/direct', async (request, reply) => {
    try {
      const input = createDirectConversationInputSchema.parse(request.body);

      return await reply.send(
        ok(await chat.openDirectConversation(contextFrom(request), input.recipientId)),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  /**
   * Zulässige DM-Empfänger für den Aufrufer (Pflichtenheft §15).
   *
   * Teilnehmerweg wie die übrigen `/api/chat`-Routen: kein `requirePermission`.
   * Der Dienst gibt nur Konten heraus, mit denen der Aufrufer ohnehin einen
   * Server teilt – kein globales Nutzerverzeichnis.
   */
  app.get('/api/chat/recipients', async (request, reply) => {
    try {
      return await reply.send(ok(await chat.listDirectMessageRecipients(contextFrom(request))));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  /**
   * Gruppen-Chat eines Servers. Legt ihn beim ersten Zugriff an – fachlich
   * dasselbe wie „entsteht automatisch mit dem Server" (Pflichtenheft §15),
   * ohne Eingriff in die Server-Orchestrierung.
   */
  app.get('/api/chat/servers/:serverId/conversation', async (request, reply) => {
    try {
      const { serverId } = serverParamsSchema.parse(request.params);

      return await reply.send(
        ok(await chat.openServerConversation(contextFrom(request), serverId)),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Nachrichten ------------------------------------------------------------

  app.get('/api/chat/conversations/:conversationId/messages', async (request, reply) => {
    try {
      const { conversationId } = conversationParamsSchema.parse(request.params);
      const query = messagePageQuerySchema.parse(request.query);

      return await reply.send(
        ok(await chat.listMessages(contextFrom(request), conversationId, query)),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.post('/api/chat/conversations/:conversationId/messages', async (request, reply) => {
    try {
      const { conversationId } = conversationParamsSchema.parse(request.params);
      const input = sendMessageInputSchema.parse(request.body);

      return await reply
        .status(201)
        .send(ok(await chat.sendMessage(contextFrom(request), conversationId, input)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  /**
   * Markiert eine Konversation als gelesen (Fundpunkt 95).
   *
   * Teilnehmerweg wie die übrigen `/api/chat`-Routen: kein `requirePermission`.
   * Ohne Körper – der Lesestand wird auf den Serverzeitpunkt gesetzt. Antwort
   * ist die aktualisierte Konversation (mit `unreadCount` und `lastReadAt`).
   */
  app.post('/api/chat/conversations/:conversationId/read', async (request, reply) => {
    try {
      const { conversationId } = conversationParamsSchema.parse(request.params);

      return await reply.send(
        ok(await chat.markConversationRead(contextFrom(request), conversationId)),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.delete('/api/chat/messages/:messageId', async (request, reply) => {
    try {
      const { messageId } = messageParamsSchema.parse(request.params);

      await chat.deleteOwnMessage(contextFrom(request), messageId);

      return await reply.send(ok(null));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Melden -----------------------------------------------------------------
  // Bewusst unter `/api/chat`: Melden ist eine Teilnehmer-Aktion, keine
  // Moderationsaktion. Sie setzt die Teilnahme an der Konversation voraus und
  // verlangt keine Permission.

  app.post('/api/chat/messages/:messageId/report', async (request, reply) => {
    try {
      const { messageId } = messageParamsSchema.parse(request.params);
      const input = reportMessageInputSchema.parse(request.body);

      return await reply
        .status(201)
        .send(ok(await moderation.reportMessage(contextFrom(request), messageId, input.reason)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Moderation -------------------------------------------------------------
  // Ausschließlich gemeldete Nachrichten. Es gibt hier keine Route, die eine
  // Konversation, einen Verlauf oder eine Suche über Nachrichten anbietet.

  app.get(
    '/api/moderation/reports',
    { preHandler: requirePermission('message.moderate') },
    async (request, reply) => {
      try {
        const query = messageReportQuerySchema.parse(request.query);

        return await reply.send(ok(await moderation.listReports(contextFrom(request), query)));
      } catch (error: unknown) {
        return replyWithError(reply, error);
      }
    },
  );

  app.get(
    '/api/moderation/reports/:reportId',
    { preHandler: requirePermission('message.moderate') },
    async (request, reply) => {
      try {
        const { reportId } = reportParamsSchema.parse(request.params);

        return await reply.send(ok(await moderation.getReport(contextFrom(request), reportId)));
      } catch (error: unknown) {
        return replyWithError(reply, error);
      }
    },
  );

  app.post(
    '/api/moderation/reports/:reportId/resolve',
    { preHandler: requirePermission('message.moderate') },
    async (request, reply) => {
      try {
        const { reportId } = reportParamsSchema.parse(request.params);
        const input = resolveMessageReportInputSchema.parse(request.body);

        return await reply.send(
          ok(await moderation.resolveReport(contextFrom(request), reportId, input)),
        );
      } catch (error: unknown) {
        return replyWithError(reply, error);
      }
    },
  );

  // -- Live-Kanal -------------------------------------------------------------

  /**
   * Der Kanal aus Pflichtenheft §5.3.
   *
   * Authentifiziert wird über dieselbe Sitzung wie bei den REST-Routen (B1) –
   * die `onRequest`-Hooks laufen auch beim WebSocket-Handshake. Ohne
   * angemeldetes Konto wird die Verbindung gar nicht erst angenommen; ein
   * anonymer Kanal hätte keinen Teilnehmerkreis und damit keinen Inhalt.
   *
   * Der Browser schickt hierüber nichts: Gesendet wird über die REST-Route
   * oben. Eingehende Frames werden deshalb verworfen.
   */
  app.get('/api/chat/live', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    const viewer = options.resolveViewer(request);

    if (!viewer) {
      socket.close(4401, 'Nicht angemeldet.');

      return;
    }

    const unregister = live.register(viewer.id, {
      send: (data: string) => {
        socket.send(data);
      },
    });

    socket.on('close', unregister);
    socket.on('error', unregister);
  });
}
