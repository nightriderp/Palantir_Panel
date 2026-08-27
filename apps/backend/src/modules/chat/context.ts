/**
 * Aufrufkontext der Chat-Dienste.
 *
 * Aufbau bewusst analog zum `AdminContext` aus B8: Der {@link PermissionActor}
 * aus B2 trägt die Rechte, aber keine Identität – der Chat braucht beides. Die
 * Identität ist hier sogar die wichtigere Hälfte: Sichtbarkeit hängt an der
 * Teilnahme, nicht an einer Permission.
 *
 * `userId` ist deshalb `string | null` und **nicht** optional weggelassen: Ein
 * Aufruf ohne angemeldetes Konto sieht keine einzige Konversation. Es gibt hier
 * bewusst keinen „System"-Kontext, der das umginge (CLAUDE.md §2).
 */

import { type PermissionActor } from '../rbac/index.js';
import { ChatError } from './errors.js';

export interface ChatContext {
  readonly actor: PermissionActor;
  /** Konto des Aufrufers; `null`, wenn niemand angemeldet ist. */
  readonly userId: string | null;
  /** Anzeigename zum Zeitpunkt der Aktion – Kopie für den Audit-Eintrag. */
  readonly displayName: string | null;
  /** Grobe Herkunft des Requests (Pflichtenheft §6, `Session.ipHint`). */
  readonly ipHint: string | null;
}

export function contextOf(actor: PermissionActor, identity?: Partial<ChatContext>): ChatContext {
  return {
    actor,
    userId: identity?.userId ?? null,
    displayName: identity?.displayName ?? null,
    ipHint: identity?.ipHint ?? null,
  };
}

/**
 * Liefert das Konto des Aufrufers oder bricht mit `AUTH_REQUIRED` ab.
 *
 * Jeder Vorgang des Chats setzt ein angemeldetes Konto voraus – auch das reine
 * Lesen.
 */
export function requireUserId(ctx: ChatContext): string {
  if (ctx.userId === null) {
    throw new ChatError('AUTH_REQUIRED');
  }

  return ctx.userId;
}
