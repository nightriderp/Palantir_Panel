import { type AccountDto, type GlobalPermissions } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { TUTORIAL_SCHRITTE, sichtbareSchritte } from './inhalt';

/**
 * Inhalt der Einweisung.
 *
 * Geprüft wird vor allem das, was kein Leser merkt und trotzdem wehtut: dass
 * die Einweisung keinem Konto einen Bereich erklärt, den es gar nicht sehen
 * darf (Pflichtenheft §5.2). Das Abschlussquiz ist mit dem Katalog nach
 * `fragenkatalog.ts` gezogen und wird dort geprüft.
 */

function berechtigungen(overrides: Partial<GlobalPermissions> = {}): GlobalPermissions {
  return {
    canCreateServer: false,
    canViewAnyServer: false,
    canManageAnyBackup: false,
    canManagePanelBackups: false,
    canManageUsers: false,
    canManageInstance: false,
    canManageRoles: false,
    canManageNotifications: false,
    canViewNodes: false,
    canManageNodes: false,
    canManageAddresses: false,
    canViewAuditLog: false,
    canArchiveAuditLog: false,
    canModerateMessages: false,
    canManageGameTypes: false,
    ...overrides,
  };
}

function konto(overrides: Partial<GlobalPermissions> = {}): AccountDto {
  return {
    id: 'u-1',
    displayName: 'Testnutzer',
    username: 'test',
    isOwner: false,
    banned: false,
    awaitingApproval: false,
    twoFactorEnabled: false,
    roles: [],
    authMethods: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    permissions: berechtigungen(overrides),
  };
}

describe('Schritte der Einweisung', () => {
  it('erklärt jeden Bereich mit Erklärung, Spitze und Ziel', () => {
    for (const schritt of TUTORIAL_SCHRITTE) {
      expect(schritt.erklaerung.length).toBeGreaterThan(40);
      expect(schritt.spitze.length).toBeGreaterThan(10);
      expect(schritt.href.startsWith('/')).toBe(true);
    }
  });

  it('vergibt jeden Schlüssel nur einmal', () => {
    const schluessel = TUTORIAL_SCHRITTE.map((schritt) => schritt.key);

    expect(new Set(schluessel).size).toBe(schluessel.length);
  });

  it('lässt ohne Konto alles weg, was ein Recht verlangt', () => {
    const sichtbar = sichtbareSchritte(null);

    expect(sichtbar.every((schritt) => !schritt.requires)).toBe(true);
    expect(sichtbar.map((schritt) => schritt.key)).not.toContain('nodes');
  });

  it('zeigt einen Schritt erst mit dem Recht, das er nennt', () => {
    const ohne = sichtbareSchritte(konto()).map((schritt) => schritt.key);
    const mit = sichtbareSchritte(konto({ canViewNodes: true })).map((schritt) => schritt.key);

    expect(ohne).not.toContain('nodes');
    expect(mit).toContain('nodes');
    expect(mit).not.toContain('admin');
  });
});
