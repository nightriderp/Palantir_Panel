import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CATALOG,
  PERMISSIONS,
  SCOPED_PERMISSION_BASES,
  descriptionForPermission,
  isPermission,
  scopeForPermission,
} from './permissions.js';

describe('Permission-Katalog (Pflichtenheft §8)', () => {
  it('enthält exakt die im Pflichtenheft aufgezählten Permissions', () => {
    expect([...PERMISSIONS].sort()).toEqual(
      [
        'server.create',
        'server.view.own',
        'server.view.any',
        'server.manage.own',
        'server.manage.any',
        'server.delete.own',
        'server.delete.any',
        'backup.manage.own',
        'backup.manage.any',
        'user.manage',
        'role.manage',
        'notification.manage',
        'node.view',
        'node.manage',
        'address.manage',
        'audit.view',
        'audit.manage',
        'message.moderate',
        'gametype.manage',
      ].sort(),
    );
  });

  it('führt gametype.manage bereits im Katalog, obwohl in Version 1 ungenutzt', () => {
    expect(isPermission('gametype.manage')).toBe(true);
    expect(descriptionForPermission('gametype.manage')).toMatch(/ungenutzt/i);
  });

  it('hält das Benennungsschema ein (lowerCamelCase-Segmente, Punkt als Trenner)', () => {
    for (const permission of PERMISSIONS) {
      expect(permission).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
    }
  });

  it('ordnet jeder Permission eine Beschreibung und einen Geltungsbereich zu', () => {
    for (const permission of PERMISSIONS) {
      expect(descriptionForPermission(permission).length).toBeGreaterThan(0);
      expect(['own', 'any', 'global']).toContain(scopeForPermission(permission));
    }
  });

  it('setzt den Geltungsbereich passend zur Endung der Permission', () => {
    for (const permission of PERMISSIONS) {
      const scope = scopeForPermission(permission);

      if (permission.endsWith('.own')) {
        expect(scope).toBe('own');
      } else if (permission.endsWith('.any')) {
        expect(scope).toBe('any');
      } else {
        expect(scope).toBe('global');
      }
    }
  });

  it('führt zu jeder .own-Permission auch die .any-Variante und umgekehrt', () => {
    for (const base of SCOPED_PERMISSION_BASES) {
      expect(isPermission(`${base}.own`)).toBe(true);
      expect(isPermission(`${base}.any`)).toBe(true);
    }

    const basesFromCatalog = PERMISSIONS.filter((p) => p.endsWith('.own')).map((p) =>
      p.slice(0, -'.own'.length),
    );
    expect([...SCOPED_PERMISSION_BASES].sort()).toEqual(basesFromCatalog.sort());
  });

  it('isPermission() erkennt unbekannte Werte', () => {
    expect(isPermission('server.create')).toBe(true);
    expect(isPermission('server.explode')).toBe(false);
    expect(isPermission('toString')).toBe(false);
  });

  it('Katalog und Permission-Liste bleiben deckungsgleich', () => {
    expect(PERMISSIONS.length).toBe(Object.keys(PERMISSION_CATALOG).length);
  });
});
