/**
 * Rollen-DTO (Pflichtenheft §5.2, §6 und §8).
 *
 * Rollen sind frei definierbare Bündel von Permissions. Ein Nutzer kann mehrere
 * Rollen haben; die effektiven Rechte sind die Vereinigung. Der Owner
 * (`User.isOwner`) steht außerhalb des Rollensystems und hat immer alle
 * Permissions.
 *
 * **Feldbenennung (bewusste Abweichung, CLAUDE.md §8):** Pflichtenheft §6 nennt
 * das Permission-Bündel der Entität `permissions`. Im DTO ist `permissions`
 * jedoch durchgängig für das serverseitig berechnete Flags-Objekt aus §5.2
 * reserviert – über alle DTOs hinweg gleich, damit das Frontend sich darauf
 * verlassen kann. Das Bündel heißt im DTO deshalb `grantedPermissions`; die
 * Datenbankspalte bleibt `permissions` wie in §6.
 */

import { type Permission } from './permissions.js';

/**
 * Was der aufrufende Nutzer mit dieser Rolle tun darf (Pflichtenheft §5.2).
 *
 * Bei der geschützten Systemrolle „Gast" sind `canEdit` und `canDelete` immer
 * `false` – auch für den Owner (Schutz vor Selbst-Aussperrung, Pflichtenheft §8).
 */
export interface RolePermissions {
  canView: boolean;
  /** Name, Beschreibung und Permission-Bündel ändern. */
  canEdit: boolean;
  canDelete: boolean;
  /** Rolle Nutzern zuweisen oder entziehen. */
  canAssign: boolean;
}

/** Rolle (Pflichtenheft §6, Entität `Role`). */
export interface RoleDto {
  id: string;
  name: string;
  /** Freitext-Beschreibung für die Admin-Oberfläche; `null`, wenn nicht gesetzt. */
  description: string | null;
  /** Das Permission-Bündel der Rolle (Entitätsfeld `permissions` aus §6). */
  grantedPermissions: Permission[];
  /**
   * Geschützte Systemrolle: weder editier- noch löschbar (Pflichtenheft §8).
   * In Version 1 trifft das ausschließlich auf die Rolle „Gast" zu.
   */
  isProtected: boolean;
  /** Anzahl Nutzer mit dieser Rolle – für die Rollenübersicht in F10. */
  memberCount: number;
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
  permissions: RolePermissions;
}

/**
 * Name der geschützten Systemrolle, die jedes neu registrierte Konto erhält
 * (Lastenheft §2, Pflichtenheft §7 und §8).
 *
 * Der Name ist Teil des Vertrags, weil die Rollenverwaltung (F10) ihn nicht
 * zum Umbenennen anbietet und die Oberfläche ihn benennen können muss.
 *
 * **Nicht** zur Erkennung des Wartezustands verwenden: ob ein Konto noch auf
 * Freischaltung wartet, sagt das Backend über `AccountDto.awaitingApproval`
 * (`auth.ts`). Ein Rückschluss aus dem Rollennamen wäre eine Rechteableitung im
 * Frontend (Pflichtenheft §5.2, CLAUDE.md §3).
 */
export const GUEST_ROLE_NAME = 'Gast';
