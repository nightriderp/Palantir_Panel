/**
 * Subdomain-Prüfung beim Anlegen und Klonen eines Servers
 * (Lastenheft §3.3, Pflichtenheft §13).
 *
 * Format und Sperrliste prüft **immer** das Backend; der Wizard zeigt nur das
 * Ergebnis an. Das gemeinsame Format-Schema steht als `subdomainSchema` in
 * `@palantir/validation`, damit die Sofortrückmeldung im Formular und die
 * verbindliche Prüfung im Backend dieselbe Regel verwenden.
 */

/** Warum eine Subdomain nicht verwendbar ist. */
export const SUBDOMAIN_REJECTION_REASONS = ['invalid', 'reserved', 'taken'] as const;

export type SubdomainRejectionReason = (typeof SUBDOMAIN_REJECTION_REASONS)[number];

export interface SubdomainAvailabilityDto {
  /** Der geprüfte Name, kleingeschrieben und ohne die Basis-Domain. */
  subdomain: string;
  available: boolean;
  /** Grund der Ablehnung; `null`, wenn verfügbar. */
  reason: SubdomainRejectionReason | null;
  /** Deutscher Anzeigetext zum Ergebnis (Lastenheft §4). */
  message: string;
  /** Vollständige Adresse, die entstehen würde, z. B. `welt.example.tld`. */
  fullHostname: string;
}

/**
 * Gesperrte Subdomains (Pflichtenheft §13).
 *
 * Die Liste steht hier statt im Backend, weil Wizard und Backend dieselbe
 * Sperrliste brauchen – der Wizard, um sofort zurückzumelden, das Backend als
 * verbindliche Prüfung. Ergänzungen sind additiv.
 */
export const RESERVED_SUBDOMAINS = [
  'www',
  'api',
  'admin',
  'vpn',
  'mail',
  'panel',
  'agent',
  'node',
  'status',
  'static',
  'cdn',
  'ns1',
  'ns2',
] as const;

export type ReservedSubdomain = (typeof RESERVED_SUBDOMAINS)[number];

export function isReservedSubdomain(value: string): boolean {
  return (RESERVED_SUBDOMAINS as readonly string[]).includes(value.toLowerCase());
}

// ---------------------------------------------------------------------------
// Formatregel (ergänzt in B3)
// ---------------------------------------------------------------------------
// Die Liste oben sagt, welche Namen gesperrt sind; hier steht, welche Form ein
// Name überhaupt haben darf. Beides gehört in die Contracts, weil der Wizard
// (F3) schon während der Eingabe prüft und das Backend beim Anlegen und beim
// Klonen erneut – zwei getrennte Regelsätze liefen zwangsläufig auseinander.

/** Kleinste zulässige Länge eines Subdomain-Labels. */
export const SUBDOMAIN_MIN_LENGTH = 3;

/**
 * Größte zulässige Länge.
 *
 * 63 ist die Obergrenze eines DNS-Labels (RFC 1035); enger wird bewusst nicht
 * eingeschränkt, damit die Regel technisch begründbar bleibt.
 */
export const SUBDOMAIN_MAX_LENGTH = 63;

/**
 * Kleinbuchstaben, Ziffern und Bindestriche, weder am Anfang noch am Ende ein
 * Bindestrich.
 *
 * Bewusst ohne Punkt: Es wird genau **ein** Label unterhalb von
 * `PALANTIR_DOMAIN` vergeben, keine verschachtelte Subdomain.
 */
export const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Prüft nur die Form – Sperrliste und Verfügbarkeit stehen getrennt davon. */
export function hasValidSubdomainFormat(value: string): boolean {
  return (
    value.length >= SUBDOMAIN_MIN_LENGTH &&
    value.length <= SUBDOMAIN_MAX_LENGTH &&
    SUBDOMAIN_PATTERN.test(value)
  );
}

/**
 * Vollständiger Hostname eines Servers (Pflichtenheft §13).
 *
 * Getrennte Funktion, damit Backend (DNS-Eintrag, DTO) und Frontend (Anzeige)
 * denselben Namen bilden.
 */
export function buildServerHostname(subdomain: string, baseDomain: string): string {
  return `${subdomain}.${baseDomain}`;
}
