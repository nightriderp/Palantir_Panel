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

/** Öffentliche Seiten, die auch ohne Anmeldung erreichbar sind. */
const PUBLIC_PATHS: readonly string[] = [
  AUTH_ROUTES.login,
  AUTH_ROUTES.register,
  AUTH_ROUTES.pending,
];

/** Sitzungszustand, so weit ihn die Route-Sperre braucht. */
export interface GateState {
  /** Es besteht eine gültige Sitzung. */
  readonly authed: boolean;
  /** Konto ist angemeldet, aber noch nicht freigeschaltet (Gast). */
  readonly awaiting: boolean;
}

/**
 * Liest den Sitzungszustand aus der Antwort von `/auth/session`.
 *
 * Bewusst streng: Ein bloßer HTTP-200 genügt nicht – nur ein gültiger
 * Response-Envelope (`success === true` mit einem `account`) zählt als
 * angemeldet. Sonst würde etwa eine 200-Fehlerseite eines vorgelagerten Proxys
 * einen Fremden als eingeloggt markieren. `awaitingApproval` hängt am Konto
 * (`data.account`), nicht direkt an `data` – die Session-Route antwortet mit der
 * Hülle `ok({ account })` (Pflichtenheft §5.1, §7). Rein und ohne `fetch`, damit
 * vollständig testbar.
 */
export function sessionStateFromEnvelope(body: unknown): GateState {
  const envelope = body as {
    success?: boolean;
    data?: { account?: { awaitingApproval?: boolean } };
  } | null;

  if (envelope?.success !== true || !envelope.data?.account) {
    return { authed: false, awaiting: false };
  }

  return { authed: true, awaiting: Boolean(envelope.data.account.awaitingApproval) };
}

/**
 * Entscheidet, wohin eine Anfrage umgeleitet werden muss – oder `null`, wenn sie
 * bleiben darf. Die einzige Stelle mit dieser Logik; die Middleware ruft sie nur
 * auf. Bewusst rein und ohne `fetch`, damit sie vollständig testbar ist.
 *
 * Ohne Anmeldung ist nur der öffentliche Bereich erreichbar; jeder andere Pfad
 * (inklusive `/`) führt zur Anmeldung. Ein noch nicht freigeschaltetes Konto
 * gehört auf den Wartebildschirm und nirgends sonst hin. Ein freigeschaltetes
 * Konto wird von den Anmelde-/Warteseiten und der Wurzel auf die Übersicht
 * geführt, damit diese nach dem Login keine Sackgasse sind.
 */
export function gateRedirect(pathname: string, state: GateState): string | null {
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const isEntry = isPublic || pathname === '/';

  if (!state.authed) {
    return isPublic ? null : AUTH_ROUTES.login;
  }

  if (state.awaiting) {
    return pathname === AUTH_ROUTES.pending ? null : AUTH_ROUTES.pending;
  }

  return isEntry ? DASHBOARD_HOME : null;
}
