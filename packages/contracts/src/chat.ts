/**
 * Chat & Moderation (Lastenheft §3.6, Pflichtenheft §6 und §15) – Arbeitspaket B7.
 *
 * Drei Entitäten aus Pflichtenheft §6: `Conversation` (Typ `dm` oder
 * `server_chat`), `Message` und `MessageReport`.
 *
 * **Datenschutz-Prinzip (Pflichtenheft §15 und §18, nicht verhandelbar):**
 * Moderation ist ausschließlich **reaktiv**. Es gibt in diesem Vertrag bewusst
 * keinen DTO, der einem Moderator eine fremde Konversation, einen
 * Nachrichtenverlauf oder eine Suche über alle Nachrichten zugänglich macht –
 * auch nicht als optionales Feld, auch nicht „nur für den Owner". Was ein
 * Moderator zu sehen bekommt, steht abschließend in {@link ReportedMessageDto}:
 * genau die gemeldete Nachricht, sonst nichts. Wer hier ein Feld ergänzt, das
 * darüber hinausgeht, hebt die Zusicherung auf – das ist keine Erweiterung,
 * sondern ein Bruch (CLAUDE.md §2).
 *
 * Die Berechtigung zur Moderation ist `message.moderate` aus B2
 * (`permissions.ts`), am Konto-DTO sichtbar als
 * `GlobalPermissions.canModerateMessages`.
 */

import { type WebSocketEventName } from './events.js';

// ---------------------------------------------------------------------------
// Grenzwerte
// ---------------------------------------------------------------------------

/**
 * Maximale Länge einer Nachricht in Zeichen.
 *
 * Bewusst hier und nicht in der `.env`: Der Wert ist Teil des Vertrags, das
 * Frontend zeigt den Zähler danach an und muss dieselbe Grenze kennen wie das
 * Backend (Pflichtenheft §5.2).
 */
export const MESSAGE_MAX_LENGTH = 2000;

/** Maximale Länge der Begründung einer Meldung in Zeichen. */
export const MESSAGE_REPORT_REASON_MAX_LENGTH = 500;

/** Maximale Länge der Notiz, die ein Moderator an seine Entscheidung hängt. */
export const MESSAGE_MODERATION_NOTE_MAX_LENGTH = 500;

/** Vorgabe für die Seitengröße beim Blättern im Verlauf. */
export const MESSAGE_PAGE_DEFAULT_LIMIT = 50;

/** Obergrenze für die Seitengröße beim Blättern im Verlauf. */
export const MESSAGE_PAGE_MAX_LIMIT = 200;

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

/**
 * Art einer Konversation (Pflichtenheft §6, `Conversation.type`).
 *
 * - `dm` – Direktnachrichten zwischen genau zwei freigeschalteten Nutzern
 * - `server_chat` – Gruppen-Chat eines Gameservers; entsteht automatisch mit
 *   dem Server, der Teilnehmerkreis folgt `ServerMember` (Pflichtenheft §15)
 */
export const CONVERSATION_TYPES = ['dm', 'server_chat'] as const;

export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export function isConversationType(value: string): value is ConversationType {
  return (CONVERSATION_TYPES as readonly string[]).includes(value);
}

/** Teilnehmer einer Konversation, so weit ihn der Aufrufer sehen darf. */
export interface ConversationParticipantDto {
  userId: string;
  displayName: string;
}

/**
 * `permissions`-Objekt einer Konversation (Pflichtenheft §5.2).
 *
 * Ausgeliefert wird eine Konversation nur, wenn der Aufrufer sie sehen darf –
 * `canView` steht trotzdem darin, damit das Frontend eine einheitliche Form
 * auswerten kann und nicht aus der bloßen Anwesenheit eines Datensatzes auf
 * eine Berechtigung schließt.
 */
export interface ConversationPermissions {
  canView: boolean;
  /**
   * Darf der Aufrufer hier schreiben? Beim Server-Chat setzt das eine
   * bestehende Mitgliedschaft voraus; ein Moderator bekommt dadurch **kein**
   * Schreibrecht in fremden Konversationen.
   */
  canSendMessage: boolean;
}

/**
 * Eine Konversation (Pflichtenheft §6, `Conversation`).
 *
 * `title` und `participants` sind bereits aus Sicht des Aufrufers aufbereitet:
 * Bei einer DM trägt der Titel den Anzeigenamen des Gegenübers, beim
 * Server-Chat den Namen des Servers.
 */
export interface ConversationDto {
  id: string;
  type: ConversationType;
  /** Nur beim `server_chat` gesetzt – die `GameServer.id`. */
  serverId: string | null;
  /** Anzeigetitel aus Sicht des Aufrufers. */
  title: string;
  participants: ConversationParticipantDto[];
  /** Jüngste Nachricht für die Vorschau in der Liste; `null` bei leerem Chat. */
  lastMessage: MessageDto | null;
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
  /**
   * Serverseitiger Lesezustand des Aufrufers (Gefundener Punkt 95).
   *
   * Anzahl der Nachrichten, die dieses Konto in dieser Konversation noch nicht
   * gelesen hat – eigene Beiträge und gelöschte Nachrichten zählen nicht mit.
   * Serverseitig geführt, damit der Zähler über Geräte hinweg gilt und nicht,
   * wie zuvor, nur lokal in einer Sitzung.
   *
   * **Additiv und optional** (CLAUDE.md §3): Das Backend liefert das Feld stets
   * mit; optional getippt, damit bestehende Ansichten, die es noch nicht
   * auswerten, unverändert übersetzen. Fehlt es, ist wie „0" zu behandeln.
   */
  unreadCount?: number;
  /**
   * ISO-8601-Zeitstempel, bis zu dem der Aufrufer diese Konversation zuletzt
   * als gelesen markiert hat; `null`, solange er sie noch nie gelesen hat.
   * Gegenstück zu {@link unreadCount}; ebenfalls additiv und optional.
   */
  lastReadAt?: string | null;
  permissions: ConversationPermissions;
}

// ---------------------------------------------------------------------------
// DM-Verzeichnis
// ---------------------------------------------------------------------------

/**
 * Ein zulässiger Empfänger für eine Direktnachricht (Pflichtenheft §15).
 *
 * Das Verzeichnis listet **nicht** alle Konten der Plattform, sondern nur die,
 * mit denen der Aufrufer bereits einen Server teilt – als Besitzer oder
 * Mitglied – und die freigeschaltet und nicht gesperrt sind. So lässt sich eine
 * DM beginnen, ohne die Kontenliste der Plattform quer offenzulegen: Wer mit
 * niemandem einen Server teilt, bekommt ein leeres Verzeichnis.
 *
 * `recipientId` passt genau in `openDirectConversation` / die Route
 * `POST /api/chat/conversations/direct` (Feld `recipientId`).
 */
export interface DirectMessageRecipientDto {
  recipientId: string;
  displayName: string;
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

/** `permissions`-Objekt einer Nachricht (Pflichtenheft §5.2). */
export interface MessagePermissions {
  /**
   * Darf der Aufrufer die Nachricht löschen? `true` beim eigenen Beitrag.
   * Ein Moderator löscht **nicht** hierüber, sondern ausschließlich als
   * Entscheidung zu einer Meldung (siehe {@link MessageModerationAction}) –
   * sonst gäbe es einen Weg an einer Meldung vorbei.
   */
  canDelete: boolean;
  /** Darf der Aufrufer die Nachricht melden? Am eigenen Beitrag `false`. */
  canReport: boolean;
}

/**
 * Eine Nachricht (Pflichtenheft §6, `Message`).
 *
 * Eine gelöschte Nachricht wird nicht aus dem Verlauf entfernt, sondern mit
 * `deletedAt` markiert und mit leerem `content` ausgeliefert – der Verlauf
 * bleibt sonst lückenhaft und eine laufende Meldung verlöre ihren Bezug.
 */
export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  /** Anzeigename des Absenders zum Zeitpunkt der Abfrage. */
  senderDisplayName: string;
  /** Inhalt; bei gelöschten Nachrichten leer (`''`). */
  content: string;
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
  /** ISO-8601-Zeitstempel der Löschung; `null`, solange die Nachricht steht. */
  deletedAt: string | null;
  /**
   * Wurde die Nachricht im Zuge einer Meldung entfernt (`true`) oder vom
   * Absender selbst (`false`)? `null`, solange sie steht.
   */
  deletedByModerator: boolean | null;
  /**
   * Hat der Aufrufer diese Nachricht bereits gemeldet? Verhindert im Frontend
   * die zweite Meldung derselben Nachricht durch dieselbe Person.
   */
  reportedByViewer: boolean;
  permissions: MessagePermissions;
}

/**
 * Seite eines Nachrichtenverlaufs.
 *
 * Der Verlauf wird von unten nach oben geblättert (jüngste zuerst geladen);
 * `messages` selbst ist aufsteigend nach `createdAt` sortiert, damit das
 * Frontend nichts umdrehen muss. `nextCursor` ist die `Message.id`, ab der die
 * nächste, ältere Seite geholt wird.
 */
export interface MessagePageDto {
  conversationId: string;
  messages: MessageDto[];
  /** Cursor für die nächste (ältere) Seite; `null`, wenn der Anfang erreicht ist. */
  nextCursor: string | null;
  /** Angewendetes Seitenlimit. */
  limit: number;
}

// ---------------------------------------------------------------------------
// MessageReport
// ---------------------------------------------------------------------------

/** Bearbeitungsstand einer Meldung (Pflichtenheft §6, `MessageReport.status`). */
export const MESSAGE_REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;

export type MessageReportStatus = (typeof MESSAGE_REPORT_STATUSES)[number];

export function isMessageReportStatus(value: string): value is MessageReportStatus {
  return (MESSAGE_REPORT_STATUSES as readonly string[]).includes(value);
}

/**
 * Entscheidung eines Moderators zu einer Meldung
 * (Pflichtenheft §6, `MessageReport.actionTaken`).
 *
 * Bewusst nur diese beiden: Eine Kontosperre ist keine Chat-Moderation,
 * sondern Nutzerverwaltung – sie läuft über `user.manage` (B8) und würde hier
 * sonst am Rechtekonzept vorbei möglich.
 */
export const MESSAGE_MODERATION_ACTIONS = ['dismiss', 'deleteMessage'] as const;

export type MessageModerationAction = (typeof MESSAGE_MODERATION_ACTIONS)[number];

export function isMessageModerationAction(value: string): value is MessageModerationAction {
  return (MESSAGE_MODERATION_ACTIONS as readonly string[]).includes(value);
}

/**
 * Die gemeldete Nachricht, wie ein Moderator sie sieht.
 *
 * **Abschließend.** Kein Verlauf davor oder danach, keine weiteren Nachrichten
 * derselben Konversation, keine Teilnehmerliste einer DM. Genau der Beitrag,
 * über den sich jemand beschwert hat, und wer ihn geschrieben hat – mehr braucht
 * eine Entscheidung nicht, und mehr gibt das Datenschutz-Prinzip aus
 * Pflichtenheft §15 nicht her.
 */
export interface ReportedMessageDto {
  id: string;
  senderId: string;
  senderDisplayName: string;
  /** Inhalt zum Zeitpunkt der Meldung; bleibt lesbar, auch wenn die Nachricht gelöscht wurde. */
  content: string;
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
  /** ISO-8601-Zeitstempel der Löschung; `null`, solange die Nachricht steht. */
  deletedAt: string | null;
}

/** `permissions`-Objekt einer Meldung (Pflichtenheft §5.2). */
export interface MessageReportPermissions {
  canView: boolean;
  /** Darf der Aufrufer über die Meldung entscheiden? Verlangt `message.moderate`. */
  canResolve: boolean;
}

/**
 * Eine Meldung (Pflichtenheft §6, `MessageReport`).
 *
 * `conversationType` und `serverId` sind bewusst die einzige Angabe zum Umfeld:
 * Ein Moderator soll erkennen können, ob der Vorfall in einem Server-Chat oder
 * in einer privaten Unterhaltung passiert ist – ohne Zugriff auf deren Inhalt.
 */
export interface MessageReportDto {
  id: string;
  messageId: string;
  conversationId: string;
  conversationType: ConversationType;
  /** Nur beim `server_chat` gesetzt. */
  serverId: string | null;
  reportedById: string;
  reportedByDisplayName: string;
  reason: string;
  status: MessageReportStatus;
  /** Getroffene Entscheidung; `null`, solange die Meldung offen ist. */
  actionTaken: MessageModerationAction | null;
  /** Notiz des Moderators zur Entscheidung; `null`, wenn keine hinterlegt wurde. */
  moderatorNote: string | null;
  resolvedById: string | null;
  resolvedByDisplayName: string | null;
  /** ISO-8601-Zeitstempel der Entscheidung; `null`, solange die Meldung offen ist. */
  resolvedAt: string | null;
  /** ISO-8601-Zeitstempel der Meldung. */
  createdAt: string;
  message: ReportedMessageDto;
  permissions: MessageReportPermissions;
}

/** Seite der Moderationsübersicht. Das Log wächst; es wird nie vollständig geliefert. */
export interface MessageReportPageDto {
  reports: MessageReportDto[];
  /** Gesamtzahl der Meldungen, die auf den Filter passen. */
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Live-Kanal Browser ↔ Backend (Pflichtenheft §5.3)
// ---------------------------------------------------------------------------
// Nicht zu verwechseln mit dem Live-Kanal der Server-Ansicht (`server-live.ts`)
// und erst recht nicht mit dem Agent-Protokoll (`agent-protocol.ts`).
//
// **Kein `subscribe`:** Anders als beim Server-Kanal abonniert der Browser hier
// nichts. Die Verbindung gehört einem angemeldeten Konto, und das Backend
// schickt darüber die Ereignisse **aller** Konversationen, an denen dieses Konto
// teilnimmt. Ein Abonnement je Konversation brächte nichts: Eine neu entstandene
// DM könnte man nicht abonnieren, bevor man von ihr weiß, und genau davon soll
// der Kanal ja berichten.
//
// **Senden läuft über REST**, nicht über diesen Kanal: Eine Nachricht ist ein
// zustandsändernder Vorgang mit Eingabeprüfung, Rechteprüfung und benanntem
// Fehlercode im Envelope aus §5.1. Zwei Wege für denselben Vorgang hätten
// zwangsläufig zwei Regelsätze. Der Kanal stellt nur zu.

/**
 * Ereignisse des Chat-Kanals.
 *
 * Die Namen stehen zugleich im Katalog `WEBSOCKET_EVENTS`; das `satisfies`
 * erzwingt das beim Übersetzen (CLAUDE.md §5).
 */
export const CHAT_EVENTS = [
  'message.sent',
  'message.deleted',
  'conversation.created',
  'conversation.read',
] as const satisfies readonly WebSocketEventName[];

export type ChatEventName = (typeof CHAT_EVENTS)[number];

export function isChatEventName(value: string): value is ChatEventName {
  return (CHAT_EVENTS as readonly string[]).includes(value);
}

/** Nutzdaten je Ereignis des Chat-Kanals. */
export type ChatEventPayloads = {
  'message.sent': { conversationId: string; message: MessageDto };
  'message.deleted': {
    conversationId: string;
    messageId: string;
    /** ISO-8601-Zeitstempel der Löschung. */
    deletedAt: string;
    /** `true`, wenn die Löschung Folge einer Meldung war. */
    byModerator: boolean;
  };
  'conversation.created': { conversation: ConversationDto };
  /**
   * Der Aufrufer hat eine Konversation als gelesen markiert (Gefundener Punkt
   * 95). Zugestellt wird das Ereignis an **alle** Verbindungen genau dieses
   * Kontos – so ziehen weitere Geräte/Tabs desselben Nutzers ihren
   * Ungelesen-Zähler nach, ohne zu pollen. Andere Teilnehmer sehen es nicht;
   * der Lesezustand ist privat.
   */
  'conversation.read': {
    conversationId: string;
    /** ISO-8601-Zeitstempel, bis zu dem gelesen wurde. */
    lastReadAt: string;
    /** Verbleibende ungelesene Nachrichten nach dem Markieren – im Regelfall `0`. */
    unreadCount: number;
  };
};

/** Frame, das der Browser vom Backend empfängt. */
export type ChatServerEventFrame = {
  [TName in ChatEventName]: {
    kind: 'event';
    event: TName;
    data: ChatEventPayloads[TName];
    /** ISO-8601-Zeitstempel des Versands. */
    sentAt: string;
  };
}[ChatEventName];
