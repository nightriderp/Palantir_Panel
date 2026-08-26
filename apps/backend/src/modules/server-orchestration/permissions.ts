/**
 * Das `permissions`-Objekt eines Gameservers (Pflichtenheft §5.2, §8).
 *
 * Baut auf `computePermissionFlags()` aus dem RBAC-Modul (B2) auf – keine
 * zweite Rechteberechnung (CLAUDE.md §3, WORK_STATUS „Gefundene Punkte" Nr. 12).
 *
 * Zwei Achsen greifen ineinander:
 *
 * 1. **Rollen** (Pflichtenheft §8) entscheiden, *ob* jemand Server verwalten
 *    darf – `server.manage.own` bzw. `.any`.
 * 2. **Mitgliedsstufe** (`ServerMember`, Lastenheft §3.3) entscheidet, bei
 *    welchen *fremden* Servern jemand als „eigen" gilt und wie weit er dort
 *    gehen darf.
 *
 * Daraus folgt die Regel, die diese Datei umsetzt: `isOwn` ist wahr für den
 * Besitzer **und** für eingetragene Mitglieder. Die Mitgliedsstufe begrenzt
 * danach zusätzlich, was das konkret heißt – ein `viewer` mit
 * `server.manage.own` darf trotzdem nicht starten. Ohne diese zweite Schranke
 * wäre die Mitgliedsstufe wirkungslos.
 *
 * Löschen und Mitgliederverwaltung bleiben bewusst beim Besitzer (bzw. bei
 * `.any`): Ein Mitglied soll sich nicht selbst zum Besitzer machen oder den
 * Server unter dem Besitzer wegräumen können.
 */

import {
  type GameServerPermissions,
  type ServerMemberLevel,
  type ServerStatus,
  serverMemberLevelAtLeast,
} from '@palantir/contracts';
import { type PermissionActor, computePermissionFlags } from '../rbac/index.js';

export interface ServerPermissionContext {
  readonly ownerId: string;
  readonly status: ServerStatus;
  /** Konto des Aufrufers; `null`, wenn niemand angemeldet ist. */
  readonly viewerId: string | null;
  /** Mitgliedsstufe des Aufrufers; `null`, wenn er nicht Mitglied ist. */
  readonly viewerMemberLevel: ServerMemberLevel | null;
}

/**
 * Darf der Aufrufer eine Aktion ausführen, die mindestens die Stufe `required`
 * verlangt?
 *
 * Die Reihenfolge der drei Wege ist die eigentliche Regel:
 *
 * 1. `server.manage.any` – verwaltet **jeden** Server. Die Mitgliedsstufe
 *    greift hier bewusst nicht: Wer Server aller Nutzer verwalten darf, ist
 *    kein Mitglied, sondern Administrator; ihn an einer Mitgliedschaft zu
 *    messen, die er nie hat, würde die Permission wirkungslos machen.
 * 2. Besitzer mit `server.manage.own` – darf bei seinem Server alles.
 * 3. Mitglied mit `server.manage.own` – darf so weit, wie seine Stufe reicht.
 *
 * Wer keinen dieser Wege hat, darf nicht.
 */
function canActAtLevel(
  actor: PermissionActor,
  context: ServerPermissionContext,
  isOwner: boolean,
  required: ServerMemberLevel,
): boolean {
  if (actor.permissions.has('server.manage.any')) {
    return true;
  }

  if (!actor.permissions.has('server.manage.own')) {
    return false;
  }

  if (isOwner) {
    return true;
  }

  if (context.viewerMemberLevel === null) {
    return false;
  }

  return serverMemberLevelAtLeast(context.viewerMemberLevel, required);
}

/**
 * Berechnet das `permissions`-Objekt eines Servers.
 *
 * Zustandsabhängige Flags (`canStart`, `canStop`, `canRestart`) bilden
 * **ausschließlich** die Berechtigung ab, nicht den Lifecycle. Ob ein Start im
 * aktuellen Zustand zulässig ist, entscheidet die State Machine – stünde es
 * auch hier, gäbe es zwei Auslegungen von Pflichtenheft §9, die auseinanderlaufen
 * können.
 */
export function computeGameServerPermissions(
  actor: PermissionActor,
  context: ServerPermissionContext,
): GameServerPermissions {
  const isOwner = context.viewerId !== null && context.viewerId === context.ownerId;
  const isMember = context.viewerMemberLevel !== null;
  /** „Eigen" im Sinne von `.own` – Besitzer oder eingetragenes Mitglied. */
  const isOwn = isOwner || isMember;

  const canOperate = canActAtLevel(actor, context, isOwner, 'operator');
  const canManage = canActAtLevel(actor, context, isOwner, 'manager');

  return computePermissionFlags<keyof GameServerPermissions>(actor, {
    canView: { scope: 'server.view', isOwn },
    canViewAddress: { scope: 'server.view', isOwn },
    canStart: canOperate,
    canStop: canOperate,
    canRestart: canOperate,
    canUseConsole: canOperate,
    canManageSettings: canManage,
    canManageFiles: canManage,
    canManageSchedules: canManage,
    canManageBackups: canManage && hasBackupScope(actor, isOwn),
    // Klonen erzeugt einen neuen eigenen Server – wer den Server verwalten und
    // überhaupt Server anlegen darf, darf ihn auch klonen.
    canClone: canManage && actor.permissions.has('server.create'),
    // Löschen und Mitgliederverwaltung bleiben beim Besitzer bzw. bei `.any`.
    canDelete: isOwner
      ? actor.permissions.has('server.delete.own') || actor.permissions.has('server.delete.any')
      : actor.permissions.has('server.delete.any'),
    canManageMembers: isOwner
      ? actor.permissions.has('server.manage.own') || actor.permissions.has('server.manage.any')
      : actor.permissions.has('server.manage.any'),
  });
}

function hasBackupScope(actor: PermissionActor, isOwn: boolean): boolean {
  if (actor.permissions.has('backup.manage.any')) {
    return true;
  }

  return isOwn && actor.permissions.has('backup.manage.own');
}
