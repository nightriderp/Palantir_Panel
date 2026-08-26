/**
 * Schnittstelle zur DNS-Automatisierung (Pflichtenheft §13).
 *
 * Bewusst eine eigene, schmale Schnittstelle statt direkter Aufrufe der
 * Cloudflare-API im Dienst – aus denselben Gründen, aus denen der Agent nur
 * über `ContainerRuntime` mit Docker spricht (Pflichtenheft §2.5): Der
 * Lifecycle ist ohne Netzzugriff testbar, und ein Wechsel des DNS-Anbieters
 * berührt genau eine Datei.
 */

/**
 * Eintragstyp.
 *
 * `A` zeigt auf die öffentliche IPv4 der VPS (Spiele mit sichtbarem Port),
 * `CNAME` auf den Hostname-Routing-Proxy (Spiele mit
 * `supportsVirtualHostRouting`, initial Minecraft).
 */
export type DnsRecordType = 'A' | 'CNAME';

export interface DnsRecord {
  /** Vollständiger Hostname, z. B. `meinserver.example.tld`. */
  readonly name: string;
  readonly type: DnsRecordType;
  /** IPv4 bei `A`, Zielhostname bei `CNAME`. */
  readonly content: string;
  /**
   * Immer `false` für Spiele-Subdomains: Cloudflares Standardprodukt proxied
   * kein rohes TCP/UDP-Spieleprotokoll (Pflichtenheft §13 – „DNS only").
   */
  readonly proxied: boolean;
}

export interface DnsProvider {
  /**
   * Legt den Eintrag an oder aktualisiert ihn, wenn er schon existiert.
   *
   * Bewusst idempotent: Ein zweiter Anlauf nach einem abgebrochenen Vorgang
   * soll keinen doppelten Eintrag hinterlassen.
   *
   * @returns die Kennung des Eintrags beim Anbieter, für spätere Löschung
   */
  upsertRecord(record: DnsRecord): Promise<string>;

  /**
   * Entfernt den Eintrag zum Hostnamen.
   *
   * Ein bereits fehlender Eintrag ist **kein** Fehler: Beim Löschen eines
   * Servers soll ein von Hand entfernter DNS-Eintrag den Vorgang nicht
   * blockieren.
   */
  deleteRecord(name: string): Promise<void>;
}

/**
 * DNS-Anbieter, der nichts tut.
 *
 * Greift, solange `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID` nicht gesetzt
 * sind – also in Entwicklung und in Tests. Bewusst kein stiller Fehlschlag,
 * sondern eine ausdrückliche Variante: Ein Backend, das ohne Cloudflare-Zugang
 * gar nicht startete, wäre lokal nicht benutzbar; ein Backend, das den
 * fehlenden Zugang verschweigt, wäre in Produktion gefährlich. Deshalb
 * protokolliert diese Variante jeden übersprungenen Vorgang.
 */
export function createNoopDnsProvider(
  log: (message: string, details: Record<string, unknown>) => void,
): DnsProvider {
  return {
    upsertRecord(record: DnsRecord): Promise<string> {
      log('DNS-Eintrag übersprungen (kein Cloudflare-Zugang konfiguriert)', { record });

      return Promise.resolve(`noop:${record.name}`);
    },
    deleteRecord(name: string): Promise<void> {
      log('DNS-Löschung übersprungen (kein Cloudflare-Zugang konfiguriert)', { name });

      return Promise.resolve();
    },
  };
}
