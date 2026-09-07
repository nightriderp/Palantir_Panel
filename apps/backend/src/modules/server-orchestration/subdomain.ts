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
 *
 * **Offen (Audit contracts-validation-05):** Die Contracts führen mit
 * `hasValidSubdomainFormat`/`SUBDOMAIN_MAX_LENGTH` eine zweite, weitere
 * Formatregel (63 statt 30 Zeichen), die niemand aufruft. Wirksam ist allein
 * `subdomainSchema`. Das Zusammenlegen ändert `packages/contracts` **und**
 * `packages/validation` und gehört deshalb in einen eigenen, kleinen
 * Contracts-PR (CLAUDE.md §6) – nicht hierher.
 */

import {
  type SubdomainAvailabilityDto,
  buildServerHostname,
  isReservedSubdomain,
} from '@palantir/contracts';
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
 *
 * Liefert seit Audit contract-drift-04 den Vertragstyp
 * {@link SubdomainAvailabilityDto} statt einer eigenen, hier definierten Form.
 * Der lokale Typ kannte weder `fullHostname` noch den Grund `reserved`; das
 * Frontend typisierte die Antwort aber längst als DTO und füllte `fullHostname`
 * von Hand mit `''`. Zwei Formen für dieselbe Antwort – genau die
 * Parallelstruktur, die CLAUDE.md §3 ausschließt.
 *
 * @param baseDomain `PALANTIR_DOMAIN` – nur für `fullHostname`; die Adresse
 *   entsteht mit `buildServerHostname()` aus den Contracts, damit Wizard,
 *   DNS-Eintrag und DTO denselben Namen bilden.
 */
export async function checkSubdomain(
  input: string,
  check: SubdomainAvailabilityCheck,
  baseDomain: string,
  excludeServerId?: string,
): Promise<SubdomainAvailabilityDto> {
  const parsed = subdomainSchema.safeParse(input);
  /*
   * Auch eine abgelehnte Eingabe bekommt einen normalisierten Namen und damit
   * eine Adresse: Der Wizard zeigt an, was entstünde – bei einem gesperrten
   * Namen ist gerade das die Erklärung.
   */
  const subdomain = parsed.success ? parsed.data : input.trim().toLowerCase();
  const fullHostname = buildServerHostname(subdomain, baseDomain);

  if (!parsed.success) {
    return {
      subdomain,
      available: false,
      // Ein reservierter Name hat ein gültiges Format – er ist nicht falsch
      // geschrieben, sondern nicht wählbar. Der Vertrag unterscheidet das.
      reason: isReservedSubdomain(subdomain) ? 'reserved' : 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Die Subdomain ist ungültig.',
      fullHostname,
    };
  }

  if (await check.isSubdomainTaken(subdomain, excludeServerId)) {
    return {
      subdomain,
      available: false,
      reason: 'taken',
      message: 'Diese Subdomain ist bereits vergeben.',
      fullHostname,
    };
  }

  return {
    subdomain,
    available: true,
    reason: null,
    message: `${fullHostname} ist frei.`,
    fullHostname,
  };
}
