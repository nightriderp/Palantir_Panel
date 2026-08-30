/**
 * Drizzle-Implementierungen des Chat-Moduls (B7).
 *
 * Enthält ausschließlich Datenzugriff – jede fachliche Regel liegt in
 * `visibility.ts`, `permissions.ts` und den Diensten daneben, genauso wie in
 * B2 und B8.
 *
 * Die Anschlüsse an andere Arbeitspakete stehen hier ebenfalls, weil sie nur
 * Abfragen sind: der Teilnehmerkreis der Server-Chats kommt aus `game_servers`
 * und `server_members` (B3), der Freischaltstand eines Kontos aus `users` und
 * den Rollen (B2/B8). Beide Tabellen gehören anderen Paketen und werden hier
 * **nur gelesen**.
 */

import { GUEST_ROLE_NAME } from '@palantir/contracts';
import { type MessageReportQuery } from '@palantir/validation';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import {
  conversationParticipants,
  conversationReads,
  conversations,
  messageReports,
  messages,
} from '../../db/schema/chat.js';
import { roles, userRoles } from '../../db/schema/rbac.js';
import { gameServers, serverMembers } from '../../db/schema/server-orchestration.js';
import { users } from '../../db/schema/users.js';
import { ChatError } from './errors.js';
import type {
  ChatRepository,
  CreateConversationData,
  CreateMessageData,
  CreateReportData,
  MessagePage,
  MessageReportPage,
  ResolveReportData,
} from './repository.js';
import type {
  ChatServerMember,
  ChatServerRecord,
  ChatUserDirectory,
  ChatUserRecord,
  ConversationRecord,
  MessageRecord,
  MessageReportRecord,
  ServerMembershipSource,
} from './types.js';

// ---------------------------------------------------------------------------
// Zeilen → Datensätze
// ---------------------------------------------------------------------------

function toConversationRecord(row: typeof conversations.$inferSelect): ConversationRecord {
  return {
    id: row.id,
    type: row.type,
    serverId: row.serverId,
    dmKey: row.dmKey,
    createdAt: row.createdAt,
  };
}

function toMessageRecord(row: typeof messages.$inferSelect): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    content: row.content,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
    deletedById: row.deletedById,
  };
}

function toReportRecord(row: typeof messageReports.$inferSelect): MessageReportRecord {
  return {
    id: row.id,
    messageId: row.messageId,
    reportedById: row.reportedById,
    reason: row.reason,
    reportedContent: row.reportedContent,
    status: row.status,
    actionTaken: row.actionTaken,
    moderatorNote: row.moderatorNote,
    resolvedById: row.resolvedById,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Chat-Repository
// ---------------------------------------------------------------------------

export function createDrizzleChatRepository(db: Database): ChatRepository {
  return {
    async findConversation(conversationId: string): Promise<ConversationRecord | null> {
      const [row] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);

      return row ? toConversationRecord(row) : null;
    },

    async findConversationByDmKey(dmKey: string): Promise<ConversationRecord | null> {
      const [row] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.dmKey, dmKey))
        .limit(1);

      return row ? toConversationRecord(row) : null;
    },

    async findConversationByServerId(serverId: string): Promise<ConversationRecord | null> {
      const [row] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.serverId, serverId))
        .limit(1);

      return row ? toConversationRecord(row) : null;
    },

    async createConversation(data: CreateConversationData): Promise<ConversationRecord> {
      /*
       * Konversation und Teilnehmer entstehen gemeinsam oder gar nicht: Eine
       * DM ohne Teilnehmerzeilen wäre für niemanden sichtbar und ließe sich
       * wegen des eindeutigen `dm_key` auch nicht neu anlegen.
       */
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(conversations)
          .values({ type: data.type, serverId: data.serverId, dmKey: data.dmKey })
          .returning();

        if (!row) {
          throw new ChatError(
            'CONVERSATION_NOT_FOUND',
            'Die Unterhaltung konnte nicht angelegt werden.',
          );
        }

        if (data.participantIds.length > 0) {
          await tx
            .insert(conversationParticipants)
            .values(data.participantIds.map((userId) => ({ conversationId: row.id, userId })));
        }

        return toConversationRecord(row);
      });
    },

    async listDirectParticipants(conversationId: string): Promise<readonly string[]> {
      const rows = await db
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.conversationId, conversationId));

      return rows.map((row) => row.userId);
    },

    async listDirectConversationsForUser(userId: string): Promise<readonly ConversationRecord[]> {
      const rows = await db
        .select({ conversation: conversations })
        .from(conversationParticipants)
        .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
        .where(eq(conversationParticipants.userId, userId));

      return rows.map((row) => toConversationRecord(row.conversation));
    },

    async createMessage(data: CreateMessageData): Promise<MessageRecord> {
      const [row] = await db
        .insert(messages)
        .values({
          conversationId: data.conversationId,
          senderId: data.senderId,
          content: data.content,
        })
        .returning();

      if (!row) {
        throw new ChatError('MESSAGE_NOT_FOUND', 'Die Nachricht konnte nicht gespeichert werden.');
      }

      return toMessageRecord(row);
    },

    async findMessage(messageId: string): Promise<MessageRecord | null> {
      const [row] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);

      return row ? toMessageRecord(row) : null;
    },

    async listMessages(
      conversationId: string,
      options: { readonly limit: number; readonly before?: string },
    ): Promise<MessagePage> {
      /*
       * Ein Datensatz mehr als angefragt: Daran erkennt der Aufrufer, ob es
       * davor noch weitere gibt, ohne eine zweite Zählabfrage.
       */
      const fetchLimit = options.limit + 1;

      let cutoff: Date | null = null;

      if (options.before !== undefined) {
        const [anchor] = await db
          .select({ createdAt: messages.createdAt })
          .from(messages)
          .where(eq(messages.id, options.before))
          .limit(1);

        if (!anchor) {
          throw new ChatError('MESSAGE_NOT_FOUND');
        }

        cutoff = anchor.createdAt;
      }

      const rows = await db
        .select()
        .from(messages)
        .where(
          cutoff === null
            ? eq(messages.conversationId, conversationId)
            : and(eq(messages.conversationId, conversationId), lt(messages.createdAt, cutoff)),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(fetchLimit);

      const hasMore = rows.length > options.limit;

      return {
        messages: rows.slice(0, options.limit).map(toMessageRecord),
        hasMore,
      };
    },

    async lastMessages(
      conversationIds: readonly string[],
    ): Promise<ReadonlyMap<string, MessageRecord>> {
      if (conversationIds.length === 0) {
        return new Map();
      }

      /*
       * Je Konversation eine Abfrage mit `limit 1` über den Index
       * `messages_conversation_created_idx`. Bewusst so und nicht als eine
       * Abfrage über alle Konversationen: Die Alternative wäre `DISTINCT ON` in
       * rohem SQL – die Anzahl ist hier durch die Konversationen **eines**
       * Kontos begrenzt (Dutzende, nicht Tausende), und jede Abfrage liest
       * genau eine Zeile.
       */
      const newest = new Map<string, MessageRecord>();

      const rows = await Promise.all(
        conversationIds.map(async (conversationId) => {
          const [row] = await db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, conversationId))
            .orderBy(desc(messages.createdAt), desc(messages.id))
            .limit(1);

          return row ?? null;
        }),
      );

      for (const row of rows) {
        if (row) {
          newest.set(row.conversationId, toMessageRecord(row));
        }
      }

      return newest;
    },

    async markMessageDeleted(
      messageId: string,
      deletedById: string,
      deletedAt: Date,
    ): Promise<void> {
      await db.update(messages).set({ deletedAt, deletedById }).where(eq(messages.id, messageId));
    },

    async markConversationRead(conversationId: string, userId: string, at: Date): Promise<void> {
      /*
       * Upsert auf den Primärschlüssel (conversation_id, user_id): Der erste
       * Lesevorgang legt die Zeile an, jeder weitere schiebt `last_read_at`
       * nach vorn. Kein separates „gibt es schon?" davor – das wäre eine zweite
       * Abfrage mit einer Lücke für gleichzeitige Aufrufe.
       */
      await db
        .insert(conversationReads)
        .values({ conversationId, userId, lastReadAt: at })
        .onConflictDoUpdate({
          target: [conversationReads.conversationId, conversationReads.userId],
          set: { lastReadAt: at },
        });
    },

    async lastReadAtFor(
      userId: string,
      conversationIds: readonly string[],
    ): Promise<ReadonlyMap<string, Date>> {
      if (conversationIds.length === 0) {
        return new Map();
      }

      const rows = await db
        .select({
          conversationId: conversationReads.conversationId,
          lastReadAt: conversationReads.lastReadAt,
        })
        .from(conversationReads)
        .where(
          and(
            eq(conversationReads.userId, userId),
            inArray(conversationReads.conversationId, [...conversationIds]),
          ),
        );

      return new Map(rows.map((row) => [row.conversationId, row.lastReadAt]));
    },

    async unreadCounts(
      userId: string,
      conversationIds: readonly string[],
    ): Promise<ReadonlyMap<string, number>> {
      if (conversationIds.length === 0) {
        return new Map();
      }

      /*
       * Eine Abfrage über alle Konversationen: Nachrichten nach dem jeweiligen
       * Lesestand (per `left join` auf `conversation_reads`; fehlt der Eintrag,
       * gilt alles als ungelesen), nicht vom Aufrufer selbst und nicht gelöscht.
       * Konversationen ohne Treffer fallen aus dem Ergebnis – sie zählen `0`.
       */
      const rows = await db
        .select({ conversationId: messages.conversationId, value: count() })
        .from(messages)
        .leftJoin(
          conversationReads,
          and(
            eq(conversationReads.conversationId, messages.conversationId),
            eq(conversationReads.userId, userId),
          ),
        )
        .where(
          and(
            inArray(messages.conversationId, [...conversationIds]),
            ne(messages.senderId, userId),
            isNull(messages.deletedAt),
            or(
              isNull(conversationReads.lastReadAt),
              gt(messages.createdAt, conversationReads.lastReadAt),
            ),
          ),
        )
        .groupBy(messages.conversationId);

      return new Map(rows.map((row) => [row.conversationId, row.value]));
    },

    async createReport(data: CreateReportData): Promise<MessageReportRecord> {
      const [row] = await db
        .insert(messageReports)
        .values({
          messageId: data.messageId,
          reportedById: data.reportedById,
          reason: data.reason,
          reportedContent: data.reportedContent,
        })
        .returning();

      if (!row) {
        throw new ChatError(
          'MESSAGE_REPORT_NOT_FOUND',
          'Die Meldung konnte nicht gespeichert werden.',
        );
      }

      return toReportRecord(row);
    },

    async findReport(reportId: string): Promise<MessageReportRecord | null> {
      const [row] = await db
        .select()
        .from(messageReports)
        .where(eq(messageReports.id, reportId))
        .limit(1);

      return row ? toReportRecord(row) : null;
    },

    async findReportByMessageAndReporter(
      messageId: string,
      reportedById: string,
    ): Promise<MessageReportRecord | null> {
      const [row] = await db
        .select()
        .from(messageReports)
        .where(
          and(
            eq(messageReports.messageId, messageId),
            eq(messageReports.reportedById, reportedById),
          ),
        )
        .limit(1);

      return row ? toReportRecord(row) : null;
    },

    async reportedMessageIds(
      reportedById: string,
      messageIds: readonly string[],
    ): Promise<ReadonlySet<string>> {
      if (messageIds.length === 0) {
        return new Set();
      }

      const rows = await db
        .select({ messageId: messageReports.messageId })
        .from(messageReports)
        .where(
          and(
            eq(messageReports.reportedById, reportedById),
            inArray(messageReports.messageId, [...messageIds]),
          ),
        );

      return new Set(rows.map((row) => row.messageId));
    },

    async listReports(query: MessageReportQuery): Promise<MessageReportPage> {
      const filter = eq(messageReports.status, query.status);

      const [rows, [totals]] = await Promise.all([
        db
          .select()
          .from(messageReports)
          .where(filter)
          .orderBy(desc(messageReports.createdAt))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ value: count() }).from(messageReports).where(filter),
      ]);

      return {
        reports: rows.map(toReportRecord),
        total: totals?.value ?? 0,
      };
    },

    async resolveReport(reportId: string, data: ResolveReportData): Promise<MessageReportRecord> {
      const [row] = await db
        .update(messageReports)
        .set({
          status: data.status,
          actionTaken: data.actionTaken,
          moderatorNote: data.moderatorNote,
          resolvedById: data.resolvedById,
          resolvedAt: data.resolvedAt,
        })
        .where(eq(messageReports.id, reportId))
        .returning();

      if (!row) {
        throw new ChatError('MESSAGE_REPORT_NOT_FOUND');
      }

      return toReportRecord(row);
    },
  };
}

// ---------------------------------------------------------------------------
// Anschluss an B1/B2/B8: Konten
// ---------------------------------------------------------------------------

/**
 * Freischaltstand eines Kontos (Lastenheft §3.6).
 *
 * Dieselbe Regel wie in der Freischalt-Warteliste aus B8 (`statusOf()`): Ein
 * Konto, das nur die Systemrolle „Gast" trägt, wartet noch auf seine Freigabe.
 * Ausgewertet wird sie hier in SQL, weil der Chat sie für einzelne Konten
 * braucht und nicht die ganze Warteliste laden soll.
 */
export function createDrizzleChatUserDirectory(db: Database): ChatUserDirectory {
  return {
    async find(userId: string): Promise<ChatUserRecord | null> {
      const [row] = await db
        .select({ id: users.id, displayName: users.displayName, banned: users.banned })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!row) {
        return null;
      }

      const [approvedRole] = await db
        .select({ id: userRoles.roleId })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(and(eq(userRoles.userId, userId), ne(roles.name, GUEST_ROLE_NAME)))
        .limit(1);

      return {
        id: row.id,
        displayName: row.displayName,
        banned: row.banned,
        approved: !row.banned && approvedRole !== undefined,
      };
    },

    async displayNames(userIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
      if (userIds.length === 0) {
        return new Map();
      }

      const rows = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, [...userIds]));

      return new Map(rows.map((row) => [row.id, row.displayName]));
    },

    async listByIds(userIds: readonly string[]): Promise<readonly ChatUserRecord[]> {
      if (userIds.length === 0) {
        return [];
      }

      const rows = await db
        .select({ id: users.id, displayName: users.displayName, banned: users.banned })
        .from(users)
        .where(inArray(users.id, [...userIds]));

      /*
       * Freischaltstand in einer zweiten Abfrage für die ganze Menge – dieselbe
       * Regel wie in `find` (eine Rolle außer „Gast"), nur gebündelt statt je
       * Konto einzeln.
       */
      const approvedRows = await db
        .selectDistinct({ userId: userRoles.userId })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(and(inArray(userRoles.userId, [...userIds]), ne(roles.name, GUEST_ROLE_NAME)));

      const approvedIds = new Set(approvedRows.map((row) => row.userId));

      return rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        banned: row.banned,
        approved: !row.banned && approvedIds.has(row.id),
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Anschluss an B3: Teilnehmerkreis der Server-Chats
// ---------------------------------------------------------------------------

/**
 * Liest `game_servers` und `server_members` (beide gehören B3) – ausschließlich
 * lesend. Der Teilnehmerkreis wird bei jeder Prüfung frisch geholt, damit „folgt
 * `ServerMember`" (Pflichtenheft §15) auch nach einer Mitgliederänderung
 * stimmt.
 */
export function createDrizzleServerMembershipSource(db: Database): ServerMembershipSource {
  return {
    async findServer(serverId: string): Promise<ChatServerRecord | null> {
      const [row] = await db
        .select({ id: gameServers.id, name: gameServers.name, ownerId: gameServers.ownerId })
        .from(gameServers)
        .where(eq(gameServers.id, serverId))
        .limit(1);

      return row ?? null;
    },

    async listMembers(serverId: string): Promise<readonly ChatServerMember[]> {
      const rows = await db
        .select({ userId: serverMembers.userId, level: serverMembers.permissionLevel })
        .from(serverMembers)
        .where(eq(serverMembers.serverId, serverId))
        .orderBy(asc(serverMembers.addedAt));

      return rows;
    },

    async listServerIdsForUser(userId: string): Promise<readonly string[]> {
      const rows = await db
        .selectDistinct({ id: gameServers.id })
        .from(gameServers)
        .leftJoin(serverMembers, eq(serverMembers.serverId, gameServers.id))
        .where(or(eq(gameServers.ownerId, userId), eq(serverMembers.userId, userId)));

      return rows.map((row) => row.id);
    },
  };
}
