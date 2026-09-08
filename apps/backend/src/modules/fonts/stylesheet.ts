/**
 * Das erzeugte Stylesheet der Oberflächen-Schriften (Arbeitspaket S-3).
 *
 * Die Oberfläche braucht auf **jeder** Seite zwei Dinge: die
 * `@font-face`-Regeln aller verfügbaren Schriften und die Angabe, welche
 * Schrift gerade welche Rolle besetzt. Beides zusammen liefert eine einzige
 * öffentliche Route als fertiges CSS, das die Seite per `<link
 * rel="stylesheet">` einbindet.
 *
 * **Warum CSS und nicht JSON.** Die Auswahl steht in den Instanz-Einstellungen,
 * und die sind nur hinter `user.manage` zu haben – die Anmeldeseite käme nie an
 * sie heran, und selbst ein angemeldetes Konto ohne dieses Recht nicht. Ein
 * Stylesheet dagegen braucht keine Sitzung, kein JavaScript und keinen
 * Ladezustand: Der Browser holt es parallel zum Dokument, und die Schrift steht
 * schon beim ersten Bild.
 *
 * **Der Familienname landet hier in erzeugtem Code.** Er ist beim Hochladen
 * gegen eine enge Positivliste geprüft (`fontFamilyNameSchema` in
 * `@palantir/validation`), aber diese Datei verlässt sich nicht darauf: Jeder
 * Name geht durch {@link cssQuotedString} und kommt dort als Zeichenkette
 * heraus, in der alles außerhalb von `A–Z a–z 0–9`, Leerzeichen, `_` und `-`
 * als CSS-Hexfolge steht. Ein Name mit `"`, `;` oder `}` kann damit
 * schlimmstenfalls ein kaputter Name sein – nie eine zweite Regel. Zwei
 * Schranken, weil die erste eines Tages gelockert werden könnte.
 */

import {
  FONT_FORMAT_CATALOG,
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  type FontFormat,
  type FontWeightRange,
} from '@palantir/contracts';
import { DEFAULT_MONOSPACE_FONT_ID, DEFAULT_UI_FONT_ID } from './bundled.js';

/**
 * Adresse des erzeugten Stylesheets.
 *
 * Unter `/public/`, wie die Kennzahlen der Anmeldeseite (`/public/stats`) –
 * das Präfix ist in diesem Backend die Ansage „ohne Sitzung erreichbar".
 */
export const FONT_STYLESHEET_ROUTE_PATH = '/public/fonts.css';

/**
 * Adresse der Auslieferung einer einzelnen Schriftdatei.
 *
 * Steht hier und nicht als Zeichenkette in `routes.ts`, weil {@link fontFileHref}
 * dieselbe Adresse in jede erzeugte Regel schreibt. Zwei Stellen mit demselben
 * Pfad wären zwei Stellen, die auseinanderlaufen können – und der Fehler fiele
 * erst auf, wenn die Oberfläche stumm ohne Schrift dasteht.
 */
export const FONT_FILE_ROUTE_PATH = '/api/fonts/:id/file';

/** CSS-Variable der Schrift für Fließtext und Überschriften. */
export const UI_FONT_CSS_VARIABLE = '--palantir-font-ui';

/** CSS-Variable der dicktengleichen Schrift (Konsole, Logs, Serveradressen). */
export const MONOSPACE_FONT_CSS_VARIABLE = '--palantir-font-mono';

/** Welche Schrift besetzt welche Rolle? `null` heißt „Vorgabe der Instanz". */
export interface FontRoleSelection {
  readonly uiFontId: string | null;
  readonly monospaceFontId: string | null;
}

/**
 * Was eine Schrift zum Stylesheet beiträgt.
 *
 * Bewusst weniger als `FontDto`: Größe, Herkunft, Hochladender und der
 * `permissions`-Block gehören in die Verwaltungsansicht, nicht in eine
 * `@font-face`-Regel. Und ohne `permissions` braucht das Erzeugen keinen
 * Handelnden – genau deshalb kann die Route ohne Sitzung antworten.
 */
export interface StylesheetFont {
  readonly id: string;
  readonly family: string;
  readonly format: FontFormat;
  readonly variable: boolean;
  readonly weightRange: FontWeightRange;
}

/** Zeichen, die unverändert in einer CSS-Zeichenkette stehen dürfen. */
const NAME_UNBEDENKLICH = /^[A-Za-z0-9 _-]$/;

/**
 * Zeichen, die unverändert in einer Adresse stehen dürfen.
 *
 * Weiter gefasst als bei einem Namen, weil eine Adresse Trenner braucht – aber
 * immer noch eine Positivliste: Anführungszeichen, Rückstrich, Leerzeichen und
 * jedes Steuerzeichen fallen heraus, und genau die wären nötig, um aus dem
 * `url(…)` auszubrechen.
 */
const URL_UNBEDENKLICH = /^[A-Za-z0-9\-._~/%:?&=+@!$'()*,;]$/;

/**
 * Zeichenweise Positivliste: Was nicht erlaubt ist, wird zur CSS-Hexfolge.
 *
 * Das abschließende Leerzeichen beendet die Folge und wird vom Browser
 * verschluckt; folgt im Original selbst ein Leerzeichen, bleibt es als zweites
 * erhalten.
 */
function maskieren(value: string, erlaubt: RegExp): string {
  let ergebnis = '';

  for (const zeichen of value) {
    if (erlaubt.test(zeichen)) {
      ergebnis += zeichen;
      continue;
    }

    ergebnis += `\\${(zeichen.codePointAt(0) ?? 0).toString(16)} `;
  }

  return ergebnis;
}

/**
 * Ein beliebiger Text als CSS-Zeichenkette in doppelten Anführungszeichen.
 *
 * Positivliste, keine Sperrliste: Alles außerhalb von
 * {@link NAME_UNBEDENKLICH} wird zur Hexfolge – auch das, woran beim Schreiben
 * einer Sperrliste niemand denkt (Nullbytes, Zero-Width-Zeichen,
 * Bidi-Steuerzeichen).
 *
 * Ergebnis für `Inter"; } body { display: none` ist damit eine – unsinnige,
 * aber vollständig eingeschlossene – Zeichenkette und keine zweite Regel.
 */
export function cssQuotedString(value: string): string {
  return `"${maskieren(value, NAME_UNBEDENKLICH)}"`;
}

/**
 * Eine Adresse als `url("…")`.
 *
 * Zweite Schranke hinter {@link fontFileHref}: Dort sorgt schon
 * `encodeURIComponent` dafür, dass nichts aus der Adresse ausbricht. Hier
 * kommt dieselbe Zusicherung noch einmal aus anderer Richtung – für den Fall,
 * dass die Adresse eines Tages nicht mehr von dort kommt.
 */
export function cssUrl(value: string): string {
  return `url("${maskieren(value, URL_UNBEDENKLICH)}")`;
}

/**
 * Adresse, unter der der Browser die Datei einer Schrift holt.
 *
 * Bewusst wurzel-relativ und **nicht** absolut: Das Stylesheet wird von der
 * API-Herkunft ausgeliefert, relative Adressen darin lösen sich also gegen
 * genau diese Herkunft auf. Damit muss das Backend seine eigene öffentliche
 * Adresse für diesen Zweck gar nicht kennen – ein Wert weniger, der falsch
 * konfiguriert sein kann.
 */
export function fontFileHref(id: string): string {
  return FONT_FILE_ROUTE_PATH.replace(':id', encodeURIComponent(id));
}

/** Ein Gewicht auf den vom Vertrag erlaubten Bereich zurechtstutzen. */
function gewicht(wert: number): number {
  if (!Number.isFinite(wert)) {
    return FONT_WEIGHT_MIN;
  }

  return Math.min(FONT_WEIGHT_MAX, Math.max(FONT_WEIGHT_MIN, Math.trunc(wert)));
}

/**
 * Die `@font-face`-Regel einer Schrift.
 *
 * `font-display: swap` wie bisher: Der Text steht sofort in der Ersatzschrift
 * und wechselt, sobald die eigene geladen ist – eine Sekunde unsichtbarer Text
 * wäre der schlechtere Tausch.
 */
function fontFaceRegel(font: StylesheetFont): string {
  const min = gewicht(font.weightRange.min);
  const max = gewicht(font.weightRange.max);
  // Ein Schalter ohne echten Bereich ergäbe `font-weight: 400 400` – dieselbe
  // Aussage wie eine statische Schrift, nur missverständlicher.
  const gewichte = font.variable && min < max ? `${min} ${max}` : `${min}`;

  return [
    '@font-face{',
    `font-family:${cssQuotedString(font.family)};`,
    'font-style:normal;',
    `font-weight:${gewichte};`,
    'font-display:swap;',
    `src:${cssUrl(fontFileHref(font.id))} format(${cssQuotedString(
      FONT_FORMAT_CATALOG[font.format].cssFormat,
    )});`,
    '}',
  ].join('');
}

/**
 * Die Schrift zu einer Rolle – mit Rückfall auf die Vorgabe.
 *
 * Zeigt die Auswahl auf eine Schrift, die es nicht mehr gibt (von Hand aus der
 * Datenbank entfernt, mitgelieferte Datei beim Aufspielen verlorengegangen),
 * gilt die Vorgabe. Die Alternative – gar keine Variable – ließe die Oberfläche
 * auf ihren Fallback-Stack zurückfallen; das wäre dasselbe Ergebnis, nur ohne
 * die mitgelieferte Schrift, die ja vorhanden ist.
 */
function fuerRolle(
  fonts: readonly StylesheetFont[],
  gewaehlt: string | null,
  vorgabe: string,
): StylesheetFont | null {
  const treffer = gewaehlt === null ? undefined : fonts.find((font) => font.id === gewaehlt);

  return treffer ?? fonts.find((font) => font.id === vorgabe) ?? null;
}

/**
 * Das vollständige Stylesheet: alle Regeln, dann die beiden Variablen.
 *
 * Die Regeln stehen für **alle** verfügbaren Schriften darin, nicht nur für die
 * zwei gewählten. Das kostet nichts – eine `@font-face`-Regel lädt erst dann
 * eine Datei, wenn ihre Familie tatsächlich benutzt wird – und die
 * Verwaltungsansicht kann damit jede Schrift in ihrer eigenen Schrift zeigen,
 * ohne dafür eine zweite Auslieferung zu bauen.
 */
export function buildFontStylesheet(
  fonts: readonly StylesheetFont[],
  selection: FontRoleSelection,
): string {
  const ui = fuerRolle(fonts, selection.uiFontId, DEFAULT_UI_FONT_ID);
  const mono = fuerRolle(fonts, selection.monospaceFontId, DEFAULT_MONOSPACE_FONT_ID);

  const variablen = [
    ui === null ? null : `${UI_FONT_CSS_VARIABLE}:${cssQuotedString(ui.family)};`,
    mono === null ? null : `${MONOSPACE_FONT_CSS_VARIABLE}:${cssQuotedString(mono.family)};`,
  ].filter((zeile): zeile is string => zeile !== null);

  return [
    '/* Erzeugt von Palantir. Nicht von Hand ändern – die Auswahl steht in den Instanz-Einstellungen. */',
    ...fonts.map(fontFaceRegel),
    ...(variablen.length > 0 ? [`:root{${variablen.join('')}}`] : []),
    '',
  ].join('\n');
}
