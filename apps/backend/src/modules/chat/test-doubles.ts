/**
 * Attrappen für die Tests des Chat-Moduls.
 *
 * Alle Regeln dieses Moduls sind ohne laufende PostgreSQL-Instanz prüfbar
 * (CLAUDE.md §4) – genau dafür stehen Persistenz und die Anschlüsse an B1/B3/B8
 * hinter Schnittstellen.
 *
 * Die Datei liegt bewusst neben dem Modul und nicht in einem `__mocks__`-Ordner:
 * Sie gehört zum Modul und ändert sich mit ihm.
 */

import { type AuditAction, type MessageReportStatus } from '@palantir/contracts';
import { type MessageReportQuery } from '@palantir/validation';
import { type AppendAuditEntry, type AuditService } from '../admin/index.js';
import { type PermissionActor, buildPermissionActor } from '../rbac/index.js';
import { type ChatContext, contextOf } from './context.js';
import { ChatError } from './errors.js';
import { type ChatDelivery } from './live.js';
import { type ChatEventPayloads, type ChatEventPublisher } from './moderation.js';
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
  ChatServerRecord,
  ChatUserDirectory,
  ChatUserRecord,
  Clock,
  ConversationRecord,
  MessageRecord,
  MessageReportRecord,
  ServerMembershipSource,
} from './types.js';

/** Erzeugt gültige, gut lesbare Test-UUIDs. */
export function testId(seed: string): string {
  const body = seed.padStart(12, '0');

  return `00000000-0000-4000-8000-${body}`;
}

export const ALEX = testId('a1');
export const BEA = testId('b2');
export const CHRIS = testId('c3');
export const MOD = testId('d4');
export const SERVER_ID = testId('5e');

export function actorWith(
  ...permissions: Parameters<typeof buildPermissionActor>[0]['roles'][number]['grantedPermissions']
): PermissionActor {
  return buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: permissions }] });
}

export function ownerActor(): PermissionActor {
  return buildPermissionActor({ isOwner: true, roles: [] });
}

export function ctxFor(userId: string, actor: PermissionActor = actorWith()): ChatContext {
  return contextOf(actor, { userId, displayName: `Konto ${userId.slice(-2)}`, ipHint: '10.0.0.x' });
}

/** Uhr, die bei jedem Aufruf eine Sekunde weiterläuft – hält Reihenfolgen stabil. */
export function steppingClock(start = new Date('2026-08-26T12:00:00.000Z')): Clock {
  let current = start.getTime();

  return {
    now: () => {
      current += 1000;

      return new Date(current);
    },
  };
}

// ---------------------------------------------------------------------------
// Konten (Anschluss B1/B2/B8)
// ---------------------------------------------------------------------------

export function fakeUserDirectory(
  users: Record<string, Partial<ChatUserRecord> & { displayName: string }>,
): ChatUserDirectory {
  return {
    async find(userId) {
      const user = users[userId];

      return user
        ? {
            id: userId,
            displayName: user.displayName,
            banned: user.banned ?? false,
            approved: user.approved ?? true,
          }
        : null;
    },

    async displayNames(userIds) {
      const result = new Map<string, string>();

      for (const userId of userIds) {
        const user = users[userId];

        if (user) {
          result.set(userId, user.displayName);
        }
      }

      return result;
    },

    async listByIds(userIds) {
      const result: ChatUserRecord[] = [];

      for (const userId of userIds) {
        const user = users[userId];

        if (user) {
          result.push({
            id: userId,
            displayName: user.displayName,
            banned: user.banned ?? false,
            approved: user.approved ?? true,
          });
        }
      }

      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Teilnehmerkreis der Server-Chats (Anschluss B3)
// ---------------------------------------------------------------------------

export interface FakeServerMembership extends ServerMembershipSource {
  /** Mitglieder eines Servers ändern – für den Test „entfernt = draußen". */
  setMembers(serverId: string, userIds: readonly string[]): void;
}

export function fakeServerMembership(
  servers: readonly ChatServerRecord[],
  members: Record<string, readonly string[]> = {},
): FakeServerMembership {
  const memberMap = new Map<string, string[]>(
    Object.entries(members).map(([serverId, userIds]) => [serverId, [...userIds]]),
  );

  return {
    setMembers(serverId, userIds) {
      memberMap.set(serverId, [...userIds]);
    },

    async findServer(serverId) {
      return servers.find((server) => server.id === serverId) ?? null;
    },

    async listMembers(serverId) {
      return (memberMap.get(serverId) ?? []).map((userId) => ({
        userId,
        level: 'viewer' as const,
      }));
    },

    async listServerIdsForUser(userId) {
      return servers
        .filter(
          (server) =>
            server.ownerId === userId || (memberMap.get(server.id) ?? []).includes(userId),
        )
        .map((server) => server.id);
    },
  };
}

// ---------------------------------------------------------------------------
// Persistenz
// ---------------------------------------------------------------------------

export interface InMemoryChatRepository extends ChatRepository {
  readonly conversations: ConversationRecord[];
  readonly participants: { conversationId: string; userId: string }[];
  readonly messages: MessageRecord[];
  readonly reports: MessageReportRecord[];
  readonly reads: { conversationId: string; userId: string; lastReadAt: Date }[];
}

export function inMemoryChatRepository(clock: Clock = steppingClock()): InMemoryChatRepository {
  const conversations: ConversationRecord[] = [];
  const participants: { conversationId: string; userId: string }[] = [];
  const messages: MessageRecord[] = [];
  const reports: MessageReportRecord[] = [];
  const reads: { conversationId: string; userId: string; lastReadAt: Date }[] = [];

  let counter = 0;

  const nextId = (prefix: string): string => {
    counter += 1;

    return testId(`${prefix}${String(counter).padStart(4, '0')}`);
  };

  /**
   * Dieselbe Ordnung wie in SQL: `(created_at, id)` absteigend.
   *
   * Der Tiebreaker gehört zwingend dazu – ohne ihn verdeckte die Attrappe
   * genau den Fehler, den sie prüfen soll (Audit W3-4,
   * `backend-community-04`/`-21`): Nachrichten mit gleichem Zeitstempel
   * standen hier in beliebiger Reihenfolge, in der Datenbank dagegen nach Id.
   */
  const juengsteZuerst = (a: MessageRecord, b: MessageRecord): number => {
    const zeit = b.createdAt.getTime() - a.createdAt.getTime();

    if (zeit !== 0) {
      return zeit;
    }

    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  };

  return {
    conversations,
    participants,
    messages,
    reports,
    reads,

    async findConversation(conversationId) {
      return conversations.find((conversation) => conversation.id === conversationId) ?? null;
    },

    async findConversationByDmKey(dmKey) {
      return conversations.find((conversation) => conversation.dmKey === dmKey) ?? null;
    },

    async findConversationByServerId(serverId) {
      return conversations.find((conversation) => conversation.serverId === serverId) ?? null;
    },

    async createConversation(data: CreateConversationData) {
      const record: ConversationRecord = {
        id: nextId('c'),
        type: data.type,
        serverId: data.serverId,
        dmKey: data.dmKey,
        createdAt: clock.now(),
      };

      conversations.push(record);

      for (const userId of data.participantIds) {
        participants.push({ conversationId: record.id, userId });
      }

      return record;
    },

    async listDirectParticipants(conversationId) {
      return participants
        .filter((row) => row.conversationId === conversationId)
        .map((row) => row.userId);
    },

    async listDirectConversationsForUser(userId) {
      const ids = new Set(
        participants.filter((row) => row.userId === userId).map((row) => row.conversationId),
      );

      return conversations.filter((conversation) => ids.has(conversation.id));
    },

    async createMessage(data: CreateMessageData) {
      const record: MessageRecord = {
        id: nextId('e'),
        conversationId: data.conversationId,
        senderId: data.senderId,
        content: data.content,
        createdAt: clock.now(),
        deletedAt: null,
        deletedById: null,
      };

      messages.push(record);

      return record;
    },

    async findMessage(messageId) {
      return messages.find((message) => message.id === messageId) ?? null;
    },

    async listMessages(conversationId, options) {
      const ordered = messages
        .filter((message) => message.conversationId === conversationId)
        .sort(juengsteZuerst);

      /*
       * Der Anker liegt in **dieser** Konversation, sonst gibt es ihn für den
       * Aufrufer nicht – und eine unbekannte Id wirft, statt still ohne Filter
       * weiterzulaufen. Die Attrappe wich hier vom echten Repository ab und
       * verdeckte damit beides (Audit W3-4, `backend-community-visibility-08`).
       */
      const anchor =
        options.before === undefined
          ? undefined
          : ordered.find((message) => message.id === options.before);

      if (options.before !== undefined && !anchor) {
        throw new ChatError('MESSAGE_NOT_FOUND');
      }

      // Keyset auf dem vollen Schlüssel `(createdAt, id)`.
      const filtered = anchor
        ? ordered.filter(
            (message) =>
              message.createdAt.getTime() < anchor.createdAt.getTime() ||
              (message.createdAt.getTime() === anchor.createdAt.getTime() &&
                message.id < anchor.id),
          )
        : ordered;

      return {
        messages: filtered.slice(0, options.limit),
        hasMore: filtered.length > options.limit,
      } satisfies MessagePage;
    },

    async lastMessages(conversationIds) {
      const result = new Map<string, MessageRecord>();

      for (const conversationId of conversationIds) {
        const newest = messages
          .filter((message) => message.conversationId === conversationId)
          .sort(juengsteZuerst)[0];

        if (newest) {
          result.set(conversationId, newest);
        }
      }

      return result;
    },

    async markMessageDeleted(messageId, deletedById, deletedAt) {
      const index = messages.findIndex((message) => message.id === messageId);
      const message = messages[index];

      // Das bedingte `UPDATE … where deleted_at is null` des echten
      // Repositorys: Eine bereits gelöschte Nachricht wird nicht überschrieben.
      if (!message || message.deletedAt !== null) {
        return false;
      }

      messages[index] = { ...message, deletedAt, deletedById };

      return true;
    },

    async markConversationRead(conversationId, userId, at) {
      const existing = reads.find(
        (row) => row.conversationId === conversationId && row.userId === userId,
      );

      if (existing) {
        existing.lastReadAt = at;
      } else {
        reads.push({ conversationId, userId, lastReadAt: at });
      }
    },

    async lastReadAtFor(userId, conversationIds) {
      const wanted = new Set(conversationIds);
      const result = new Map<string, Date>();

      for (const row of reads) {
        if (row.userId === userId && wanted.has(row.conversationId)) {
          result.set(row.conversationId, row.lastReadAt);
        }
      }

      return result;
    },

    async unreadCounts(userId, conversationIds) {
      const result = new Map<string, number>();

      for (const conversationId of conversationIds) {
        const lastReadAt = reads.find(
          (row) => row.conversationId === conversationId && row.userId === userId,
        )?.lastReadAt;

        const unread = messages.filter(
          (message) =>
            message.conversationId === conversationId &&
            message.senderId !== userId &&
            message.deletedAt === null &&
            (lastReadAt === undefined || message.createdAt.getTime() > lastReadAt.getTime()),
        ).length;

        if (unread > 0) {
          result.set(conversationId, unread);
        }
      }

      return result;
    },

    async createReport(data: CreateReportData) {
      const record: MessageReportRecord = {
        id: nextId('f'),
        messageId: data.messageId,
        reportedById: data.reportedById,
        reason: data.reason,
        reportedContent: data.reportedContent,
        status: 'open',
        actionTaken: null,
        moderatorNote: null,
        resolvedById: null,
        resolvedAt: null,
        createdAt: clock.now(),
      };

      reports.push(record);

      return record;
    },

    async findReport(reportId) {
      return reports.find((report) => report.id === reportId) ?? null;
    },

    async findReportByMessageAndReporter(messageId, reportedById) {
      return (
        reports.find(
          (report) => report.messageId === messageId && report.reportedById === reportedById,
        ) ?? null
      );
    },

    async reportedMessageIds(reportedById, messageIds) {
      return new Set(
        reports
          .filter(
            (report) =>
              report.reportedById === reportedById && messageIds.includes(report.messageId),
          )
          .map((report) => report.messageId),
      );
    },

    async listReports(query: MessageReportQuery) {
      const matching = reports
        .filter((report) => report.status === (query.status as MessageReportStatus))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return {
        reports: matching.slice(query.offset, query.offset + query.limit),
        total: matching.length,
      } satisfies MessageReportPage;
    },

    async resolveReport(reportId, data: ResolveReportData) {
      const index = reports.findIndex((report) => report.id === reportId);
      const report = reports[index];

      if (!report) {
        throw new Error(`Meldung ${reportId} fehlt in der Attrappe.`);
      }

      // Das bedingte `UPDATE … where status = 'open'`: Über eine bereits
      // entschiedene Meldung entscheidet niemand ein zweites Mal.
      if (report.status !== 'open') {
        return null;
      }

      const updated: MessageReportRecord = {
        ...report,
        status: data.status,
        actionTaken: data.actionTaken,
        moderatorNote: data.moderatorNote,
        resolvedById: data.resolvedById,
        resolvedAt: data.resolvedAt,
      };

      reports[index] = updated;

      return updated;
    },
  };
}

// ---------------------------------------------------------------------------
// Audit-Log (Anschluss B8) und Ereignisse (Anschluss B6)
// ---------------------------------------------------------------------------

export interface RecordingAuditService extends AuditService {
  readonly entries: AppendAuditEntry[];
  actions(): AuditAction[];
}

export function recordingAuditService(): RecordingAuditService {
  const entries: AppendAuditEntry[] = [];

  return {
    entries,
    actions: () => entries.map((entry) => entry.action),

    async record(entry) {
      entries.push(entry);
    },

    async list() {
      throw new Error('Die Tests des Chats lesen das Audit-Log nicht.');
    },
  };
}

/**
 * Ereignis-Senke, die mitschreibt statt zu verschicken.
 *
 * Die Nutzlast liegt zum Prüfen offen: Ob sie den Vertrag erfüllt, entscheidet
 * inzwischen der Compiler am Auslöser ({@link ChatEventPublisher}).
 */
export interface RecordingEventPublisher extends ChatEventPublisher {
  readonly published: { event: 'message.reported'; payload: Record<string, unknown> }[];
}

export function recordingEventPublisher(): RecordingEventPublisher {
  const published: { event: 'message.reported'; payload: Record<string, unknown> }[] = [];

  return {
    published,
    publish(event: 'message.reported', payload: ChatEventPayloads['message.reported']): void {
      published.push({ event, payload: { ...payload } });
    },
  };
}

export interface RecordingDelivery extends ChatDelivery {
  readonly delivered: { userId: string; frame: { event: string; data: unknown } }[];
  eventsFor(userId: string): string[];
}

export function recordingDelivery(): RecordingDelivery {
  const delivered: { userId: string; frame: { event: string; data: unknown } }[] = [];

  return {
    delivered,
    eventsFor: (userId) =>
      delivered.filter((entry) => entry.userId === userId).map((entry) => entry.frame.event),

    deliver(userId, frame) {
      delivered.push({ userId, frame: { event: frame.event, data: frame.data } });
    },
  };
}
