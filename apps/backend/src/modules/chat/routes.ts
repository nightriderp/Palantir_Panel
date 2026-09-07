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
import { accountRateLimit } from '../../lib/abuse-limits.js';
import { isRbacError, requireActor, requirePermission } from '../rbac/index.js';
import { type ChatContext, contextOf } from './context.js';
import { isChatError } from './errors.js';
import { CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED, type ChatLiveHub, startChatHeartbeat } from './live.js';
import { type ModerationService } from './moderation.js';
import { type ChatService } from './service.js';

const conversationParamsSchema = z.object({ conversationId: idSchema });
const messageParamsSchema = z.object({ messageId: idSchema });
const reportParamsSchema = z.object({ reportId: idSchema });
const serverParamsSchema = z.object({ serverId: idSchema });

/** Abstand der wiederkehrenden Sitzungsprüfung am offenen Live-Kanal. */
const SESSION_CHECK_INTERVAL_MS = 60_000;

export interface ChatRoutesOptions {
  readonly chat: ChatService;
  readonly moderation: ModerationService;
  readonly live: ChatLiveHub;
  /** Grobe Herkunft des Requests für den Audit-Eintrag (Pflichtenheft §6). */
  ipHintOf(request: FastifyRequest): string | null;
  /** Konto des Aufrufers aus der Sitzung (B1). */
  resolveViewer(request: FastifyRequest): { id: string; displayName: string } | null;
  /**
   * Gilt die Sitzung des Handshakes noch? (Audit W2-2,
   * `backend-community-visibility-03`.)
   *
   * Wird am offenen Live-Kanal wiederkehrend gefragt, weil Sperre und
   * Sitzungswiderruf sonst erst beim nächsten REST-Aufruf wirken. Optional:
   * Ohne diese Abhängigkeit bleibt es beim Schließen über
   * `ChatLiveHub.closeAll()` – geöffnet wird dadurch nichts.
   */
  isSessionValid?(request: FastifyRequest): Promise<boolean>;
  /** Abstand der Sitzungsprüfung; Vorgabe 60 s. Nur für Tests gedacht. */
  readonly sessionCheckIntervalMs?: number;
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

  /*
   * Missbrauchsgrenzen je Konto (Audit W2-3, `security-matrix-05`,
   * `backend-community-visibility-06`).
   *
   * Beide Zähler entstehen **hier**, einmal je Registrierung – nicht im
   * Handler, sonst begänne jede Anfrage bei null. Die Identität ist die
   * Konto-Id aus derselben Sitzungsauflösung, aus der auch der Handelnde kommt.
   */
  const messageLimit = accountRateLimit({
    scope: 'chat.message',
    resolveUserId: (request) => options.resolveViewer(request)?.id ?? null,
  });

  const reportLimit = accountRateLimit({
    scope: 'chat.report',
    resolveUserId: (request) => options.resolveViewer(request)?.id ?? null,
  });

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

  /*
   * Der teuerste Pfad des Moduls: Schreiben plus Live-Zustellung an jeden
   * Teilnehmer. Deshalb steht hier die engste Grenze (30/min je Konto,
   * `security-matrix-05` Szenario a).
   */
  app.post(
    '/api/chat/conversations/:conversationId/messages',
    { preHandler: messageLimit },
    async (request, reply) => {
      try {
        const { conversationId } = conversationParamsSchema.parse(request.params);
        const input = sendMessageInputSchema.parse(request.body);

        return await reply
          .status(201)
          .send(ok(await chat.sendMessage(contextFrom(request), conversationId, input)));
      } catch (error: unknown) {
        return replyWithError(reply, error);
      }
    },
  );

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

  /*
   * Melden ist eine Ausnahmehandlung, kein Dauerbetrieb: 10/h je Konto. Ohne
   * die Grenze konnte ein Konto jede Nachricht melden und die
   * Moderationsansicht damit unbrauchbar machen (`security-matrix-05`
   * Szenario b).
   */
  app.post(
    '/api/chat/messages/:messageId/report',
    { preHandler: reportLimit },
    async (request, reply) => {
      try {
        const { messageId } = messageParamsSchema.parse(request.params);
        const input = reportMessageInputSchema.parse(request.body);

        return await reply
          .status(201)
          .send(ok(await moderation.reportMessage(contextFrom(request), messageId, input.reason)));
      } catch (error: unknown) {
        return replyWithError(reply, error);
      }
    },
  );

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
   *
   * Die Sitzung wird **nicht nur** im Handshake geprüft: Solange die Verbindung
   * steht, fragt der Kanal wiederkehrend nach, ob sie noch gilt, und schließt
   * sonst. Eine Sperre oder ein Remote-Logout wirkte sonst erst beim nächsten
   * REST-Aufruf – der offene Socket bekam bis dahin weiter private Nachrichten
   * (Audit W2-2, `backend-community-visibility-03`).
   */
  app.get('/api/chat/live', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    const viewer = options.resolveViewer(request);

    if (!viewer) {
      socket.close(CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED, 'Nicht angemeldet.');

      return;
    }

    const unregister = live.register(viewer.id, {
      send: (data: string) => {
        socket.send(data);
      },
      close: (code: number, reason?: string) => {
        socket.close(code, reason);
      },
    });

    const check = options.isSessionValid;
    const timer =
      check === undefined
        ? null
        : setInterval(() => {
            void (async (): Promise<void> => {
              /*
               * Ein Fehler beim Nachsehen (Datenbank kurz weg) darf die
               * Verbindung nicht kappen: Die REST-Seite entscheidet dann
               * ohnehin bei der nächsten Anfrage. Nur ein klares „gilt nicht
               * mehr" schließt.
               */
              let valid = true;

              try {
                valid = await check(request);
              } catch {
                return;
              }

              if (!valid) {
                socket.close(CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED, 'Sitzung nicht mehr gültig.');
              }
            })();
          }, options.sessionCheckIntervalMs ?? SESSION_CHECK_INTERVAL_MS);

    // Der Zeitgeber darf das Beenden des Prozesses nicht aufhalten.
    timer?.unref();

    /*
     * Server-seitiges Lebenszeichen (Audit W2-3,
     * `backend-community-visibility-11`): Eine halboffene Verbindung meldet
     * weder `close` noch `error` und bliebe sonst bis zum TCP-Timeout im
     * Verteiler – samt ihrer Kopie jeder Zustellung.
     */
    const stopHeartbeat = startChatHeartbeat(socket);

    const cleanup = (): void => {
      if (timer) {
        clearInterval(timer);
      }

      stopHeartbeat();
      unregister();
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}
