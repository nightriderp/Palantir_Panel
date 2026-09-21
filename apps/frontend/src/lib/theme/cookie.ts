import { STANDARD_THEME_ID } from './palette';

/**
 * Wo die Theme-Wahl liegt – und warum in einem Cookie.
 *
 * **Nicht im `localStorage`.** Der Server müsste die Wahl sonst raten: Er
 * liefert das Dokument aus, bevor irgendein Skript gelaufen ist, also im
 * Standard-Aussehen. Das richtige Theme käme erst nach dem ersten Bild – bei
 * jedem Aufruf ein sichtbares Aufblitzen der falschen Farben. Der übliche
 * Ausweg, ein winziges Inline-Skript im `<head>`, scheitert hier an der
 * eigenen Sicherheitsregel: `script-src` verlangt eine Nonce je Anfrage
 * (`lib/csp.ts`), und ein Skript ohne sie läuft nicht.
 *
 * Ein Cookie kommt dagegen **mit der Anfrage** an. Das Wurzel-Layout liest es,
 * setzt `data-theme` am `<html>`-Element, und das erste Bild stimmt bereits.
 * Die Seite ist ohnehin `force-dynamic` (Nonce der CSP), das Lesen kostet also
 * keine Zwischenspeicherung.
 *
 * **Nicht am Konto.** Noch nicht: Das wäre ein Feld im Vertrag, eine Spalte in
 * der Datenbank und ein Endpunkt – bevor feststeht, ob das Ganze bleibt. Der
 * Preis ist, dass die Wahl am Gerät hängt statt am Konto. Wandert sie später
 * ans Konto, bleibt dieses Cookie als Vorgabe für den nicht angemeldeten Teil
 * (Anmeldeseite) brauchbar.
 */
export const THEME_COOKIE = 'palantir.theme';

/** Ein Jahr. Die Wahl ist eine Vorliebe, keine Sitzung. */
const HALTBARKEIT_SEKUNDEN = 60 * 60 * 24 * 365;

/**
 * Die Zeile für `document.cookie`, die eine Theme-Wahl festhält.
 *
 * Kein `HttpOnly` – das Cookie **muss** aus dem Browser beschreibbar sein, denn
 * dort wird umgeschaltet. Es trägt keine Berechtigung und keine Kennung,
 * sondern den Namen eines Aussehens; mehr gibt es daran nicht zu schützen.
 *
 * `SameSite=Lax` genügt: Das Cookie taugt nicht als Angriffsmittel, aber es
 * gibt keinen Grund, es fremden Seiten mitzugeben.
 *
 * `Secure` nur über HTTPS. Fest gesetzt wäre es im Betrieb richtig und in der
 * Entwicklung fatal: Über `http://localhost` nimmt der Browser ein
 * `Secure`-Cookie nicht an, und das Umschalten hätte dort einfach keine
 * Wirkung – ein Fehler, der sich nur auf dem eigenen Rechner zeigt.
 */
export function themeCookieZeile(id: string, sicher: boolean): string {
  return [
    `${THEME_COOKIE}=${encodeURIComponent(id)}`,
    'path=/',
    `max-age=${String(HALTBARKEIT_SEKUNDEN)}`,
    'samesite=lax',
    ...(sicher ? ['secure'] : []),
  ].join('; ');
}

/**
 * Die gemerkte Wahl im Browser festhalten und sofort anwenden.
 *
 * Das Attribut am `<html>`-Element ist die eigentliche Umschaltung: Die
 * Variablensätze **aller** Themes stehen bereits im Dokument
 * (`themesCss()`), es ändert sich also nur, welcher davon greift. Kein
 * Neuladen, keine Anfrage, kein Zwischenzustand.
 *
 * Das Cookie sorgt allein dafür, dass der **nächste** Seitenaufruf gleich
 * richtig ausgeliefert wird.
 */
export function themeAnwenden(id: string): void {
  if (typeof document === 'undefined') return;

  // Der Standard kommt ohne Attribut aus (`:root`) – so sieht eine Seite ohne
  // jede Wahl genauso aus wie eine mit ausdrücklich gewähltem Standard.
  if (id === STANDARD_THEME_ID) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = id;
  }

  document.cookie = themeCookieZeile(id, window.location.protocol === 'https:');
}

/** Das gerade angewandte Theme – aus dem Dokument, nicht aus dem Cookie. */
export function aktuellesThemeImDokument(): string {
  if (typeof document === 'undefined') return STANDARD_THEME_ID;
  return document.documentElement.dataset.theme ?? STANDARD_THEME_ID;
}
