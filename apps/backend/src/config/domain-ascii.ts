/**
 * Umlaut-Domains in der Konfiguration (IDN, RFC 3492).
 *
 * Eine Domain wie `müf-it.de` und ihre ASCII-Schreibweise `xn--mf-it-kva.de`
 * sind **derselbe Name** – DNS, TLS und der HTTP-`Host`-Kopf kennen nur die
 * zweite. Jeder Browser wandelt vor dem Absenden um, ohne dass der Nutzer es
 * merkt.
 *
 * Genau daran scheiterte die Konfiguration bisher, und zwar stumm: An drei
 * Stellen werden Zeichenketten **verglichen**, nicht umgerechnet.
 *
 * - `server.ts` erlaubt in CORS genau `PUBLIC_WEB_URL`; der Browser schickt
 *   `Origin: https://xn--…`.
 * - Die Traefik-Regel `Host(...)` in `deploy/vps/docker-compose.yml` entsteht
 *   aus `PALANTIR_DOMAIN` und wird gegen den `Host`-Kopf geprüft.
 * - Der Hostname-Router im Agent (`jobs/router/hostname-routes.ts`) lässt nur
 *   ASCII-Hostnamen durch und verwirft alles andere.
 *
 * Stünde in der `.env` die Umlaut-Schreibweise, verglichen alle drei zwei
 * verschiedene Zeichenketten und fänden nichts – ohne Fehlermeldung, ohne
 * Eintrag im Log. Deshalb wird der Name hier **einmal zentral** in die
 * ASCII-Form gebracht, bevor irgendetwas daraus abgeleitet wird.
 *
 * Wer in der `.env` bereits die ASCII-Form pflegt, merkt von alledem nichts:
 * Ein Wert ohne Sonderzeichen wird unverändert durchgereicht, Zeichen für
 * Zeichen. Die Umrechnung greift ausschließlich dort, wo tatsächlich ein
 * Zeichen jenseits von ASCII steht.
 *
 * Reine Funktionen ohne Zod und Fastify, damit die Umrechnung für sich prüfbar
 * ist (Entwicklungsregeln §4).
 */

/**
 * Trägt der Wert ausschließlich ASCII-Zeichen? Dann ist nichts umzurechnen.
 *
 * Zeichenweise statt als regulärer Ausdruck: Ein Zeichenbereich bis 0x7F
 * enthält Steuerzeichen, was `no-control-regex` zu Recht beanstandet.
 */
function nurAscii(wert: string): boolean {
  for (const zeichen of wert) {
    if ((zeichen.codePointAt(0) ?? 0) > 0x7f) {
      return false;
    }
  }

  return true;
}

/**
 * Hostname in der ASCII-Form.
 *
 * `new URL()` bringt den Namensteil einer Adresse von sich aus in die
 * ASCII-Form – dieselbe Umrechnung, die auch der Browser vornimmt. Eine eigene
 * Punycode-Umsetzung wäre eine zweite Wahrheit neben der der Laufzeit.
 *
 * Ein führender Punkt bleibt erhalten: `COOKIE_DOMAIN` darf ihn tragen
 * (`.beispiel.tld`), und `new URL()` würde daran scheitern.
 *
 * @param variable Name der Umgebungsvariablen – steht in der Fehlermeldung,
 *   damit ein unbrauchbarer Wert beim Start benannt wird und nicht erst später
 *   als nicht greifende Route auffällt.
 */
export function hostAlsAscii(name: string, variable: string): string {
  if (nurAscii(name)) {
    return name;
  }

  const führenderPunkt = name.startsWith('.');
  const kern = führenderPunkt ? name.slice(1) : name;

  let ascii = '';

  try {
    ascii = new URL(`https://${kern}`).hostname;
  } catch {
    ascii = '';
  }

  if (ascii === '') {
    throw new Error(
      `${variable} ist kein gültiger Hostname: „${name}". ` +
        'Erwartet wird ein Domainname, wahlweise mit Umlauten (müf-it.de) oder ' +
        'in der ASCII-Schreibweise (xn--mf-it-kva.de).',
    );
  }

  return führenderPunkt ? `.${ascii}` : ascii;
}

/**
 * Vollständige Adresse mit Hostnamen in der ASCII-Form.
 *
 * Betrifft die ausdrücklich gesetzten Adressen (`PUBLIC_WEB_URL`,
 * `PUBLIC_API_URL`, die OAuth-Rücksprünge). Pfad, Port und Abfrage bleiben, wie
 * sie sind; ein abschließender Schrägstrich wird nur dann angehängt, wenn er
 * schon dastand – `new URL()` ergänzt ihn sonst von sich aus und würde den Wert
 * damit verändern, ohne dass es jemand wollte.
 */
export function urlAlsAscii(wert: string, variable: string): string {
  if (nurAscii(wert)) {
    return wert;
  }

  let url: URL;

  try {
    url = new URL(wert);
  } catch {
    throw new Error(
      `${variable} ist keine gültige Adresse: „${wert}". ` +
        'Erwartet wird eine vollständige Adresse samt Schema, z. B. https://müf-it.de/api.',
    );
  }

  const href = url.href;

  return href.endsWith('/') && !wert.endsWith('/') ? href.slice(0, -1) : href;
}
