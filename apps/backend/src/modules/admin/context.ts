/**
 * Aufrufkontext der Admin-Dienste.
 *
 * Der {@link PermissionActor} aus B2 trägt die effektiven Rechte, aber bewusst
 * keine Identität – für die Rechteberechnung braucht er sie nicht. Das
 * Audit-Log braucht sie sehr wohl: Ein Eintrag ohne Handelnden wäre für die
 * Nachvollziehbarkeit wertlos (Pflichtenheft §6).
 *
 * Deshalb reichen die Dienste dieses Moduls einen {@link AdminContext} durch:
 * Rechte plus Identität plus grobe Herkunft des Requests. Zusammengebaut wird
 * er an genau einer Stelle – in `routes.ts` aus dem Fastify-Request.
 */

import type { PermissionActor } from '../rbac/index.js';

export interface AdminContext {
  /** Effektive Rechte des Aufrufers (B2). */
  readonly actor: PermissionActor;
  /**
   * Konto des Aufrufers. `null` bei Aufrufen ohne Sitzung – etwa aus den
   * Wartungs-Kommandos auf der VPS, die bereits Systemzugang voraussetzen.
   */
  readonly userId: string | null;
  /** Anzeigename zum Zeitpunkt der Aktion; wird als Kopie im Log festgehalten. */
  readonly displayName: string | null;
  /** Grobe Herkunft des Requests, analog zu `Session.ipHint` (Pflichtenheft §6). */
  readonly ipHint: string | null;
}

/**
 * Kontext ohne Identität – für Tests und für Aufrufe außerhalb des HTTP-Pfads.
 */
export function contextOf(actor: PermissionActor, identity?: Partial<AdminContext>): AdminContext {
  return {
    actor,
    userId: identity?.userId ?? null,
    displayName: identity?.displayName ?? null,
    ipHint: identity?.ipHint ?? null,
  };
}
