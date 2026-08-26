/**
 * Notification-Engine (Lastenheft §3.6 und §3.7, Pflichtenheft §14).
 *
 * Hier stehen die Datenstrukturen, die Backend (Arbeitspaket B6), Frontend
 * (Inbox und Einstellungen in F6, Regelverwaltung in F10) und die auslösenden
 * Arbeitspakete (B3, B4, B5, B7, B8) gemeinsam brauchen.
 *
 * Drei Dinge sind bewusst voneinander getrennt (Pflichtenheft §14):
 *
 * 1. das **Ereignis** – was passiert ist (`WEBSOCKET_EVENTS` in `events.ts`,
 *    Nutzdaten je Ereignis als {@link NotificationEventPayloads});
 * 2. der **Kanal** – wohin es außerhalb des Panels geht
 *    ({@link NotificationChannelDto}, Version 1: Discord-Webhook);
 * 3. die **Regel** – welches Ereignis welchen Kanal für welchen Empfängerkreis
 *    auslöst ({@link NotificationRuleDto}).
 *
 * Die Zustellung in die Inbox des Panels ({@link NotificationDto}) hängt nicht
 * am Kanal: Eine Regel ohne Kanal schreibt ausschließlich in die Inbox, eine
 * Regel mit Kanal zusätzlich nach außen. Ein Kanal ist also nie Voraussetzung
 * dafür, dass ein Ereignis überhaupt jemanden erreicht.
 *
 * Änderungen sind bevorzugt additiv (neue optionale Felder).
 */

import { type WebSocketEventName } from './events.js';
import { type WithPermissions } from './permissions.js';

// ---------------------------------------------------------------------------
// Ereignisse, auf die eine Regel hören darf
// ---------------------------------------------------------------------------

/**
 * Ereignisse, die eine Benachrichtigung auslösen dürfen (Pflichtenheft §14).
 *
 * Der Katalog `WEBSOCKET_EVENTS` enthält zwei Sorten Namen: fachliche
 * Ereignisse (dieser Liste) und reine Live-Ereignisse, die nur eine offene
 * Ansicht aktuell halten (`server.statusChanged`, `server.statsUpdated`,
 * `server.consoleLineAppended`, `serverClone.progressed`, `notification.created`).
 * Eine `NotificationRule` auf ein Live-Ereignis wäre sinnlos und teuer – bei
 * `server.statsUpdated` mehrere Meldungen je Minute und Server. Diese Liste ist
 * deshalb die verbindliche Auswahl für den Regel-Editor (F10); das Backend
 * lehnt alles andere mit `NOTIFICATION_EVENT_NOT_NOTIFIABLE` ab.
 *
 * Das `satisfies` erzwingt beim Übersetzen, dass hier kein Name steht, den der
 * Katalog nicht kennt (CLAUDE.md §5).
 */
export const NOTIFIABLE_EVENTS = [
  // Server-Lebenszyklus (B3, Pflichtenheft §9)
  'server.created',
  'server.started',
  'server.stopped',
  'server.restarted',
  'server.crashed',
  'server.failed',
  'server.cloned',
  'server.deleted',
  'autoShutdown.triggered',

  // Backups (B5, Lastenheft §3.3)
  'backup.failed',

  // Ressourcen (B4, Pflichtenheft §10)
  'resource.low',

  // Konten und Moderation (B1/B7)
  'user.registered',
  'message.reported',

  // Systemweite Ankündigungen durch den Admin (Lastenheft §3.6)
  'announcement.published',
] as const satisfies readonly WebSocketEventName[];

export type NotifiableEventName = (typeof NOTIFIABLE_EVENTS)[number];

export function isNotifiableEventName(value: string): value is NotifiableEventName {
  return (NOTIFIABLE_EVENTS as readonly string[]).includes(value);
}

/**
 * Dringlichkeit einer Meldung.
 *
 * Steuert die Darstellung in der Inbox (F6) und die Farbe der Discord-Nachricht.
 * Bewusst drei Stufen: `error` verlangt, dass jemand hinsieht, `warning` kündigt
 * das an, `info` ist reine Kenntnisnahme.
 */
export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'error'] as const;

export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

/**
 * Art der Ressource, auf die sich eine Meldung bezieht.
 *
 * Trägt den Sprung aus der Inbox an die betroffene Stelle. `null` bei
 * Meldungen ohne Bezug (systemweite Ankündigung).
 */
export const NOTIFICATION_SUBJECT_TYPES = [
  'server',
  'backup',
  'node',
  'user',
  'message',
  'announcement',
] as const;

export type NotificationSubjectType = (typeof NOTIFICATION_SUBJECT_TYPES)[number];

/** Betroffene Ressource einer Meldung. */
export interface NotificationSubject {
  type: NotificationSubjectType;
  id: string;
  /** Anzeigename zum Zeitpunkt der Meldung – bleibt lesbar, auch wenn die Ressource später verschwindet. */
  displayName: string | null;
}

// ---------------------------------------------------------------------------
// Nutzdaten je Ereignis
// ---------------------------------------------------------------------------

/**
 * Gemeinsame Angaben jeder Ereignis-Nutzlast.
 *
 * `at` steht in **jeder** Nutzlast, nicht nur im Zustellungs-Frame: Zwischen
 * dem Auslösen und dem Zustellen können Sekunden liegen (Wiederholversuche des
 * externen Kanals), und die Meldung soll den Zeitpunkt des Vorgangs tragen,
 * nicht den des Versands.
 */
export interface NotificationEventBase {
  /** ISO-8601-Zeitstempel des auslösenden Vorgangs. */
  at: string;
  /**
   * Konto, das den Vorgang ausgelöst hat; `null` bei Systemvorgängen
   * (Auto-Shutdown, geplantes Backup, Absturz).
   */
  actorId: string | null;
}

/** Ereignisse rund um einen einzelnen Gameserver. */
export interface ServerEventPayload extends NotificationEventBase {
  serverId: string;
  serverName: string;
  ownerId: string;
  /** Weitere Empfänger aus `ServerMember` (Pflichtenheft §6). */
  memberUserIds: readonly string[];
  /** Freitextzusatz der Quelle, z. B. die Meldung eines gescheiterten Starts. */
  detail: string | null;
}

/**
 * Nutzdaten je Ereignis (Pflichtenheft §14).
 *
 * Bewusst als Tabelle über {@link NotifiableEventName} statt als ein
 * gemeinsamer, weitgehend optionaler Typ: So sieht der Auslöser beim
 * Übersetzen, welche Angaben sein Ereignis tragen muss, und die
 * Empfängerauflösung im Backend muss nicht raten, ob `ownerId` gesetzt ist.
 *
 * `resource.low` übernimmt die Nutzlast unverändert aus B4
 * (`ResourceLowEvent` in `resources.ts`) und ergänzt sie nur um die
 * gemeinsamen Felder – die Schwellwertrechnung gehört dort hin, nicht hierher.
 */
export interface NotificationEventPayloads {
  'server.created': ServerEventPayload;
  'server.started': ServerEventPayload;
  'server.stopped': ServerEventPayload;
  'server.restarted': ServerEventPayload;
  'server.crashed': ServerEventPayload;
  'server.failed': ServerEventPayload;
  'server.cloned': ServerEventPayload;
  'server.deleted': ServerEventPayload;
  'autoShutdown.triggered': ServerEventPayload & {
    /** Leerlaufdauer in Minuten, die zur Abschaltung geführt hat (Pflichtenheft §9). */
    idleMinutes: number;
  };
  'backup.failed': NotificationEventBase & {
    backupId: string;
    serverId: string;
    serverName: string;
    ownerId: string;
    /** Benannter Code aus `ERROR_CATALOG` – nie Freitext (CLAUDE.md §5). */
    failureCode: string;
    failureMessage: string | null;
  };
  'resource.low': NotificationEventBase & {
    scope: 'node' | 'server';
    resource: 'ram' | 'cpu' | 'disk';
    nodeId: string;
    /** Nur bei `scope: 'server'` gesetzt. */
    serverId: string | null;
    /** Besitzer des betroffenen Servers; `null` bei `scope: 'node'`. */
    ownerId: string | null;
    usedPercent: number;
    thresholdPercent: number;
  };
  'user.registered': NotificationEventBase & {
    userId: string;
    displayName: string;
    /** Wartet das Konto auf die Freischaltung durch einen Admin (Lastenheft §3.1)? */
    awaitingApproval: boolean;
  };
  'message.reported': NotificationEventBase & {
    reportId: string;
    messageId: string;
    conversationId: string;
    reportedByUserId: string;
    reason: string;
  };
  'announcement.published': NotificationEventBase & {
    announcementId: string;
    title: string;
    body: string;
    severity: NotificationSeverity;
  };
}

/** Nutzlast zu einem bestimmten Ereignis. */
export type NotificationEventPayload<TEvent extends NotifiableEventName = NotifiableEventName> =
  NotificationEventPayloads[TEvent];

/**
 * Ein ausgelöstes Ereignis samt Name – die Form, in der es durch das interne
 * Event-System läuft.
 */
export type NotificationEvent = {
  [TEvent in NotifiableEventName]: { event: TEvent; payload: NotificationEventPayloads[TEvent] };
}[NotifiableEventName];

// ---------------------------------------------------------------------------
// Kanal (Entität `NotificationChannel`, Pflichtenheft §6)
// ---------------------------------------------------------------------------

/**
 * Art eines Kanals.
 *
 * Version 1 kennt nur den Discord-Webhook (Lastenheft §3.6: „Versand initial
 * über Discord-Webhook"). Die Liste ist trotzdem eine Aufzählung und kein fester
 * String, damit ein zweiter Typ additiv dazukommen kann, ohne die Entität zu
 * ändern.
 */
export const NOTIFICATION_CHANNEL_TYPES = ['discordWebhook'] as const;

export type NotificationChannelType = (typeof NOTIFICATION_CHANNEL_TYPES)[number];

/**
 * Zielangaben eines Discord-Webhook-Kanals.
 *
 * Die Webhook-URL ist ein Geheimnis: Wer sie hat, schreibt in den Kanal. Sie
 * wird deshalb **nie** in einem DTO ausgeliefert (siehe
 * {@link NotificationChannelDto.target}). Der Standardkanal einer Instanz kommt
 * ohne eigenen Datensatz aus der zentralen `.env` (`DISCORD_WEBHOOK_URL`,
 * Pflichtenheft §12.1) – dafür bleibt `webhookUrl` beim Anlegen optional.
 */
export interface DiscordWebhookTargetInput {
  /** Vollständige Webhook-URL. Ohne Angabe gilt `DISCORD_WEBHOOK_URL` aus der `.env`. */
  webhookUrl?: string;
  /** Abweichender Anzeigename des Absenders in Discord. */
  username?: string;
}

/**
 * Zielangaben eines Kanals, wie sie **ausgeliefert** werden.
 *
 * Enthält bewusst kein Geheimnis, sondern nur, was die Oberfläche zur
 * Wiedererkennung braucht. `hint` ist eine gekürzte, nicht wiederherstellbare
 * Darstellung des Ziels (z. B. `discord.com/api/webhooks/…/abcd`), damit ein
 * Admin zwei Kanäle unterscheiden kann, ohne die URL zu sehen.
 */
export interface NotificationChannelTarget {
  /** Kurzform des Ziels ohne Geheimnis; `null`, wenn der Kanal die `.env`-Vorgabe nutzt. */
  hint: string | null;
  /** Nutzt dieser Kanal `DISCORD_WEBHOOK_URL` aus der zentralen `.env`? */
  usesEnvDefault: boolean;
  /** Abweichender Anzeigename des Absenders; `null` = Vorgabe des Webhooks. */
  username: string | null;
}

/** `permissions`-Objekt eines Kanals (Pflichtenheft §5.2). */
export interface NotificationChannelPermissions {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Testnachricht auslösen. */
  canTest: boolean;
}

/** Kanal (Pflichtenheft §6, Entität `NotificationChannel`). */
export interface NotificationChannelDto extends WithPermissions<NotificationChannelPermissions> {
  id: string;
  name: string;
  type: NotificationChannelType;
  target: NotificationChannelTarget;
  /** Abgeschaltete Kanäle bleiben erhalten, werden aber übersprungen. */
  enabled: boolean;
  /**
   * Ist dieser Kanal derzeit versandfähig? `false`, wenn er die `.env`-Vorgabe
   * nutzt und `DISCORD_WEBHOOK_URL` nicht gesetzt ist – die Oberfläche kann das
   * anzeigen, statt es erst beim ersten Ereignis auffallen zu lassen.
   */
  deliverable: boolean;
  /** Zeitpunkt der letzten erfolgreichen Zustellung (ISO-8601); `null`, wenn noch keine. */
  lastDeliveryAt: string | null;
  /** Benannter Fehlercode der letzten gescheiterten Zustellung; `null`, wenn die letzte gelang. */
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
  /** Anzahl der Regeln, die diesen Kanal nutzen – Warnung vor dem Löschen. */
  ruleCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Regel (Entität `NotificationRule`, Pflichtenheft §6)
// ---------------------------------------------------------------------------

/**
 * Empfängerkreis einer Regel (Lastenheft §3.6: „welches Ereignis löst welchen
 * Kanal für welchen Empfängerkreis aus").
 *
 * - `resourceOwner` – wem die betroffene Ressource gehört (Serverbesitzer,
 *   Backup-Besitzer). Bei Ereignissen ohne Besitzer (`user.registered`,
 *   `announcement.published`) trifft dieser Kreis niemanden.
 * - `serverMembers` – Besitzer **und** Mitverwalter (`ServerMember`).
 * - `role` – alle Träger einer bestimmten Rolle; die Rolle steht in
 *   `recipientRoleId`. So entsteht „alle Admins" ohne einen zweiten,
 *   parallelen Admin-Begriff neben dem Rollensystem aus §8.
 * - `allUsers` – alle freigeschalteten Konten. Für Wartungshinweise gedacht;
 *   bei einem häufigen Ereignis bewusst eine schlechte Wahl, deshalb im
 *   Regel-Editor mit Warnhinweis.
 */
export const NOTIFICATION_RECIPIENT_SCOPES = [
  'resourceOwner',
  'serverMembers',
  'role',
  'allUsers',
] as const;

export type NotificationRecipientScope = (typeof NOTIFICATION_RECIPIENT_SCOPES)[number];

/** `permissions`-Objekt einer Regel (Pflichtenheft §5.2). */
export interface NotificationRulePermissions {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/** Regel (Pflichtenheft §6, Entität `NotificationRule`). */
export interface NotificationRuleDto extends WithPermissions<NotificationRulePermissions> {
  id: string;
  event: NotifiableEventName;
  /**
   * Externer Kanal; `null` bedeutet „nur Inbox".
   *
   * Bewusst optional statt Pflicht: Die Inbox im Panel ist der Grundweg, der
   * externe Kanal die Ergänzung (Lastenheft §3.6). Eine Regel ohne Kanal ist
   * daher kein unvollständiger Datensatz.
   */
  channelId: string | null;
  /** Name des Kanals zum Anzeigen; `null` bei „nur Inbox". */
  channelName: string | null;
  recipientScope: NotificationRecipientScope;
  /** Rolle bei `recipientScope: 'role'`, sonst `null`. */
  recipientRoleId: string | null;
  recipientRoleName: string | null;
  /** In die Inbox des Panels zustellen (Standard). */
  inboxEnabled: boolean;
  /**
   * Dringlichkeit, mit der Meldungen dieser Regel entstehen.
   *
   * `null` bedeutet „die des Ereignisses" – ein fehlgeschlagenes Backup ist
   * dann `error`, ein Serverstart `info`. Ein fester Vorgabewert an der Regel
   * würde `backup.failed` still auf `info` herabstufen; die Angabe ist deshalb
   * ein bewusstes Überschreiben und nicht der Normalfall.
   */
  severity: NotificationSeverity | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Inbox (Zustellung im Panel)
// ---------------------------------------------------------------------------

/** `permissions`-Objekt einer Meldung (Pflichtenheft §5.2). */
export interface NotificationPermissions {
  /** Als gelesen bzw. ungelesen markieren. */
  canMarkRead: boolean;
  canDelete: boolean;
}

/**
 * Eine Meldung in der Inbox eines Nutzers (F6).
 *
 * `title` und `body` werden **im Backend** aus Ereignis und Nutzlast gebildet
 * und hier fertig ausgeliefert (Pflichtenheft §5.2: keine Auslegung im
 * Frontend). `data` trägt die ursprüngliche Nutzlast mit, damit eine spätere
 * Ansicht daraus mehr machen kann, ohne dass die Meldung neu erzeugt werden
 * müsste.
 */
export interface NotificationDto extends WithPermissions<NotificationPermissions> {
  id: string;
  /** Empfänger dieser Meldung. */
  userId: string;
  event: NotifiableEventName;
  severity: NotificationSeverity;
  title: string;
  body: string;
  subject: NotificationSubject | null;
  /** Ursprüngliche Nutzlast des Ereignisses. */
  data: Record<string, unknown>;
  /** Regel, aus der die Meldung entstand; `null` bei direkt zugestellten Meldungen. */
  ruleId: string | null;
  /** ISO-8601-Zeitstempel des Lesens; `null` = ungelesen. */
  readAt: string | null;
  createdAt: string;
}

/** Seite der Inbox. Die Inbox wächst dauerhaft, sie wird nie vollständig geliefert. */
export interface NotificationPageDto {
  entries: NotificationDto[];
  /** Gesamtzahl der Meldungen, die auf den Filter passen. */
  total: number;
  /** Ungelesene Meldungen insgesamt – trägt den Zähler in der Navigation. */
  unreadCount: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Systemweite Ankündigungen (Lastenheft §3.6)
// ---------------------------------------------------------------------------

/** `permissions`-Objekt einer Ankündigung (Pflichtenheft §5.2). */
export interface AnnouncementPermissions {
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * Systemweite Ankündigung durch den Admin, z. B. ein Wartungshinweis.
 *
 * Technisch ein Auslöser wie jeder andere: Beim Veröffentlichen entsteht das
 * Ereignis `announcement.published`, und die Regeln dazu entscheiden über Inbox
 * und externen Kanal. Der Datensatz bleibt trotzdem eigenständig erhalten,
 * damit eine Ankündigung nachträglich korrigiert oder zurückgezogen werden
 * kann, ohne einzelne Inbox-Meldungen anzufassen.
 */
export interface AnnouncementDto extends WithPermissions<AnnouncementPermissions> {
  id: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  /** Konto, das veröffentlicht hat; `null`, wenn es später gelöscht wurde. */
  publishedByUserId: string | null;
  publishedByDisplayName: string | null;
  publishedAt: string;
  /** Ende der Anzeige als Banner (ISO-8601); `null` = ohne Ablauf. */
  expiresAt: string | null;
  /** Anzahl der erzeugten Inbox-Meldungen – zeigt die tatsächliche Reichweite. */
  recipientCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Zustellung an den externen Kanal
// ---------------------------------------------------------------------------

/**
 * Zustand einer Zustellung an einen externen Kanal.
 *
 * `failed` ist bewusst ein normaler Endzustand und kein Fehler des auslösenden
 * Vorgangs: Ein nicht erreichbarer Discord-Webhook darf einen Serverstart oder
 * ein Backup niemals scheitern lassen (Pflichtenheft §14, CLAUDE.md §5).
 */
export const NOTIFICATION_DELIVERY_STATUSES = ['pending', 'delivered', 'failed'] as const;

export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

/**
 * Protokoll einer Zustellung nach außen (Admin-Ansicht F10).
 *
 * Ohne dieses Protokoll wäre eine stille Fehlzustellung unsichtbar – genau die
 * Kehrseite davon, dass sie den auslösenden Vorgang nicht scheitern lässt.
 */
export interface NotificationDeliveryDto {
  id: string;
  channelId: string;
  channelName: string;
  ruleId: string | null;
  event: NotifiableEventName;
  status: NotificationDeliveryStatus;
  attempts: number;
  /** Benannter Fehlercode bei `status: 'failed'`; `null` sonst. */
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  /** Zeitpunkt der erfolgreichen Zustellung (ISO-8601); `null`, solange keine gelang. */
  deliveredAt: string | null;
}

// ---------------------------------------------------------------------------
// Live-Kanal Browser <-> Backend für die Inbox (Pflichtenheft §5.3)
// ---------------------------------------------------------------------------

/**
 * Eigener Live-Kanal für Benachrichtigungen.
 *
 * Pflichtenheft §5.3 nennt „WebSocket-Kanäle" im Plural und listet
 * Benachrichtigungen neben Konsole, Live-Stats und Chat. Bewusst **nicht** in
 * den Server-Kanal aus `server-live.ts` eingebaut: Der abonniert eine einzelne
 * Ressource (`{ resource: 'server', id }`), die Inbox hängt dagegen am
 * angemeldeten Konto und soll unabhängig davon offen sein, ob gerade eine
 * Serveransicht angezeigt wird.
 *
 * Der Empfänger ergibt sich aus der Sitzung, nicht aus einem Frame-Feld – ein
 * Client kann also nicht die Inbox eines fremden Kontos abonnieren.
 */
export const NOTIFICATION_LIVE_EVENTS = [
  'notification.created',
] as const satisfies readonly WebSocketEventName[];

export type NotificationLiveEventName = (typeof NOTIFICATION_LIVE_EVENTS)[number];

export function isNotificationLiveEventName(value: string): value is NotificationLiveEventName {
  return (NOTIFICATION_LIVE_EVENTS as readonly string[]).includes(value);
}

/** Frames, die der Browser auf diesem Kanal schickt. */
export type NotificationClientFrame =
  /** Inbox des angemeldeten Kontos abonnieren. */
  | { kind: 'subscribe' }
  | { kind: 'unsubscribe' }
  /** Lebenszeichen, damit Reverse Proxies die Verbindung nicht schließen. */
  | { kind: 'ping' };

/** Frames, die der Browser auf diesem Kanal empfängt. */
export type NotificationServerFrame =
  | {
      kind: 'event';
      event: 'notification.created';
      data: { notification: NotificationDto; unreadCount: number };
      /** ISO-8601-Zeitstempel des Versands. */
      sentAt: string;
    }
  | { kind: 'subscribed'; data: { unreadCount: number }; sentAt: string }
  | { kind: 'pong'; sentAt: string };
