/**
 * Quelladressen-Allowlist des Agent-Kanals `/agent` (Fundpunkt 121, W0-2).
 *
 * Der Agent erreicht das Backend ausschließlich durch den WireGuard-Tunnel
 * (Pflichtenheft §2.1, §2.2). Dass der Kanal nicht trotzdem aus dem Internet
 * erreichbar ist, sichert zuerst das Deployment: Traefik lässt `/agent` aus,
 * der Host-Port hängt an der Tunnel-Adresse (`deploy/vps/docker-compose.yml`).
 * Diese Datei ist die zweite Schicht dahinter: Das Backend prüft selbst, ob die
 * Gegenstelle aus dem Tunnelnetz kommt. Fehlt das Traefik-Label oder bindet
 * der Port an `0.0.0.0`, bleibt dann immer noch mehr als nur das
 * Pre-Shared-Token als Hürde.
 *
 * Bewusst ohne Bibliothek (CLAUDE.md §1): IPv4-Netze in CIDR-Schreibweise und
 * einzelne Adressen sind alles, was der Betrieb braucht. IPv6 wird trotzdem
 * verstanden – ein Backend, das auf `::` lauscht, sieht die Gegenstelle als
 * `::ffff:10.10.0.2`, und die muss dieselbe Liste treffen wie `10.10.0.2`.
 *
 * Reine Funktionen ohne Fastify, damit die Prüfung für sich getestet werden
 * kann (CLAUDE.md §4: Tests für Auth-nahe Logik).
 */

/** Eine Adresse als Zahl; `bits` unterscheidet IPv4 (32) von IPv6 (128). */
interface ParsedAddress {
  readonly bits: 32 | 128;
  readonly value: bigint;
}

export interface SourceAllowlistEntry {
  /** Ursprüngliche Schreibweise – für Fehlermeldungen und Protokoll. */
  readonly text: string;
  readonly bits: 32 | 128;
  /** Netzanteil, bereits um die Host-Bits gekürzt (`value >> (bits - prefixLength)`). */
  readonly network: bigint;
  readonly prefixLength: number;
}

/** Leere Liste = keine Prüfung (siehe {@link isSourceAllowed}). */
export type SourceAllowlist = readonly SourceAllowlistEntry[];

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/i;
const IPV4_MASK = 0xff_ff_ff_ffn;

function parseIpv4(text: string): bigint | null {
  const match = IPV4_PATTERN.exec(text);

  if (match === null) {
    return null;
  }

  let value = 0n;

  for (const octet of match.slice(1)) {
    const number = Number(octet);

    if (number > 255) {
      return null;
    }

    value = (value << 8n) | BigInt(number);
  }

  return value;
}

function parseIpv6(text: string): bigint | null {
  let rest = text;

  // Eingebettete IPv4 am Ende (`::ffff:10.10.0.2`) in zwei Hex-Gruppen
  // umschreiben, dann läuft der Rest wie eine gewöhnliche IPv6-Adresse.
  if (rest.includes('.')) {
    const lastColon = rest.lastIndexOf(':');
    const embedded = lastColon === -1 ? null : parseIpv4(rest.slice(lastColon + 1));

    if (embedded === null) {
      return null;
    }

    const high = (embedded >> 16n).toString(16);
    const low = (embedded & 0xff_ffn).toString(16);

    rest = `${rest.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = rest.split('::');

  if (halves.length > 2) {
    return null;
  }

  const splitGroups = (half: string | undefined): string[] =>
    half === undefined || half.length === 0 ? [] : half.split(':');
  const head = splitGroups(halves[0]);
  const foot = halves.length === 2 ? splitGroups(halves[1]) : [];
  const missing = 8 - head.length - foot.length;

  // `::` steht für mindestens eine Null-Gruppe; ohne `::` müssen es genau acht sein.
  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    return null;
  }

  const groups = [...head, ...Array.from({ length: missing }, () => '0'), ...foot];
  let value = 0n;

  for (const group of groups) {
    if (!IPV6_GROUP_PATTERN.test(group)) {
      return null;
    }

    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }

  return value;
}

/**
 * Liest eine einzelne Adresse. IPv4-mapped IPv6 (`::ffff:a.b.c.d`) wird als
 * die eingebettete IPv4-Adresse geliefert – so trifft sie IPv4-Einträge.
 */
function parseAddress(text: string): ParsedAddress | null {
  const ipv4 = parseIpv4(text);

  if (ipv4 !== null) {
    return { bits: 32, value: ipv4 };
  }

  const ipv6 = parseIpv6(text);

  if (ipv6 === null) {
    return null;
  }

  if (ipv6 >> 32n === 0xff_ffn) {
    return { bits: 32, value: ipv6 & IPV4_MASK };
  }

  return { bits: 128, value: ipv6 };
}

function parseEntry(text: string): SourceAllowlistEntry {
  const slash = text.indexOf('/');
  const address = parseAddress(slash === -1 ? text : text.slice(0, slash));

  if (address === null) {
    throw new Error(`„${text}" ist weder eine IPv4-/IPv6-Adresse noch ein CIDR-Netz.`);
  }

  let prefixLength: number = address.bits;

  if (slash !== -1) {
    const prefixText = text.slice(slash + 1);

    if (!/^\d{1,3}$/.test(prefixText) || Number(prefixText) > address.bits) {
      throw new Error(
        `Präfixlänge in „${text}" muss eine Zahl zwischen 0 und ${String(address.bits)} sein.`,
      );
    }

    prefixLength = Number(prefixText);
  }

  return {
    text,
    bits: address.bits,
    network: address.value >> BigInt(address.bits - prefixLength),
    prefixLength,
  };
}

/**
 * Liest `AGENT_SOURCE_ALLOWLIST`: kommagetrennte Adressen oder CIDR-Netze,
 * z. B. `10.10.0.0/24,127.0.0.1`. Leer oder nicht gesetzt ergibt die leere
 * Liste. Ein ungültiger Eintrag wirft – eine Liste, die still weniger prüft
 * als hingeschrieben, wäre schlimmer als gar keine.
 */
export function parseSourceAllowlist(text: string | undefined): SourceAllowlist {
  if (text === undefined) {
    return [];
  }

  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(parseEntry);
}

/**
 * Darf eine Verbindung von `remoteAddress` den Agent-Kanal benutzen?
 *
 * Leere Liste = keine Prüfung, damit Entwicklungsumgebungen und bestehende
 * Installationen unverändert laufen. Ist die Liste gesetzt, zählt nur ein
 * Treffer: Eine fehlende oder unlesbare Adresse ist dann **kein** Treffer.
 */
export function isSourceAllowed(
  allowlist: SourceAllowlist,
  remoteAddress: string | undefined,
): boolean {
  if (allowlist.length === 0) {
    return true;
  }

  if (remoteAddress === undefined) {
    return false;
  }

  const address = parseAddress(remoteAddress.trim());

  if (address === null) {
    return false;
  }

  return allowlist.some(
    (entry) =>
      entry.bits === address.bits &&
      address.value >> BigInt(address.bits - entry.prefixLength) === entry.network,
  );
}
