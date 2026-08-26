import { type AccountDto } from '@palantir/contracts';

/**
 * Zielrouten rund um die Anmeldung.
 *
 * Wohin es nach einer erfolgreichen Anmeldung geht, hängt ausschließlich an
 * Feldern, die das Backend setzt (`banned`, `awaitingApproval`) – das Frontend
 * leitet nichts aus Rollen oder Permissions her (Pflichtenheft §5.2).
 */

export const AUTH_ROUTES = {
  login: '/login',
  register: '/register',
  /** Gast-Wartebildschirm: registriert, aber noch nicht freigeschaltet. */
  pending: '/pending',
} as const;

/** Startseite nach der Anmeldung für freigeschaltete Konten. */
export const DASHBOARD_HOME = '/servers';

/**
 * Wohin ein angemeldetes Konto gehört.
 *
 * Ein gesperrtes Konto hat gar keine Sitzung – kommt es trotzdem hier an (etwa
 * weil die Sperre während einer laufenden Sitzung gesetzt wurde), führt der Weg
 * zurück zur Anmeldung, wo die Sperre als Fehlerzustand erklärt wird.
 */
export function landingPathForAccount(account: AccountDto): string {
  if (account.banned) {
    return AUTH_ROUTES.login;
  }
  if (account.awaitingApproval) {
    return AUTH_ROUTES.pending;
  }
  return DASHBOARD_HOME;
}

/**
 * Darf dieses Konto den Gast-Wartebildschirm sehen?
 *
 * Freigeschaltete Konten werden von dort weitergeleitet, damit die Ansicht nach
 * der Freischaltung nicht als Sackgasse stehen bleibt.
 */
export function belongsOnPendingScreen(account: AccountDto): boolean {
  return !account.banned && account.awaitingApproval;
}
