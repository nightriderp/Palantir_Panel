/**
 * Datensätze und Anschlusspunkte des Chat-Moduls (B7).
 *
 * Die Datensätze bilden die Tabellen aus `db/schema/chat.ts` ab; die Ports
 * beschreiben, was das Modul von anderen Arbeitspaketen braucht. Beides steht
 * hier zusammen, damit `visibility.ts`, `permissions.ts` und `dto.ts` ohne
 * Kenntnis von Drizzle auskommen und in Tests mit Attrappen laufen
 * (CLAUDE.md §4).
 */

import {
  type ConversationType,
  type MessageModerationAction,
  type MessageReportStatus,
  type ServerMemberLevel,
} from '@palantir/contracts';

// ---------------------------------------------------------------------------
// Datensätze
// ---------------------------------------------------------------------------

export interface ConversationRecord {
  readonly id: string;
  readonly type: ConversationType;
  /** Nur beim `server_chat` gesetzt. */
  readonly serverId: string | null;
  /** Sortierte `<userId>:<userId>`-Verkettung; nur bei der DM gesetzt. */
  readonly dmKey: string | null;
  readonly createdAt: Date;
}

export interface MessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  readonly deletedById: string | null;
}

export interface MessageReportRecord {
  readonly id: string;
  readonly messageId: string;
  readonly reportedById: string;
  readonly reason: string;
  /** Inhalt der Nachricht zum Zeitpunkt der Meldung. */
  readonly reportedContent: string;
  readonly status: MessageReportStatus;
  readonly actionTaken: MessageModerationAction | null;
  readonly moderatorNote: string | null;
  readonly resolvedById: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Anschluss an andere Arbeitspakete
// ---------------------------------------------------------------------------

/**
 * Konto, so weit der Chat es kennen muss.
 *
 * `approved` bildet „freigeschaltete Nutzer" aus Lastenheft §3.6 ab. Die Regel
 * dazu gehört B8 (`statusOf()` in der Freischalt-Warteliste) – dieses Modul
 * bewertet sie nicht selbst, sondern bekommt das Ergebnis geliefert.
 */
export interface ChatUserRecord {
  readonly id: string;
  readonly displayName: string;
  readonly banned: boolean;
  readonly approved: boolean;
}

/** Nachschlagen von Konten (Anzeigenamen, Freischaltstand). */
export interface ChatUserDirectory {
  find(userId: string): Promise<ChatUserRecord | null>;
  /** Anzeigenamen zu mehreren Konten auf einmal – für Listen. */
  displayNames(userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/**
 * Zugriff auf die Teilnehmerkreise der Server (B3).
 *
 * Pflichtenheft §15: „Teilnehmerkreis folgt `ServerMember`". Deshalb wird er bei
 * jeder Prüfung frisch gelesen und nirgends gespiegelt – wer aus einem Server
 * entfernt wird, ist im selben Moment aus dessen Chat draußen.
 */
export interface ServerMembershipSource {
  /** Server samt Besitzer; `null`, wenn es ihn nicht (mehr) gibt. */
  findServer(serverId: string): Promise<ChatServerRecord | null>;
  /** Mitglieder eines Servers ohne den Besitzer. */
  listMembers(serverId: string): Promise<readonly ChatServerMember[]>;
  /** Server, bei denen das Konto Besitzer oder Mitglied ist. */
  listServerIdsForUser(userId: string): Promise<readonly string[]>;
}

export interface ChatServerRecord {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
}

export interface ChatServerMember {
  readonly userId: string;
  readonly level: ServerMemberLevel;
}

/** Uhr des Moduls – in Tests austauschbar. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * Erzeugt IDs für neue Datensätze.
 *
 * Im Betrieb vergibt die Datenbank sie (`defaultRandom()`); die Attrappen der
 * Tests brauchen trotzdem eine Quelle.
 */
export type IdFactory = () => string;
