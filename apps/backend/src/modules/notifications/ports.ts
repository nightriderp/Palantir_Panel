/**
 * Schnittstellen der Notification-Engine nach außen.
 *
 * B6 kennt weder Discord noch die Datenbank noch die auslösenden Arbeitspakete
 * direkt, sondern spricht ausschließlich über die Schnittstellen in dieser
 * Datei. Das hält die fachlichen Regeln (Regelauswertung, Empfängerkreis,
 * Textbildung) ohne Infrastruktur testbar – dieselbe Trennung wie in B5 und
 * beim `ContainerRuntime`-Interface des Agents (CLAUDE.md §4).
 *
 * Wer setzt was ein:
 * - {@link RecipientDirectory} – hier über Drizzle umgesetzt (`repository.ts`)
 * - {@link NotificationTransport} – hier für Discord umgesetzt (`discord.ts`)
 * - {@link LiveNotificationPublisher} – der WebSocket-Kanal (`live.ts`)
 * - {@link NotificationAuditSink} – B8 (Audit-Log, Pflichtenheft §6)
 */

import type { ErrorCode, NotificationChannelType, NotificationDto } from '@palantir/contracts';

/**
 * Nachschlagen von Empfängern (Entitäten `User`, `UserRole`, Pflichtenheft §6).
 *
 * Die Empfängerkreise `resourceOwner` und `serverMembers` stehen bereits in der
 * Nutzlast des Ereignisses und brauchen keinen Nachschlag – nur `role` und
 * `allUsers` erreichen dieses Verzeichnis.
 */
export interface RecipientDirectory {
  /**
   * Alle freigeschalteten Konten (Lastenheft §3.1).
   *
   * Gesperrte Konten und solche, die noch auf der Warteliste stehen, bleiben
   * außen vor: Eine Wartungsmeldung an ein gesperrtes Konto hätte keinen
   * Empfänger, der etwas damit anfangen kann.
   */
  listActiveUserIds(): Promise<string[]>;
  /** Alle Träger einer Rolle – auch gesperrte bleiben hier außen vor. */
  listUserIdsWithRole(roleId: string): Promise<string[]>;
  /** Anzeigenamen zu bereits bekannten Konto-Ids (Admin-Ansichten). */
  findDisplayNames(userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/** Eine fertig gerenderte Nachricht für einen externen Kanal. */
export interface OutboundMessage {
  title: string;
  body: string;
  /** Bestimmt die Farbe des Discord-Embeds. */
  severity: 'info' | 'warning' | 'error';
  /** Zeitpunkt des auslösenden Vorgangs (ISO-8601), nicht der des Versands. */
  at: string;
}

/** Aufgelöstes Ziel eines Kanals – erst hier steckt das Geheimnis. */
export interface ResolvedChannelTarget {
  type: NotificationChannelType;
  /** Vollständige Webhook-URL, entweder aus dem Datensatz oder aus der `.env`. */
  webhookUrl: string;
  /** Abweichender Absendername; `null` = Vorgabe des Webhooks. */
  username: string | null;
}

/**
 * Versand an einen externen Kanal.
 *
 * Wirft bei Misserfolg einen {@link NotificationTransportError}. Der Aufrufer
 * (`service.ts`) fängt ihn ausnahmslos ab – ein nicht erreichbarer Webhook darf
 * den auslösenden Vorgang nicht scheitern lassen (Pflichtenheft §14).
 */
export interface NotificationTransport {
  send(target: ResolvedChannelTarget, message: OutboundMessage): Promise<void>;
}

/**
 * Fehler eines Transports.
 *
 * Trägt einen benannten Code aus dem Katalog, damit die Ursache in
 * `notification_deliveries` und am Kanal (`lastFailureCode`) auswertbar bleibt
 * statt als Freitext (CLAUDE.md §5).
 */
export class NotificationTransportError extends Error {
  readonly code: ErrorCode;
  /**
   * Lohnt ein weiterer Versuch?
   *
   * `true` bei Netzfehlern, abgelaufener Frist und den Antworten 429/5xx.
   * `false` bei allem anderen: Eine falsche oder zurückgezogene Webhook-URL
   * wird durch Wiederholen nicht richtig, und jeder weitere Versuch verzögert
   * nur den Eintrag im Zustellungsprotokoll.
   */
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'NotificationTransportError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function isNotificationTransportError(
  error: unknown,
): error is NotificationTransportError {
  return error instanceof NotificationTransportError;
}

/** Eine Meldung, wie sie über den Live-Kanal an eine offene Inbox geht. */
export interface LiveNotificationPayload {
  notification: NotificationDto;
  /** Stand des Zählers in der Navigation nach dieser Meldung. */
  unreadCount: number;
}

/**
 * Zustellung an offene Inbox-Ansichten (Pflichtenheft §5.3).
 *
 * Bewusst ohne Rückmeldung: Ist gerade niemand verbunden, ist das kein Fehler –
 * die Meldung steht in der Datenbank und wird beim nächsten Abruf geliefert.
 */
export interface LiveNotificationPublisher {
  publish(userId: string, payload: LiveNotificationPayload): void;
}

/** Live-Senke, solange kein WebSocket-Kanal eingehängt ist (Tests, Betrieb ohne Frontend). */
export const noopLivePublisher: LiveNotificationPublisher = {
  publish() {
    // absichtlich leer
  },
};

/**
 * Sicherheitsrelevante Änderungen ins Audit-Log (Pflichtenheft §6).
 *
 * Bewusst eine eigene, schmale Schnittstelle statt einer direkten Abhängigkeit
 * auf den `AuditService` aus B8: B6 protokolliert nur drei Aktionen und soll
 * ohne das Admin-Modul testbar bleiben.
 */
export interface NotificationAuditSink {
  record(entry: {
    action: 'notification.channelChanged' | 'notification.ruleChanged' | 'notification.announcementChanged';
    actorId: string | null;
    targetType: 'notificationChannel' | 'notificationRule' | 'announcement';
    targetId: string;
    metadata: Record<string, unknown>;
  }): void | Promise<void>;
}

/** Audit-Senke, solange B8 nicht eingehängt ist. */
export const noopAuditSink: NotificationAuditSink = {
  record() {
    // absichtlich leer
  },
};

/** Zeitquelle – austauschbar, damit Ablaufzeiten und Zeitstempel testbar bleiben. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/**
 * Startet einen Hintergrundlauf.
 *
 * Der Versand an einen externen Kanal geht über das Netz und dauert im
 * schlechten Fall Sekunden. Der auslösende Vorgang darf darauf nicht warten –
 * der Standard stößt den Lauf an und vergisst ihn. Tests reichen einen Runner
 * herein, der sofort und beobachtbar ausführt.
 */
export type JobRunner = (job: () => Promise<void>) => void;

export const fireAndForgetJobRunner: JobRunner = (job) => {
  void job();
};
