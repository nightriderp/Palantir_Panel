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

/** Ein Oktett einer IPv4-Adresse: 0–255, ohne führende Nullen. */
const IPV4_OCTET = /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;

/** Ein Block einer IPv6-Adresse: ein bis vier Hex-Ziffern. */
const IPV6_BLOCK = /^[0-9a-fA-F]{1,4}$/;

/** Anzahl der Blöcke einer vollständig ausgeschriebenen IPv6-Adresse. */
const IPV6_BLOCK_COUNT = 8;

/**
 * Zerlegt eine IPv6-Adresse in ihre acht ausgeschriebenen Blöcke.
 *
 * Das Auffüllen ist der Kern der Sache (Audit backend-auth-07): `::` steht für
 * eine beliebig lange Folge von Nullblöcken. Wer die Leerstellen einfach
 * wegfiltert, verliert die Positionsinformation – aus `2001:db8::dead:beef`
 * würde dann der Hinweis `2001:db8:dead:x`, obwohl „dead" der siebte und nicht
 * der dritte Block ist.
 *
 * Eine eingebettete IPv4-Notation (`::ffff:203.0.113.10`, `64:ff9b::192.0.2.33`)
 * wird vorher in die beiden entsprechenden Hex-Blöcke übersetzt.
 *
 * Liefert `null`, wenn die Eingabe keine gültige Adresse ist.
 */
function expandIpv6(address: string): string[] | null {
  let rest = address;
  const lastColon = rest.lastIndexOf(':');
  const tail = rest.slice(lastColon + 1);

  if (tail.includes('.')) {
    const octets = tail.split('.');

    if (octets.length !== 4 || !octets.every((octet) => IPV4_OCTET.test(octet))) {
      return null;
    }

    const [a = 0, b = 0, c = 0, d = 0] = octets.map(Number);

    rest = `${rest.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const parts = rest.split('::');

  if (parts.length > 2) {
    return null;
  }

  const head = parts[0] === undefined || parts[0] === '' ? [] : parts[0].split(':');
  const suffix = parts[1] === undefined || parts[1] === '' ? [] : parts[1].split(':');
  let blocks: string[];

  if (parts.length === 2) {
    const missing = IPV6_BLOCK_COUNT - head.length - suffix.length;

    // Mindestens ein Block: `::` steht nie für „nichts".
    if (missing < 1) {
      return null;
    }

    blocks = [...head, ...Array<string>(missing).fill('0'), ...suffix];
  } else {
    blocks = head;
  }

  if (blocks.length !== IPV6_BLOCK_COUNT || !blocks.every((block) => IPV6_BLOCK.test(block))) {
    return null;
  }

  // Führende Nullen abschneiden, damit `2001:0db8:…` denselben Hinweis ergibt
  // wie `2001:db8:…`.
  return blocks.map((block) => block.replace(/^0+(?=.)/, '').toLowerCase());
}

/** `203.0.113.10` → `203.0.113.x`; `null` bei allem, was keine IPv4 ist. */
function toIpv4Hint(address: string): string | null {
  const octets = address.split('.');

  if (octets.length !== 4 || !octets.every((octet) => IPV4_OCTET.test(octet))) {
    return null;
  }

  return `${octets.slice(0, 3).join('.')}.x`;
}

/**
 * Gekürzte Herkunfts-IP als Wiedererkennungshilfe.
 *
 * IPv4 verliert das letzte Oktett (`203.0.113.x`), IPv6 alles ab dem vierten
 * Block (`2001:db8:1:x`) – gezählt wird dabei auf der **ausgeschriebenen**
 * Adresse, `::` wird also vorher zu Nullblöcken aufgefüllt. Damit bleibt
 * erkennbar, ob eine Sitzung aus dem eigenen Netz stammt, ohne die
 * vollständige Adresse zu speichern – sie wird für die Anzeige nicht gebraucht
 * (Datenschutz-Prinzip aus Pflichtenheft §18).
 *
 * Alles, was keine erkennbare Adresse ist, ergibt `null`: lieber keine Angabe
 * als eine erfundene.
 */
export function toIpHint(ip: string | undefined): string | null {
  if (!ip) {
    return null;
  }

  // Zonen-Index (`fe80::1%eth0`) gehört zur Schnittstelle, nicht zur Adresse.
  const address = (ip.split('%')[0] ?? '').trim();

  if (address.length === 0) {
    return null;
  }

  if (!address.includes(':')) {
    return toIpv4Hint(address);
  }

  const blocks = expandIpv6(address);

  if (!blocks) {
    return null;
  }

  /*
   * IPv4-mapped (`::ffff:203.0.113.10`, so liefert Fastify IPv4 über
   * IPv6-Sockets) und dieselbe Adresse in Hex-Schreibweise (`::ffff:cb00:710a`)
   * sind dieselbe Herkunft – beide ergeben denselben IPv4-Hinweis, sonst
   * stünden für ein und denselben Anschluss zwei verschiedene Zeilen in der
   * Geräteübersicht.
   */
  if (blocks.slice(0, 5).every((block) => block === '0') && blocks[5] === 'ffff') {
    const high = Number.parseInt(blocks[6] ?? '0', 16);
    const low = Number.parseInt(blocks[7] ?? '0', 16);

    return toIpv4Hint(
      `${String(high >> 8)}.${String(high & 0xff)}.${String(low >> 8)}.${String(low & 0xff)}`,
    );
  }

  return `${blocks.slice(0, 3).join(':')}:x`;
}
