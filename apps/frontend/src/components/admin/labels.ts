import { type RegistrationRequestQuota, type ResourceQuotaSlot } from '@palantir/contracts';
import { formatMegabytes } from '@/components/shared';
import {
  type AuditAction,
  type AuditTargetType,
  type BackupStatus,
  type BackupType,
  type ConversationType,
  type HostNodeStatus,
  type MessageModerationAction,
  type MessageReportStatus,
  type NotifiableEventName,
  type NotificationDeliveryStatus,
  type NotificationRecipientScope,
  type NotificationSeverity,
  type RegistrationRequestStatus,
  type StorageDeleteBlockReason,
  type StorageEntryKind,
} from '@palantir/contracts';
import { type Tone } from '@/components/shared';

/**
 * Deutsche Beschriftungen der Aufzählungswerte aus den Contracts (Lastenheft §4).
 *
 * An einer Stelle, damit dieselbe Wortwahl in allen Admin-Ansichten gilt und
 * nicht jede Ansicht ihre eigene Übersetzung erfindet. Codes, die (noch) keine
 * eigene Beschriftung haben, werden roh angezeigt – lieber die technische
 * Angabe als eine falsche Beschreibung (wie schon bei `describeCron` in F3).
 */

// ---------------------------------------------------------------------------
// Audit-Log
// ---------------------------------------------------------------------------

const AUDIT_ACTION_LABELS: Partial<Record<AuditAction, string>> = {
  'auth.loginSucceeded': 'Anmeldung erfolgreich',
  'auth.loginFailed': 'Anmeldung fehlgeschlagen',
  'auth.loggedOut': 'Abgemeldet',
  'auth.sessionRevoked': 'Sitzung widerrufen',
  'auth.passwordChanged': 'Passwort geändert',
  'auth.passwordResetByAdmin': 'Passwort durch Admin zurückgesetzt',
  'auth.twoFactorEnabled': '2FA aktiviert',
  'auth.twoFactorDisabled': '2FA deaktiviert',
  'auth.methodLinked': 'Anmeldeverfahren verknüpft',
  'auth.methodUnlinked': 'Anmeldeverfahren getrennt',
  'user.registered': 'Konto registriert',
  'user.approved': 'Konto freigegeben',
  'user.banned': 'Konto gesperrt',
  'user.unbanned': 'Sperre aufgehoben',
  'user.deleted': 'Konto gelöscht',
  'user.limitsChanged': 'Kontingent geändert',
  'user.roleAssigned': 'Rolle zugewiesen',
  'user.roleRemoved': 'Rolle entzogen',
  'user.ownerGranted': 'Owner-Status vergeben',
  'role.created': 'Rolle angelegt',
  'role.updated': 'Rolle geändert',
  'role.deleted': 'Rolle gelöscht',
  'server.created': 'Server erstellt',
  'server.deleted': 'Server gelöscht',
  'server.cloned': 'Server geklont',
  'server.settingsChanged': 'Server-Einstellungen geändert',
  'server.memberAdded': 'Mitglied hinzugefügt',
  'server.memberRemoved': 'Mitglied entfernt',
  'backup.created': 'Backup erstellt',
  'backup.restored': 'Backup wiederhergestellt',
  'backup.deleted': 'Backup gelöscht',
  'node.created': 'Node angelegt',
  'node.updated': 'Node geändert',
  'node.deleted': 'Node entfernt',
  'address.rangeCreated': 'Port-Bereich angelegt',
  'address.rangeUpdated': 'Port-Bereich geändert',
  'address.rangeDeleted': 'Port-Bereich gelöscht',
  'address.portAllocated': 'Port zugewiesen',
  'address.portReleased': 'Port freigegeben',
  'storage.scanned': 'Speicher gescannt',
  'storage.entryDeleted': 'Speicher-Eintrag gelöscht',
  'audit.archived': 'Audit-Log archiviert',
  'notification.channelChanged': 'Kanal geändert',
  'notification.ruleChanged': 'Regel geändert',
  'notification.announcementChanged': 'Ankündigung geändert',
  'message.moderated': 'Nachricht moderiert',
};

export function auditActionLabel(action: AuditAction): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

const AUDIT_TARGET_TYPE_LABELS: Record<AuditTargetType, string> = {
  user: 'Konto',
  role: 'Rolle',
  session: 'Sitzung',
  server: 'Server',
  backup: 'Backup',
  node: 'Node',
  portRange: 'Port-Bereich',
  portAllocation: 'Port-Zuweisung',
  storageEntry: 'Speicher-Eintrag',
  auditLog: 'Audit-Log',
  notificationChannel: 'Kanal',
  notificationRule: 'Regel',
  announcement: 'Ankündigung',
  message: 'Nachricht',
};

export function auditTargetTypeLabel(target: AuditTargetType): string {
  return AUDIT_TARGET_TYPE_LABELS[target];
}

// ---------------------------------------------------------------------------
// Berechtigungen (Rollen-Editor)
// ---------------------------------------------------------------------------

const PERMISSION_AREA_LABELS: Record<string, string> = {
  server: 'Server',
  backup: 'Backups',
  user: 'Nutzer',
  role: 'Rollen',
  notification: 'Benachrichtigungen',
  node: 'Nodes',
  address: 'Adressen',
  audit: 'Audit-Log',
  message: 'Moderation',
  gametype: 'Spiele-Definitionen',
};

/** Deutsche Überschrift für die Gruppe eines Permission-Bereichs (Präfix vor dem ersten Punkt). */
export function permissionAreaLabel(area: string): string {
  return PERMISSION_AREA_LABELS[area] ?? area;
}

// ---------------------------------------------------------------------------
// Speicherverwaltung
// ---------------------------------------------------------------------------

const STORAGE_KIND_LABELS: Record<StorageEntryKind, string> = {
  serverData: 'Server-Daten',
  backup: 'Backup',
  dockerImage: 'Docker-Image',
  orphaned: 'Verwaiste Daten',
  other: 'Sonstiges',
};

export function storageKindLabel(kind: StorageEntryKind): string {
  return STORAGE_KIND_LABELS[kind];
}

const STORAGE_BLOCK_REASON_LABELS: Record<StorageDeleteBlockReason, string> = {
  activeServerData: 'Datenordner eines aktiven Servers – nur über „Server löschen" entfernbar.',
  imageInUse: 'Wird von mindestens einem Container benutzt.',
  notClearlyOrphaned: 'Nicht eindeutig zuzuordnen – nicht zum Löschen freigegeben.',
  permissionMissing: 'Dir fehlt die Berechtigung zur Speicherverwaltung.',
};

export function storageBlockReasonLabel(reason: StorageDeleteBlockReason): string {
  return STORAGE_BLOCK_REASON_LABELS[reason];
}

// ---------------------------------------------------------------------------
// Benachrichtigungen
// ---------------------------------------------------------------------------

const NOTIFIABLE_EVENT_LABELS: Record<NotifiableEventName, string> = {
  'server.created': 'Server erstellt',
  'server.started': 'Server gestartet',
  'server.stopped': 'Server gestoppt',
  'server.restarted': 'Server neu gestartet',
  'server.crashed': 'Server abgestürzt',
  'server.failed': 'Serverstart fehlgeschlagen',
  'server.cloned': 'Server geklont',
  'server.deleted': 'Server gelöscht',
  'autoShutdown.triggered': 'Automatische Abschaltung',
  'backup.failed': 'Backup fehlgeschlagen',
  'resource.low': 'Ressourcen werden knapp',
  'user.registered': 'Neue Registrierung',
  'message.reported': 'Nachricht gemeldet',
  'announcement.published': 'Ankündigung veröffentlicht',
};

export function notifiableEventLabel(event: NotifiableEventName): string {
  return NOTIFIABLE_EVENT_LABELS[event];
}

const SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  info: 'Info',
  warning: 'Warnung',
  error: 'Fehler',
};

export function severityLabel(severity: NotificationSeverity): string {
  return SEVERITY_LABELS[severity];
}

export function severityTone(severity: NotificationSeverity): Tone {
  return severity === 'error' ? 'danger' : severity === 'warning' ? 'warning' : 'brand';
}

const RECIPIENT_SCOPE_LABELS: Record<NotificationRecipientScope, string> = {
  resourceOwner: 'Besitzer der Ressource',
  serverMembers: 'Server-Mitglieder',
  role: 'Träger einer Rolle',
  allUsers: 'Alle Konten',
};

export function recipientScopeLabel(scope: NotificationRecipientScope): string {
  return RECIPIENT_SCOPE_LABELS[scope];
}

const DELIVERY_STATUS_LABELS: Record<NotificationDeliveryStatus, string> = {
  pending: 'Ausstehend',
  delivered: 'Zugestellt',
  failed: 'Fehlgeschlagen',
};

export function deliveryStatusLabel(status: NotificationDeliveryStatus): string {
  return DELIVERY_STATUS_LABELS[status];
}

export function deliveryStatusTone(status: NotificationDeliveryStatus): Tone {
  return status === 'delivered' ? 'success' : status === 'failed' ? 'danger' : 'warning';
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

const BACKUP_TYPE_LABELS: Record<BackupType, string> = {
  manual: 'Manuell',
  automatic: 'Automatisch',
};

export function backupTypeLabel(type: BackupType): string {
  return BACKUP_TYPE_LABELS[type];
}

const BACKUP_STATUS_LABELS: Record<BackupStatus, string> = {
  pending: 'Ausstehend',
  running: 'Läuft',
  completed: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
};

export function backupStatusLabel(status: BackupStatus): string {
  return BACKUP_STATUS_LABELS[status];
}

export function backupStatusTone(status: BackupStatus): Tone {
  return status === 'completed'
    ? 'success'
    : status === 'failed'
      ? 'danger'
      : status === 'running'
        ? 'brand'
        : 'warning';
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

const NODE_STATUS_LABELS: Record<HostNodeStatus, string> = {
  online: 'Online',
  offline: 'Offline',
  maintenance: 'Wartung',
};

export function nodeStatusLabel(status: HostNodeStatus): string {
  return NODE_STATUS_LABELS[status];
}

export function nodeStatusTone(status: HostNodeStatus): Tone {
  return status === 'online' ? 'success' : status === 'maintenance' ? 'warning' : 'danger';
}

// ---------------------------------------------------------------------------
// Warteliste / Nutzer
// ---------------------------------------------------------------------------

const REGISTRATION_STATUS_LABELS: Record<RegistrationRequestStatus, string> = {
  pending: 'Wartet auf Freigabe',
  approved: 'Freigegeben',
  blocked: 'Gesperrt',
};

export function registrationStatusLabel(status: RegistrationRequestStatus): string {
  return REGISTRATION_STATUS_LABELS[status];
}

export function registrationStatusTone(status: RegistrationRequestStatus): Tone {
  return status === 'approved' ? 'success' : status === 'blocked' ? 'danger' : 'warning';
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

const REPORT_STATUS_LABELS: Record<MessageReportStatus, string> = {
  open: 'Offen',
  resolved: 'Bearbeitet',
  dismissed: 'Verworfen',
};

export function reportStatusLabel(status: MessageReportStatus): string {
  return REPORT_STATUS_LABELS[status];
}

export function reportStatusTone(status: MessageReportStatus): Tone {
  return status === 'resolved' ? 'success' : status === 'dismissed' ? 'neutral' : 'warning';
}

const MODERATION_ACTION_LABELS: Record<MessageModerationAction, string> = {
  dismiss: 'Meldung verworfen',
  deleteMessage: 'Nachricht gelöscht',
};

export function moderationActionLabel(action: MessageModerationAction): string {
  return MODERATION_ACTION_LABELS[action];
}

const CONVERSATION_TYPE_LABELS: Record<ConversationType, string> = {
  dm: 'Direktnachricht',
  server_chat: 'Server-Chat',
};

export function conversationTypeLabel(type: ConversationType): string {
  return CONVERSATION_TYPE_LABELS[type];
}

/**
 * Aktion als Code, wie das Mockup sie im Audit-Log zeigt (`LOGIN_FAILED`).
 *
 * Gebildet aus dem echten Schluessel des Katalogs, nicht aus einer zweiten
 * Liste: `auth.loginFailed` wird zu `AUTH.LOGIN_FAILED`. So bleibt die Anzeige
 * eindeutig und waechst automatisch mit, wenn eine Aktion dazukommt. Die
 * ausgeschriebene Bedeutung steht weiter im Titel-Attribut daneben.
 */
export function auditActionCode(action: AuditAction): string {
  return action.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * Meldet die Aktion einen Fehlschlag oder eine Abweisung?
 *
 * Solche Zeilen faerbt das Mockup rot - sie sind der Grund, warum man in ein
 * Audit-Log ueberhaupt hineinsieht.
 */
export function isAuditFailure(action: AuditAction): boolean {
  return /Failed|Denied/.test(action);
}

/**
 * Kontingent einer Zeile der Nutzerliste (Mockup-Abgleich 12.1.3).
 *
 * Der Entwurf schreibt `4 GB / 8 GB · 1 / 3` – Belegung gegen Grenze für
 * Arbeitsspeicher und Serveranzahl. Ohne Grenze steht dort ein Gedankenstrich
 * statt einer erfundenen Zahl; „unbegrenzt" ist keine Grenze, und ein `∞`
 * behauptet mehr, als die harte Node-Prüfung zulässt.
 */
export function quotaLabel(quota: RegistrationRequestQuota | null | undefined): string {
  if (quota === null || quota === undefined) {
    return '—';
  }

  return `${slotLabel(quota.ram, formatMegabytes)} · ${slotLabel(quota.servers, String)}`;
}

function slotLabel(slot: ResourceQuotaSlot, format: (value: number) => string): string {
  const belegt = format(slot.used);

  return slot.limit === null ? `${belegt} / —` : `${belegt} / ${format(slot.limit)}`;
}
