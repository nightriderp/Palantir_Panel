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
