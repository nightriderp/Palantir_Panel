/**
 * Audit-Log (Lastenheft §3.7 und §4, Pflichtenheft §6 und §18).
 *
 * **Append-only.** Es gibt hier bewusst weder einen Update- noch einen
 * Delete-DTO und keinen Eingabetyp zum Ändern eines Eintrags – auch nicht für
 * Admins, auch nicht „temporär" (CLAUDE.md §2). Ein einmal geschriebener
 * Eintrag bleibt, wie er ist.
 *
 * Die einzige Ausnahme beim Entfernen ist der rein additive
 * Archivierungsprozess aus Pflichtenheft §6: Einträge, die älter als
 * {@link AUDIT_RETENTION_MONTHS} sind, werden zuerst vollständig in eine
 * komprimierte Archivdatei exportiert und erst danach aus der aktiven Tabelle
 * entfernt. Das Ergebnis dieses Laufs beschreibt {@link AuditArchiveResultDto}.
 */

/**
 * Aufbewahrungsdauer in der aktiven Tabelle (Pflichtenheft §6).
 *
 * Ältere Einträge sind nicht gelöscht, sondern liegen in der Archivdatei.
 */
export const AUDIT_RETENTION_MONTHS = 24;

/**
 * Katalog der protokollierten Aktionen.
 *
 * Benennungsschema wie bei den WebSocket-Events (`events.ts`):
 * `<domäne>.<vorgang>`, beide Segmente lowerCamelCase, genau ein Punkt.
 *
 * Der Katalog ist **wachsend**: Jedes Arbeitspaket ergänzt hier additiv die
 * sicherheitsrelevanten Aktionen, die es selbst protokolliert – niemals als
 * Freitext am Aufrufort (CLAUDE.md §5). Das Entfernen oder Umbenennen eines
 * bestehenden Eintrags ist ein Breaking Change: bereits geschriebene Einträge
 * ließen sich sonst nicht mehr zuordnen, und genau das darf ein append-only Log
 * nicht zulassen.
 */
export const AUDIT_ACTIONS = [
  // Konten und Anmeldung (B1)
  'auth.loginSucceeded',
  'auth.loginFailed',
  'auth.loggedOut',
  'auth.sessionRevoked',
  'auth.passwordChanged',
  'auth.passwordResetByAdmin',
  'auth.twoFactorEnabled',
  'auth.twoFactorDisabled',
  'auth.methodLinked',
  'auth.methodUnlinked',

  // Nutzerverwaltung (B1/B8)
  'user.registered',
  'user.approved',
  'user.banned',
  'user.unbanned',
  'user.deleted',
  'user.limitsChanged',
  'user.roleAssigned',
  'user.roleRemoved',

  // Rollen (B2)
  'role.created',
  'role.updated',
  'role.deleted',

  // Server-Lebenszyklus (B3)
  'server.created',
  'server.deleted',
  'server.cloned',
  'server.settingsChanged',
  'server.memberAdded',
  'server.memberRemoved',

  // Backups (B5)
  'backup.created',
  'backup.restored',
  'backup.deleted',

  // Nodes und Adressen (B8)
  'node.created',
  'node.updated',
  'node.deleted',
  'address.rangeCreated',
  'address.rangeUpdated',
  'address.rangeDeleted',
  'address.portAllocated',
  'address.portReleased',

  // Speicherverwaltung und Audit-Log selbst (B8)
  'storage.scanned',
  'storage.entryDeleted',
  'audit.archived',

  // Benachrichtigungen und Moderation (B6/B7)
  'notification.channelChanged',
  'notification.ruleChanged',
  /** Systemweite Ankündigung veröffentlicht, geändert oder zurückgezogen (Lastenheft §3.6). */
  'notification.announcementChanged',
  'message.moderated',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Art des betroffenen Objekts (Pflichtenheft §6, `AuditLog.targetType`).
 *
 * Bewusst eine feste Liste statt Freitext, damit die Admin-Oberfläche danach
 * filtern kann.
 */
export const AUDIT_TARGET_TYPES = [
  'user',
  'role',
  'session',
  'server',
  'backup',
  'node',
  'portRange',
  'portAllocation',
  'storageEntry',
  'auditLog',
  'notificationChannel',
  'notificationRule',
  'announcement',
  'message',
] as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export function isAuditTargetType(value: string): value is AuditTargetType {
  return (AUDIT_TARGET_TYPES as readonly string[]).includes(value);
}

/**
 * `permissions`-Objekt eines Audit-Eintrags (Pflichtenheft §5.2).
 *
 * Enthält bewusst **nur** `canView`. Ein `canEdit` oder `canDelete` gäbe es
 * hier nie in `true` – ein Flag, das immer `false` ist, würde nur den falschen
 * Eindruck erwecken, es gäbe einen Weg dorthin.
 */
export interface AuditLogEntryPermissions {
  canView: boolean;
}

/** Eintrag im Audit-Log (Pflichtenheft §6, Entität `AuditLog`). */
export interface AuditLogEntryDto {
  id: string;
  action: AuditAction;
  /** Handelnder; `null` bei Systemvorgängen (z. B. automatische Archivierung). */
  actorId: string | null;
  /** Anzeigename des Handelnden zum Zeitpunkt der Aktion – bleibt lesbar, auch wenn das Konto später verschwindet. */
  actorDisplayName: string | null;
  targetType: AuditTargetType | null;
  targetId: string | null;
  /**
   * Grobe Herkunft des Requests (gekürzte IP, wie `Session.ipHint` in
   * Pflichtenheft §6); `null`, wenn die Aktion nicht aus einem Request stammt.
   */
  ipHint: string | null;
  /** Zusatzangaben zur Aktion, z. B. geänderte Felder. */
  metadata: Record<string, unknown>;
  /** ISO-8601-Zeitstempel. */
  timestamp: string;
  permissions: AuditLogEntryPermissions;
}

/**
 * Seite einer Audit-Log-Abfrage.
 *
 * Das Log wächst dauerhaft; die Übersicht wird deshalb immer seitenweise
 * geliefert, nie vollständig.
 */
export interface AuditLogPageDto {
  entries: AuditLogEntryDto[];
  /** Gesamtzahl der Einträge, die auf den Filter passen. */
  total: number;
  /** Angewendetes Seitenlimit. */
  limit: number;
  /** Übersprungene Einträge. */
  offset: number;
}

/**
 * Ergebnis eines Archivierungslaufs (Pflichtenheft §6).
 *
 * Der Lauf ist rein additiv: Er schreibt zuerst die Archivdatei und entfernt
 * die Einträge erst danach aus der aktiven Tabelle. Schlägt der Export fehl,
 * bleibt die Tabelle unverändert.
 */
export interface AuditArchiveResultDto {
  /** Anzahl der archivierten und danach entfernten Einträge. */
  archivedCount: number;
  /** Ablageort der komprimierten Archivdatei auf der VPS; `null`, wenn nichts zu archivieren war. */
  archiveFilePath: string | null;
  /** Größe der Archivdatei in Bytes; `null`, wenn keine Datei entstanden ist. */
  archiveSizeBytes: number | null;
  /** Stichtag: Einträge älter als dieser Zeitpunkt wurden archiviert (ISO-8601). */
  cutoff: string;
  /** Zeitstempel des ältesten archivierten Eintrags (ISO-8601); `null` bei leerem Lauf. */
  oldestTimestamp: string | null;
  /** Zeitstempel des jüngsten archivierten Eintrags (ISO-8601); `null` bei leerem Lauf. */
  newestTimestamp: string | null;
  /** Zeitpunkt des Laufs (ISO-8601). */
  executedAt: string;
}
