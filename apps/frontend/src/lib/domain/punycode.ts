/**
 * Hostnamen mit Umlaut anzeigen (IDN, RFC 3492).
 *
 * Die Konfiguration führt Domainnamen in der ASCII-Form – sie muss es, weil
 * CORS, die Traefik-Host-Regel und der Hostname-Router Zeichenketten
 * vergleichen (Begründung in `apps/backend/src/config/domain-ascii.ts`).
 * Für das Auge ist `welt.xn--mf-it-kva.de` aber keine Adresse, sondern ein
 * Rätsel. Hier steht deshalb die Gegenrichtung: aus der ASCII-Form die
 * Schreibweise, die der Betreiber gekauft hat.
 *
 * **Nur für die Anzeige.** Nichts, was verglichen, gespeichert oder an eine
 * Schnittstelle gereicht wird, geht durch diese Funktion.
 *
 * Warum eine eigene Umsetzung und keine Bibliothek: Die Umrechnung steht
 * vollständig in RFC 3492 und braucht keine dreißig Zeilen. Node bringt zwar
 * ein `punycode`-Modul mit, das gilt aber seit Jahren als überholt und steht im
 * Browser-Bundle ohnehin nicht zur Verfügung.
 *
 * Die Gegenprobe unten macht die Sache sicher: Jedes umgerechnete Label wird
 * mit `new URL()` zurückgerechnet – also mit der Umrechnung der Laufzeit
 * selbst – und nur übernommen, wenn dabei wieder genau das ursprüngliche Label
 * herauskommt. Ein Fehler in dieser Datei kann damit keine falsche Adresse
 * anzeigen, sondern höchstens die ASCII-Form stehen lassen.
 */

const BASIS = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAEMPFUNG = 700;
const ANFANGS_BIAS = 72;
const ANFANGS_N = 128;
const PRAEFIX = 'xn--';

/** Ziffernwert eines Zeichens: `a`–`z` ergeben 0–25, `0`–`9` ergeben 26–35. */
function ziffer(zeichen: number): number {
  if (zeichen >= 0x30 && zeichen <= 0x39) return zeichen - 0x30 + 26;
  if (zeichen >= 0x41 && zeichen <= 0x5a) return zeichen - 0x41;
  if (zeichen >= 0x61 && zeichen <= 0x7a) return zeichen - 0x61;
  return BASIS;
}

/** Schrittweite nachführen (RFC 3492, Abschnitt 6.1). */
function biasAnpassen(delta: number, anzahl: number, erstesMal: boolean): number {
  let d = erstesMal ? Math.floor(delta / DAEMPFUNG) : delta >> 1;
  d += Math.floor(d / anzahl);

  let k = 0;
  while (d > ((BASIS - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASIS - TMIN));
    k += BASIS;
  }

  return k + Math.floor(((BASIS - TMIN + 1) * d) / (d + SKEW));
}

/**
 * Ein einzelnes Label ohne das Präfix `xn--` entschlüsseln.
 *
 * Wirft bei allem, was nicht dem Format entspricht – der Aufrufer fängt das ab
 * und behält dann die ASCII-Form.
 */
function labelEntschluesseln(eingabe: string): string {
  const zeichen = [...eingabe];
  const trenner = eingabe.lastIndexOf('-');
  const ausgabe: number[] = [];

  let start = 0;

  if (trenner > 0) {
    for (const z of eingabe.slice(0, trenner)) {
      const punkt = z.codePointAt(0);
      if (punkt === undefined || punkt >= ANFANGS_N) {
        throw new Error('kein gültiges Label');
      }
      ausgabe.push(punkt);
    }
    start = trenner + 1;
  }

  let n = ANFANGS_N;
  let i = 0;
  let bias = ANFANGS_BIAS;

  for (let stelle = start; stelle < zeichen.length;) {
    const vorher = i;

    for (let w = 1, k = BASIS; ; k += BASIS) {
      if (stelle >= zeichen.length) {
        throw new Error('Label bricht mitten in einer Ziffer ab');
      }

      const wert = ziffer(eingabe.charCodeAt(stelle));
      stelle += 1;

      if (wert >= BASIS) {
        throw new Error('unzulässiges Zeichen');
      }

      i += wert * w;

      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (wert < t) break;

      w *= BASIS - t;
    }

    bias = biasAnpassen(i - vorher, ausgabe.length + 1, vorher === 0);
    n += Math.floor(i / (ausgabe.length + 1));
    i %= ausgabe.length + 1;

    if (n > 0x10ffff) {
      throw new Error('Zeichen jenseits des Unicode-Bereichs');
    }

    ausgabe.splice(i, 0, n);
    i += 1;
  }

  return String.fromCodePoint(...ausgabe);
}

/**
 * Hostname so, wie ein Mensch ihn liest.
 *
 * `welt.xn--mf-it-kva.de` ergibt `welt.müf-it.de`. Ein Name ohne
 * `xn--`-Label bleibt unverändert, ebenso jedes Label, dessen Umrechnung die
 * Gegenprobe nicht besteht.
 */
export function hostnameAnzeigen(hostname: string): string {
  if (!hostname.toLowerCase().includes(PRAEFIX)) {
    return hostname;
  }

  return hostname
    .split('.')
    .map((label) => {
      if (!label.toLowerCase().startsWith(PRAEFIX)) {
        return label;
      }

      try {
        const lesbar = labelEntschluesseln(label.slice(PRAEFIX.length).toLowerCase());

        // Gegenprobe mit der Umrechnung der Laufzeit selbst.
        return new URL(`https://${lesbar}`).hostname === label.toLowerCase() ? lesbar : label;
      } catch {
        return label;
      }
    })
    .join('.');
}
