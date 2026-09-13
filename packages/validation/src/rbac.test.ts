import { describe, expect, it } from 'vitest';
import {
  createRoleInputSchema,
  permissionSchema,
  roleNameSchema,
  rolePermissionsBundleSchema,
  updateRoleInputSchema,
} from './rbac.js';

describe('Rollen-/Permission-Schemas (Pflichtenheft §8)', () => {
  it('akzeptiert nur Permissions aus dem Katalog', () => {
    expect(permissionSchema.safeParse('server.create').success).toBe(true);
    expect(permissionSchema.safeParse('server.explode').success).toBe(false);
  });

  it('lehnt doppelte Permissions im Bündel ab', () => {
    expect(rolePermissionsBundleSchema.safeParse(['server.create', 'node.view']).success).toBe(
      true,
    );
    expect(rolePermissionsBundleSchema.safeParse(['node.view', 'node.view']).success).toBe(false);
  });

  it('erlaubt ein leeres Bündel (Rolle ohne Berechtigungen, z. B. Gast)', () => {
    expect(rolePermissionsBundleSchema.safeParse([]).success).toBe(true);
  });

  it('begrenzt den Rollennamen und entfernt umschließenden Leerraum', () => {
    expect(roleNameSchema.parse('  Moderator  ')).toBe('Moderator');
    expect(roleNameSchema.safeParse('A').success).toBe(false);
    expect(roleNameSchema.safeParse('x'.repeat(51)).success).toBe(false);
  });

  it('setzt beim Anlegen ohne Angabe ein leeres Permission-Bündel', () => {
    const parsed = createRoleInputSchema.parse({ name: 'Testrolle' });

    expect(parsed.permissions).toEqual([]);
  });

  it('verlangt beim Bearbeiten mindestens ein Feld', () => {
    expect(updateRoleInputSchema.safeParse({}).success).toBe(false);
    expect(updateRoleInputSchema.safeParse({ name: 'Neuer Name' }).success).toBe(true);
  });

  it('weist isProtected beim Bearbeiten ab (Schutzstatus ist nicht setzbar)', () => {
    /*
     * Bis HM-6 stand hier, dass Zod das Feld still entfernt - was stimmte, aber
     * die schwächere Zusicherung war: Der Aufrufer bekam eine Erfolgsmeldung
     * für etwas, das nicht geschehen ist. Seit `.strict()` fällt der Versuch
     * auf, und das ist die Zusicherung, die der Name dieses Tests immer schon
     * behauptet hat.
     */
    const ergebnis = updateRoleInputSchema.safeParse({ name: 'Gast', isProtected: false });

    expect(ergebnis.success).toBe(false);
    expect(
      ergebnis.success
        ? []
        : ergebnis.error.issues.filter((grund) => grund.code === 'unrecognized_keys'),
    ).toHaveLength(1);
  });
});
