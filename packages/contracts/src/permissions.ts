/**
 * Permission-Katalog (Pflichtenheft §8).
 *
 * Permissions sind feste String-Konstanten. Rollen sind frei definierbare
 * Bündel daraus, ein Nutzer kann mehrere Rollen haben – die effektiven Rechte
 * sind die Vereinigung (berechnet im Backend-Modul `rbac`, nicht hier).
 *
 * Der Katalog ist wachsend und wird **additiv** ergänzt: neue Permission hier
 * eintragen und zusätzlich in Pflichtenheft §8 nachtragen (CLAUDE.md §8). Das
 * Entfernen oder Umbenennen einer bestehenden Permission ist ein Breaking
 * Change und im Commit/PR als solcher zu kennzeichnen (CLAUDE.md §3).
 *
 * Benennungsschema: `<bereich>.<vorgang>` bzw. `<bereich>.<vorgang>.<geltungsbereich>`,
 * alle Segmente lowerCamelCase, Geltungsbereich ausschließlich `own` oder `any`.
 */

/** Geltungsbereich einer Permission. */
export type PermissionScope =
  /** Wirkt nur auf eigene Ressourcen (bzw. solche, bei denen man Mitglied ist). */
  | 'own'
  /** Wirkt auf die Ressourcen aller Nutzer. */
  | 'any'
  /** Nicht ressourcenbezogen – gilt instanzweit. */
  | 'global';

export interface PermissionDefinition {
  /** Beschreibung für den Rollen-Editor (F10) – bewusst deutsch, wie die gesamte Oberfläche. */
  readonly description: string;
  readonly scope: PermissionScope;
}

/**
 * Vollständiger Katalog aus Pflichtenheft §8.
 *
 * Aufbau bewusst analog zum `ERROR_CATALOG`: der Schlüssel ist der Wert, der in
 * Datenbank und API steht; die Definition daneben ist reine Beschreibung.
 */
export const PERMISSION_CATALOG = {
  'server.create': {
    description: 'Eigene Gameserver erstellen.',
    scope: 'global',
  },
  'server.view.own': {
    description: 'Eigene Server und Server, bei denen man Mitglied ist, sehen.',
    scope: 'own',
  },
  'server.view.any': {
    description: 'Server aller Nutzer sehen.',
    scope: 'any',
  },
  'server.manage.own': {
    description:
      'Eigene Server starten, stoppen, neu starten, konfigurieren, klonen sowie Konsole, Dateien, Aufgaben und Mitglieder verwalten.',
    scope: 'own',
  },
  'server.manage.any': {
    description: 'Server aller Nutzer im selben Umfang verwalten.',
    scope: 'any',
  },
  'server.delete.own': {
    description: 'Eigene Server löschen.',
    scope: 'own',
  },
  'server.delete.any': {
    description: 'Server aller Nutzer löschen.',
    scope: 'any',
  },
  'backup.manage.own': {
    description: 'Backups eigener Server erstellen, wiederherstellen und löschen.',
    scope: 'own',
  },
  'backup.manage.any': {
    description: 'Backups aller Nutzer einsehen, wiederherstellen und löschen.',
    scope: 'any',
  },
  'user.manage': {
    description:
      'Nutzerkonten verwalten: freischalten, sperren, Rollen zuweisen, Kontingente setzen, Passwort zurücksetzen.',
    scope: 'global',
  },
  'role.manage': {
    description: 'Rollen anlegen, bearbeiten, löschen und deren Berechtigungen festlegen.',
    scope: 'global',
  },
  'notification.manage': {
    description: 'Benachrichtigungskanäle und -regeln verwalten.',
    scope: 'global',
  },
  'node.view': {
    description: 'Nodes mit Status und Auslastung einsehen.',
    scope: 'global',
  },
  'node.manage': {
    description: 'Nodes verwalten, inklusive Speicherverwaltung (Storage-Explorer).',
    scope: 'global',
  },
  'address.manage': {
    description: 'Öffentlichen Port-Bereich und Subdomain-/DNS-Einträge verwalten.',
    scope: 'global',
  },
  'audit.view': {
    description: 'Audit-Log einsehen.',
    scope: 'global',
  },
  /**
   * Getrennt von `audit.view` (WORK_STATUS.md, Gefundener Punkt 46).
   *
   * Der Archivierungslauf entfernt Einträge älter als 24 Monate aus dem Log,
   * nachdem er sie exportiert hat (Pflichtenheft §6). Das ist der einzige
   * Vorgang, der ein append-only Log überhaupt verkürzt – ihn an dieselbe
   * Permission zu hängen wie das bloße Lesen hieße, jedem Mitleser diesen
   * Eingriff mitzugeben.
   */
  'audit.manage': {
    description:
      'Audit-Log archivieren (Einträge nach Ablauf der Frist exportieren und entfernen).',
    scope: 'global',
  },
  'message.moderate': {
    description: 'Gemeldete Nachrichten einsehen und moderieren.',
    scope: 'global',
  },
  'gametype.manage': {
    description:
      'Spiele-Definitionen verwalten. In Version 1 ungenutzt – kein UI-Pfad davorgeschaltet (Pflichtenheft §8).',
    scope: 'global',
  },
} as const satisfies Record<string, PermissionDefinition>;

/** Alle gültigen Permissions als Typ – verhindert Freitext-Strings. */
export type Permission = keyof typeof PERMISSION_CATALOG;

/**
 * Alle Permissions zur Laufzeit.
 *
 * Bewusst als nicht-leeres Tupel typisiert, damit `@palantir/validation` die
 * Liste direkt an `z.enum()` übergeben kann.
 */
export const PERMISSIONS = Object.keys(PERMISSION_CATALOG) as [Permission, ...Permission[]];

/** Beschreibung zu einer Permission (Rollen-Editor). */
export function descriptionForPermission(permission: Permission): string {
  return PERMISSION_CATALOG[permission].description;
}

/** Geltungsbereich einer Permission. */
export function scopeForPermission(permission: Permission): PermissionScope {
  return PERMISSION_CATALOG[permission].scope;
}

/** Prüft, ob ein beliebiger String eine bekannte Permission ist. */
export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSION_CATALOG, value);
}

/** Basis eines `.own`/`.any`-Paares, aus dem Katalog abgeleitet. */
type ScopedBaseOf<TPermission extends string> = TPermission extends `${infer TBase}.own`
  ? TBase
  : never;

/**
 * Permission-Paare, die es in einer `own`- und einer `any`-Variante gibt.
 *
 * Wer `<basis>.any` hat, darf es bei jeder Ressource; wer nur `<basis>.own` hat,
 * ausschließlich bei eigenen. Die Auswertung dieser Regel liegt im Backend
 * (`hasScopedPermission`), damit sie an genau einer Stelle steht.
 */
export type ScopedPermissionBase = ScopedBaseOf<Permission>;

export const SCOPED_PERMISSION_BASES = [
  'server.view',
  'server.manage',
  'server.delete',
  'backup.manage',
] as const satisfies readonly ScopedPermissionBase[];

/**
 * Form eines serverseitig berechneten `permissions`-Objekts (Pflichtenheft §5.2).
 *
 * Jedes DTO trägt ein solches Objekt, damit die Berechtigungslogik ausschließlich
 * im Backend lebt und das Frontend nur Flags auswertet. Konkrete Ausprägungen
 * bringt das jeweilige DTO mit (z. B. `GameServerPermissions`); diese Hilfstypen
 * halten nur die gemeinsame Form fest.
 */
export type PermissionFlags<TFlag extends string> = { [K in TFlag]: boolean };

/** Ergänzt einen Datensatz um sein `permissions`-Objekt. */
export interface WithPermissions<TFlags extends object> {
  permissions: TFlags;
}

/**
 * Kontobezogenes `permissions`-Objekt (Pflichtenheft §5.2 und §8).
 *
 * Bildet die instanzweiten Rechte des angemeldeten Nutzers ab – also das, was
 * ohne Bezug zu einer einzelnen Ressource gilt (Navigation, Admin-Bereiche).
 * Wird vom Backend aus den effektiven Permissions berechnet und an den
 * Session-/Konto-DTO gehängt; das Frontend leitet nichts selbst aus Rollen ab.
 */
export interface GlobalPermissions {
  canCreateServer: boolean;
  /** Serverliste aller Nutzer sehen (Admin-Sicht). */
  canViewAnyServer: boolean;
  /** Backups aller Nutzer sehen und verwalten (globale Backup-Übersicht). */
  canManageAnyBackup: boolean;
  canManageUsers: boolean;
  canManageRoles: boolean;
  canManageNotifications: boolean;
  canViewNodes: boolean;
  canManageNodes: boolean;
  canManageAddresses: boolean;
  canViewAuditLog: boolean;
  canModerateMessages: boolean;
  /**
   * Wird bereits berechnet, hat in Version 1 aber keinen UI-Pfad: die
   * Admin-Spiele-Verwaltung (F11) ist durchgehend Platzhalter (Pflichtenheft §8).
   */
  canManageGameTypes: boolean;
}
