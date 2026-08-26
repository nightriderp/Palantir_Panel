/**
 * Vergabe von Subdomains (Pflichtenheft §13, Lastenheft §3.3).
 *
 * Drei Prüfungen in fester Reihenfolge:
 *
 * 1. **Format** – `subdomainSchema` aus `@palantir/validation`; dasselbe Schema
 *    benutzt der Wizard im Frontend (F3), damit es nur eine Regel gibt.
 * 2. **Sperrliste** – ebenfalls im Schema, aus `RESERVED_SUBDOMAINS`.
 * 3. **Verfügbarkeit** – gegen die Datenbank; das kann nur das Backend.
 *
 * Die Reihenfolge ist Absicht: Ein Formatfehler soll nicht als „belegt"
 * gemeldet werden, und eine Datenbankabfrage soll nicht für offensichtlich
 * ungültige Eingaben laufen.
 *
 * Der DNS-Eintrag entsteht erst danach und liegt in `dns/` – ein reservierter
 * Name ohne DNS-Eintrag ist harmlos, ein DNS-Eintrag ohne Datensatz nicht.
 */

import { subdomainSchema } from '@palantir/validation';
import { ServerOrchestrationError } from './errors.js';

/** Was der Dienst braucht, um die Verfügbarkeit zu prüfen. */
export interface SubdomainAvailabilityCheck {
  /**
   * `true`, wenn die Subdomain bereits vergeben ist.
   *
   * @param excludeServerId Server, der beim Vergleich übersprungen wird – nötig
   *   beim Umbenennen, damit ein Server nicht mit sich selbst kollidiert.
   */
  isSubdomainTaken(subdomain: string, excludeServerId?: string): Promise<boolean>;
}

/**
 * Normalisiert und prüft Format sowie Sperrliste.
 *
 * Wirft `SUBDOMAIN_INVALID` – bewusst nicht `SUBDOMAIN_TAKEN`: Ein reservierter
 * Name ist nicht „vergeben", sondern nicht wählbar, und die Meldung im Schema
 * sagt genau das.
 */
export function normalizeSubdomain(input: string): string {
  const parsed = subdomainSchema.safeParse(input);

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;

    throw new ServerOrchestrationError('SUBDOMAIN_INVALID', message, { input });
  }

  return parsed.data;
}

/**
 * Vollständige Prüfung inklusive Verfügbarkeit.
 *
 * @returns die normalisierte Subdomain (klein geschrieben, getrimmt)
 */
export async function resolveAvailableSubdomain(
  input: string,
  check: SubdomainAvailabilityCheck,
  excludeServerId?: string,
): Promise<string> {
  const subdomain = normalizeSubdomain(input);

  if (await check.isSubdomainTaken(subdomain, excludeServerId)) {
    throw new ServerOrchestrationError('SUBDOMAIN_TAKEN', undefined, { subdomain });
  }

  return subdomain;
}

/**
 * Prüft eine Subdomain, ohne einen Fehler zu werfen – für die
 * Verfügbarkeitsanzeige im Wizard, die noch während der Eingabe fragt.
 */
export async function checkSubdomain(
  input: string,
  check: SubdomainAvailabilityCheck,
  excludeServerId?: string,
): Promise<SubdomainCheckResult> {
  const parsed = subdomainSchema.safeParse(input);

  if (!parsed.success) {
    return {
      available: false,
      subdomain: input,
      reason: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Die Subdomain ist ungültig.',
    };
  }

  if (await check.isSubdomainTaken(parsed.data, excludeServerId)) {
    return {
      available: false,
      subdomain: parsed.data,
      reason: 'taken',
      message: 'Diese Subdomain ist bereits vergeben.',
    };
  }

  return { available: true, subdomain: parsed.data, reason: null, message: null };
}

export interface SubdomainCheckResult {
  readonly available: boolean;
  /** Die normalisierte Eingabe, soweit sie sich normalisieren ließ. */
  readonly subdomain: string;
  readonly reason: 'invalid' | 'taken' | null;
  readonly message: string | null;
}
