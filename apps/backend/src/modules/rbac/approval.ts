/**
 * Freischaltregel eines Kontos (Lastenheft §3.1 und §3.6) – an genau einer Stelle.
 *
 * „Freigeschaltet" heißt: nicht gesperrt und mindestens eine Rolle jenseits der
 * geschützten Systemrolle „Gast". Der **Owner** steht außerhalb des
 * Rollensystems (Lastenheft §2) und wartet deshalb nie auf eine Freigabe – auch
 * dann nicht, wenn er keine weitere Rolle trägt.
 *
 * Die Regel lag zuvor in drei Modulen getrennt (Audit W2-2,
 * `backend-community-06`): B1 (`isAwaitingApproval` für das Konto-DTO), B8
 * (`statusOf` für die Warteliste) und B7 (Chat, in SQL nachgebaut **ohne**
 * `isOwner`). Dadurch galt der Owner im Chat als nicht freigeschaltet: Er fehlte
 * im DM-Verzeichnis, und niemand konnte ihm schreiben. Sie steht jetzt hier in
 * B2, weil B1, B7 und B8 dieses Modul ohnehin alle nutzen und es selbst keines
 * von ihnen kennt.
 */

import { GUEST_ROLE_NAME } from '@palantir/contracts';

/** Ein Konto, so weit die Freischaltregel es kennen muss. */
export interface ApprovalStanding {
  readonly isOwner: boolean;
  readonly banned: boolean;
  /** Trägt das Konto mindestens eine Rolle außer der Systemrolle „Gast"? */
  readonly hasNonGuestRole: boolean;
}

/**
 * Trägt die Rollenliste eine Rolle jenseits von „Gast"?
 *
 * Als eigene Funktion, damit Aufrufer mit einer Rollenliste (B1, B8, der
 * `PermissionActor` in B2) und Aufrufer mit einem SQL-Ergebnis (B7) dieselbe
 * Regel füttern, ohne den Rollennamen erneut zu kennen. Der Name ist optional,
 * weil die Rechteberechnung (`RoleGrant`) ihn nicht braucht: Eine Rolle ohne
 * Namen zählt wie eine, die nicht „Gast" heißt.
 */
export function hasNonGuestRole(roles: readonly { readonly name?: string }[]): boolean {
  return roles.some((role) => role.name !== GUEST_ROLE_NAME);
}

/**
 * Wartet das Konto noch auf die Freischaltung durch einen Admin?
 *
 * Die Sperre bleibt hier bewusst außen vor: Ein gesperrtes Konto *wartet* nicht,
 * es ist gesperrt. Wer beides unterscheidet (B8, `statusOf()`), prüft die Sperre
 * zuerst; wer nur „darf mitmachen" wissen will, nimmt {@link isApproved}.
 */
export function isAwaitingApproval(user: Omit<ApprovalStanding, 'banned'>): boolean {
  return !user.isOwner && !user.hasNonGuestRole;
}

/** Freigeschaltet im Sinne von Lastenheft §3.6: freigegeben **und** nicht gesperrt. */
export function isApproved(user: ApprovalStanding): boolean {
  return !user.banned && !isAwaitingApproval(user);
}
