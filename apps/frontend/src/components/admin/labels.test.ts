import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  BACKUP_STATUSES,
  BACKUP_TYPES,
  CONVERSATION_TYPES,
  HOST_NODE_STATUSES,
  MESSAGE_MODERATION_ACTIONS,
  MESSAGE_REPORT_STATUSES,
  NOTIFIABLE_EVENTS,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_RECIPIENT_SCOPES,
  NOTIFICATION_SEVERITIES,
  REGISTRATION_REQUEST_STATUSES,
  STORAGE_ENTRY_KINDS,
  type StorageDeleteBlockReason,
} from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  auditActionLabel,
  auditTargetTypeLabel,
  backupStatusLabel,
  backupTypeLabel,
  conversationTypeLabel,
  deliveryStatusLabel,
  moderationActionLabel,
  nodeStatusLabel,
  notifiableEventLabel,
  permissionAreaLabel,
  recipientScopeLabel,
  registrationStatusLabel,
  reportStatusLabel,
  severityLabel,
  storageBlockReasonLabel,
  storageKindLabel,
} from './labels';

/**
 * Sichert zu, dass jede Aufzählung aus den Contracts eine deutsche Beschriftung
 * bekommt – so fällt eine neue, unübersetzte Konstante hier auf, nicht erst als
 * roher Code in der Oberfläche.
 */

const nonEmpty = (value: string) => value.trim().length > 0;

describe('Beschriftungen sind vollständig', () => {
  it('übersetzt jede bekannte Audit-Aktion', () => {
    for (const action of AUDIT_ACTIONS) expect(nonEmpty(auditActionLabel(action))).toBe(true);
  });

  it('übersetzt jeden Audit-Objekttyp', () => {
    for (const type of AUDIT_TARGET_TYPES) expect(nonEmpty(auditTargetTypeLabel(type))).toBe(true);
  });

  it('übersetzt jede Speicher-Kategorie', () => {
    for (const kind of STORAGE_ENTRY_KINDS) expect(nonEmpty(storageKindLabel(kind))).toBe(true);
  });

  it('übersetzt jeden Sperr-Grund der Speicherverwaltung', () => {
    const reasons: StorageDeleteBlockReason[] = [
      'activeServerData',
      'imageInUse',
      'notClearlyOrphaned',
      'permissionMissing',
    ];
    for (const reason of reasons) expect(nonEmpty(storageBlockReasonLabel(reason))).toBe(true);
  });

  it('übersetzt jedes benachrichtigungsfähige Ereignis', () => {
    for (const event of NOTIFIABLE_EVENTS) expect(nonEmpty(notifiableEventLabel(event))).toBe(true);
  });

  it('übersetzt jede Dringlichkeit, jeden Empfängerkreis und jeden Zustellstatus', () => {
    for (const severity of NOTIFICATION_SEVERITIES)
      expect(nonEmpty(severityLabel(severity))).toBe(true);
    for (const scope of NOTIFICATION_RECIPIENT_SCOPES)
      expect(nonEmpty(recipientScopeLabel(scope))).toBe(true);
    for (const status of NOTIFICATION_DELIVERY_STATUSES)
      expect(nonEmpty(deliveryStatusLabel(status))).toBe(true);
  });

  it('übersetzt jede Backup-Art und jeden Backup-Status', () => {
    for (const type of BACKUP_TYPES) expect(nonEmpty(backupTypeLabel(type))).toBe(true);
    for (const status of BACKUP_STATUSES) expect(nonEmpty(backupStatusLabel(status))).toBe(true);
  });

  it('übersetzt jeden Node-Status', () => {
    for (const status of HOST_NODE_STATUSES) expect(nonEmpty(nodeStatusLabel(status))).toBe(true);
  });

  it('übersetzt jeden Warteliste- und Meldungs-Status', () => {
    for (const status of REGISTRATION_REQUEST_STATUSES)
      expect(nonEmpty(registrationStatusLabel(status))).toBe(true);
    for (const status of MESSAGE_REPORT_STATUSES)
      expect(nonEmpty(reportStatusLabel(status))).toBe(true);
    for (const action of MESSAGE_MODERATION_ACTIONS)
      expect(nonEmpty(moderationActionLabel(action))).toBe(true);
    for (const type of CONVERSATION_TYPES) expect(nonEmpty(conversationTypeLabel(type))).toBe(true);
  });
});

describe('permissionAreaLabel', () => {
  it('kennt die bekannten Bereiche', () => {
    expect(permissionAreaLabel('server')).toBe('Server');
    expect(permissionAreaLabel('audit')).toBe('Audit-Log');
  });

  it('gibt einen unbekannten Bereich unverändert zurück', () => {
    expect(permissionAreaLabel('unbekannt')).toBe('unbekannt');
  });
});
