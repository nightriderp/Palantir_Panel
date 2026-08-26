/**
 * Ableitungen aus dem Request, die an einer Sitzung hängen (Pflichtenheft §6,
 * Entität `Session`): Gerätekennung und Herkunfts-Hinweis für die
 * Geräteübersicht (Lastenheft §3.1).
 *
 * Bewusst grob: die Übersicht soll dem Nutzer helfen, ein Gerät wiederzuerkennen
 * – sie ist kein Werkzeug zur Nachverfolgung. Der vollständige User-Agent und
 * die vollständige IP werden deshalb nicht gespeichert.
 *
 * Kennt kein Fastify und keine Datenbank; die Eingaben sind reine Strings
 * (CLAUDE.md §4).
 */

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  // Reihenfolge zählt: Edge und Opera tragen „Chrome" im User-Agent, Chrome
  // trägt „Safari". Die spezifischeren Muster müssen deshalb zuerst greifen.
  [/\bEdg[A-Z]?\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\bFirefox\//, 'Firefox'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const PLATFORMS: readonly (readonly [RegExp, string])[] = [
  [/\bAndroid\b/, 'Android'],
  [/\b(iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

function firstMatch(
  value: string,
  candidates: readonly (readonly [RegExp, string])[],
): string | null {
  for (const [pattern, label] of candidates) {
    if (pattern.test(value)) {
      return label;
    }
  }

  return null;
}

/**
 * Kurzbeschreibung des Geräts aus dem User-Agent, z. B. „Firefox auf Windows".
 *
 * Liefert `null`, wenn sich nichts Sinnvolles ableiten lässt – dann zeigt die
 * Übersicht schlicht nichts an, statt eine erfundene Angabe zu machen.
 */
export function describeDevice(userAgent: string | undefined): string | null {
  if (!userAgent) {
    return null;
  }

  const browser = firstMatch(userAgent, BROWSERS);
  const platform = firstMatch(userAgent, PLATFORMS);

  if (browser && platform) {
    return `${browser} auf ${platform}`;
  }

  return browser ?? platform;
}

/**
 * Gekürzte Herkunfts-IP als Wiedererkennungshilfe.
 *
 * IPv4 verliert das letzte Oktett (`203.0.113.x`), IPv6 alles ab dem vierten
 * Block (`2001:db8:1:2:x`). Damit bleibt erkennbar, ob eine Sitzung aus dem
 * eigenen Netz stammt, ohne die vollständige Adresse zu speichern – sie wird
 * für die Anzeige nicht gebraucht (Datenschutz-Prinzip aus Pflichtenheft §18).
 */
export function toIpHint(ip: string | undefined): string | null {
  if (!ip) {
    return null;
  }

  // Fastify liefert IPv4-Adressen über IPv6-Sockets als `::ffff:203.0.113.10`.
  const address = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;

  if (address.includes('.')) {
    const octets = address.split('.');

    return octets.length === 4 ? `${octets.slice(0, 3).join('.')}.x` : null;
  }

  if (address.includes(':')) {
    const blocks = address.split(':').filter((block) => block.length > 0);

    return blocks.length > 0 ? `${blocks.slice(0, 3).join(':')}:x` : null;
  }

  return null;
}
