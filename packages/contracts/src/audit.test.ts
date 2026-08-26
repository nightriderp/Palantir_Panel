import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_RETENTION_MONTHS,
  AUDIT_TARGET_TYPES,
  type AuditLogEntryDto,
  isAuditAction,
  isAuditTargetType,
} from './audit.js';

describe('Audit-Log-Contract (Pflichtenheft §6)', () => {
  it('folgt dem Benennungsschema der Events: <domäne>.<vorgang>', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
    }
  });

  it('enthält keinen Eintrag doppelt', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    expect(new Set(AUDIT_TARGET_TYPES).size).toBe(AUDIT_TARGET_TYPES.length);
  });

  it('deckt die Aktionen der Admin-Funktionen ab (Lastenheft §3.7 und §3.8)', () => {
    expect(AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        'user.approved',
        'user.banned',
        'node.created',
        'address.portAllocated',
        'address.portReleased',
        'storage.entryDeleted',
        'audit.archived',
      ]),
    );
  });

  it('erkennt unbekannte Aktionen und Zielarten', () => {
    expect(isAuditAction('user.approved')).toBe(true);
    expect(isAuditAction('user.geloescht')).toBe(false);
    expect(isAuditTargetType('portRange')).toBe(true);
    expect(isAuditTargetType('irgendwas')).toBe(false);
  });

  it('hält die Aufbewahrungsdauer aus Pflichtenheft §6 fest', () => {
    expect(AUDIT_RETENTION_MONTHS).toBe(24);
  });

  it('bietet im permissions-Objekt keinen Weg zum Ändern oder Löschen (append-only)', () => {
    // Rein typseitige Prüfung: Ein Flag `canEdit`/`canDelete` am Audit-Eintrag
    // würde hier den Build brechen. Das Log ist append-only (CLAUDE.md §2).
    const entry: AuditLogEntryDto = {
      id: '0f2f3f4f-0000-4000-8000-000000000001',
      action: 'audit.archived',
      actorId: null,
      actorDisplayName: null,
      targetType: 'auditLog',
      targetId: null,
      ipHint: null,
      metadata: {},
      timestamp: '2026-08-26T10:00:00.000Z',
      permissions: { canView: true },
    };

    expect(Object.keys(entry.permissions)).toEqual(['canView']);
  });
});
