/**
 * DNS-Automatisierung über die Cloudflare-API (Pflichtenheft §13).
 *
 * Das Token ist laut Pflichtenheft §13 und `.env.example` auf **DNS-Bearbeitung
 * der Zone** beschränkt; dieser Client nutzt genau drei Endpunkte (auflisten,
 * anlegen, ändern, löschen) und nichts darüber hinaus.
 *
 * Umgesetzt mit `fetch` aus der Node-Standardbibliothek statt mit dem
 * offiziellen Cloudflare-SDK: Für vier Aufrufe rechtfertigt sich keine weitere
 * Abhängigkeit (CLAUDE.md §1).
 *
 * Jeder Fehler des Anbieters wird zu `DNS_UPDATE_FAILED` – der Katalog-Code aus
 * Pflichtenheft §5.1, kein Freitext (CLAUDE.md §5).
 */

import { ServerOrchestrationError } from '../errors.js';
import { type DnsProvider, type DnsRecord } from './types.js';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * TTL der Einträge in Sekunden.
 *
 * `1` bedeutet bei Cloudflare „automatisch" – passend, weil ein neu angelegter
 * Server sofort erreichbar sein soll und eine lange TTL das Umziehen einer
 * Subdomain unnötig zäh machen würde.
 */
const RECORD_TTL_SECONDS = 1;

export interface CloudflareDnsOptions {
  readonly apiToken: string;
  readonly zoneId: string;
  /** Nur für Tests: eigener `fetch`-Ersatz. */
  readonly fetchImpl?: typeof fetch;
  /** Abbruch nach dieser Zeit in Millisekunden. */
  readonly timeoutMs?: number;
}

interface CloudflareResponse<T> {
  readonly success: boolean;
  readonly errors: readonly { readonly code: number; readonly message: string }[];
  readonly result: T;
}

interface CloudflareRecord {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly content: string;
}

export function createCloudflareDnsProvider(options: CloudflareDnsOptions): DnsProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(`${CLOUDFLARE_API_BASE}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${options.apiToken}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      });

      // Der Antwortkörper wird auch bei Fehlerstatus gelesen: Cloudflare legt
      // die eigentliche Ursache dort ab, der HTTP-Status allein sagt zu wenig.
      const body = (await response.json()) as CloudflareResponse<T>;

      if (!response.ok || !body.success) {
        const reason =
          body.errors.map((error) => `${String(error.code)}: ${error.message}`).join(', ') ||
          `HTTP ${String(response.status)}`;

        throw new ServerOrchestrationError(
          'DNS_UPDATE_FAILED',
          `Cloudflare hat die Anfrage abgelehnt (${reason}).`,
          { path, status: response.status },
        );
      }

      return body.result;
    } catch (error: unknown) {
      if (error instanceof ServerOrchestrationError) {
        throw error;
      }

      const cause = error instanceof Error ? error.message : String(error);

      throw new ServerOrchestrationError(
        'DNS_UPDATE_FAILED',
        `Cloudflare war nicht erreichbar (${cause}).`,
        { path },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function findRecordId(name: string, type?: string): Promise<string | null> {
    const query = new URLSearchParams({ name });

    if (type !== undefined) {
      query.set('type', type);
    }

    const records = await call<CloudflareRecord[]>(
      `/zones/${options.zoneId}/dns_records?${query.toString()}`,
    );

    return records[0]?.id ?? null;
  }

  return {
    async upsertRecord(record: DnsRecord): Promise<string> {
      const payload = JSON.stringify({
        type: record.type,
        name: record.name,
        content: record.content,
        ttl: RECORD_TTL_SECONDS,
        // Spiele-Subdomains müssen auf "DNS only" stehen (Pflichtenheft §13):
        // Cloudflares Standardprodukt proxied kein rohes TCP/UDP.
        proxied: record.proxied,
      });

      const existingId = await findRecordId(record.name, record.type);

      if (existingId !== null) {
        const updated = await call<CloudflareRecord>(
          `/zones/${options.zoneId}/dns_records/${existingId}`,
          { method: 'PUT', body: payload },
        );

        return updated.id;
      }

      const created = await call<CloudflareRecord>(`/zones/${options.zoneId}/dns_records`, {
        method: 'POST',
        body: payload,
      });

      return created.id;
    },

    async deleteRecord(name: string): Promise<void> {
      const existingId = await findRecordId(name);

      if (existingId === null) {
        // Bereits weg – kein Fehler (siehe Schnittstellenbeschreibung).
        return;
      }

      await call<{ readonly id: string }>(`/zones/${options.zoneId}/dns_records/${existingId}`, {
        method: 'DELETE',
      });
    },
  };
}

/**
 * Baut den DNS-Eintrag eines Servers (Pflichtenheft §13).
 *
 * - Spiele mit Hostname-Routing (initial Minecraft): `CNAME` auf den Proxy –
 *   ein öffentlicher Port für alle Instanzen, der Spieler sieht keinen Port.
 * - Alle anderen: `A` auf die öffentliche IPv4 der VPS, der Port bleibt für
 *   den Spieler sichtbar.
 */
export function buildServerDnsRecord(input: {
  readonly hostname: string;
  readonly supportsVirtualHostRouting: boolean;
  readonly publicIpv4: string;
  readonly virtualHostProxyHostname: string | null;
}): DnsRecord {
  if (input.supportsVirtualHostRouting && input.virtualHostProxyHostname !== null) {
    return {
      name: input.hostname,
      type: 'CNAME',
      content: input.virtualHostProxyHostname,
      proxied: false,
    };
  }

  return {
    name: input.hostname,
    type: 'A',
    content: input.publicIpv4,
    proxied: false,
  };
}
