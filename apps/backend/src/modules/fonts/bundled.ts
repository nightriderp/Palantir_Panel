/**
 * Mitgelieferte Schriften (Arbeitspaket S-2, Backend-Hälfte).
 *
 * Diese Datei ist die **einzige Stelle**, an der steht, welche Schriften eine
 * Instanz von sich aus mitbringt. Wer eine weitere mitliefert, ergänzt genau
 * einen Eintrag in {@link BUNDLED_FONTS} und legt die Datei nach der Regel
 * unten ab – sonst nichts.
 *
 * ## Ablageort und Namensregel (verbindlich für S-3)
 *
 * ```
 * apps/backend/assets/fonts/<slug>.<endung>
 * ```
 *
 * - `<slug>` ist der Teil der Kennung hinter `bundled-`: die Kennung
 *   `bundled-playpen-sans` gehört zur Datei `playpen-sans.woff2`.
 * - `<endung>` kommt aus `FONT_FORMAT_CATALOG` (`.woff2`, `.woff`, `.ttf`,
 *   `.otf`) und muss zum Feld `format` des Eintrags passen.
 * - Keine Versionsangabe im Namen. Die Kennung steht in den
 *   Instanz-Einstellungen und muss einen Austausch der Datei überleben (siehe
 *   `BUNDLED_FONT_ID_PATTERN` im Vertrag).
 *
 * Das Verzeichnis liegt im **Backend**, nicht im Frontend: Ausgeliefert werden
 * die Dateien über `GET /api/fonts/:id/file`, damit hochgeladene und
 * mitgelieferte Schriften unter derselben Adresse erreichbar sind und die
 * Oberfläche für beide dieselbe `@font-face`-Regel bauen kann. Zwei
 * Auslieferungswege wären zwei Fehlerquellen. Das Docker-Image kopiert den
 * Ordner mit (`apps/backend/Dockerfile`), wie schon `apps/backend/drizzle`.
 *
 * ## Fehlende Dateien
 *
 * Ein Eintrag ohne Datei erscheint **nicht** in der Liste (siehe
 * `service.ts`) – die Oberfläche bietet damit nie eine Schrift an, die sie
 * anschließend nicht laden könnte. Dass Katalog und Verzeichnis in beide
 * Richtungen zusammenpassen, hält `bundled.test.ts` fest: Sonst fiele ein halb
 * ergänzter Eintrag erst dem Betrachter der leeren Liste auf.
 */

import {
  BUNDLED_FONT_ID_PREFIX,
  FONT_FORMAT_CATALOG,
  type FontFormat,
  type FontWeightRange,
} from '@palantir/contracts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Ein Eintrag des Katalogs, so wie er unten geschrieben wird. */
interface BundledFontEntry {
  /** Teil der Kennung hinter `bundled-`; zugleich der Dateiname ohne Endung. */
  readonly slug: string;
  readonly family: string;
  readonly label: string;
  readonly format: FontFormat;
  readonly variable: boolean;
  readonly weightRange: FontWeightRange;
  /**
   * Dicktengleich? Angabe des Katalogs, keine Messung (`FontDto.monospace`).
   *
   * Für die zweite Rolle der Oberfläche (`monospaceFontId`) taugt nur, was hier
   * `true` steht. Wer einen Eintrag ergänzt, entscheidet die Frage bewusst:
   * Eine falsch als dicktengleich gemeldete Schrift lässt jede Konsolenausgabe
   * spaltenweise verrutschen.
   */
  readonly monospace: boolean;
}

/** Ein Eintrag samt der abgeleiteten Kennung und dem Dateinamen. */
export interface BundledFont extends BundledFontEntry {
  /** `bundled-<slug>`. */
  readonly id: string;
  /** `<slug><endung>`, relativ zum Auslieferungsverzeichnis. */
  readonly fileName: string;
}

/**
 * Die mitgelieferten Schriften.
 *
 * Die ersten beiden sind die Schriften, die die Oberfläche bisher zur Laufzeit
 * von Google geladen hat (`apps/frontend/src/app/layout.tsx`) – sie stehen hier
 * an erster Stelle, weil sie die Vorgabe des Design-Systems tragen. Die vier
 * übrigen sind Auswahlschriften für den Betreiber. Alle sechs Dateien liegen im
 * Auslieferungsverzeichnis, ihre Lizenzen unter `assets/fonts/lizenzen/`
 * (Übersicht in `assets/fonts/LIZENZEN.md`).
 */
const ENTRIES: readonly BundledFontEntry[] = [
  {
    slug: 'space-grotesk',
    family: 'Space Grotesk',
    label: 'Space Grotesk',
    format: 'woff2',
    variable: true,
    weightRange: { min: 300, max: 700 },
    monospace: false,
  },
  {
    slug: 'jetbrains-mono',
    family: 'JetBrains Mono',
    label: 'JetBrains Mono',
    format: 'woff2',
    variable: true,
    weightRange: { min: 100, max: 800 },
    // Die einzige dicktengleiche der sechs – und damit die einzige, die für
    // `monospaceFontId` (Konsole, Logs) taugt.
    monospace: true,
  },
  {
    slug: 'chewy',
    family: 'Chewy',
    label: 'Chewy',
    format: 'woff2',
    variable: false,
    weightRange: { min: 400, max: 400 },
    monospace: false,
  },
  {
    slug: 'audiowide',
    family: 'Audiowide',
    label: 'Audiowide',
    format: 'woff2',
    variable: false,
    weightRange: { min: 400, max: 400 },
    monospace: false,
  },
  {
    slug: 'playpen-sans',
    family: 'Playpen Sans',
    label: 'Playpen Sans',
    format: 'woff2',
    variable: true,
    weightRange: { min: 100, max: 800 },
    monospace: false,
  },
  {
    slug: 'henny-penny',
    family: 'Henny Penny',
    label: 'Henny Penny',
    format: 'woff2',
    variable: false,
    weightRange: { min: 400, max: 400 },
    monospace: false,
  },
];

export const BUNDLED_FONTS: readonly BundledFont[] = ENTRIES.map((entry) => ({
  ...entry,
  id: `${BUNDLED_FONT_ID_PREFIX}${entry.slug}`,
  fileName: `${entry.slug}${FONT_FORMAT_CATALOG[entry.format].extension}`,
}));

const BY_ID = new Map(BUNDLED_FONTS.map((font) => [font.id, font]));

/**
 * Löst eine mitgelieferte Kennung auf – **ohne Datenbankabfrage**.
 *
 * Genau dafür gibt es das Präfix (siehe `BUNDLED_FONT_ID_PREFIX` im Vertrag).
 * `null` heißt „keine mitgelieferte Schrift dieser Kennung"; ob sie stattdessen
 * hochgeladen ist, entscheidet die Form der Kennung, nicht diese Funktion.
 */
export function findBundledFont(id: string): BundledFont | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Auslieferungsverzeichnis der mitgelieferten Schriften.
 *
 * Aufgelöst relativ zur eigenen Datei – wie der Migrationsordner in
 * `db/migrate.ts`. `src/modules/fonts/` und `dist/modules/fonts/` liegen gleich
 * tief, der Pfad stimmt also im Entwicklungs- wie im Betriebsfall.
 */
export function bundledFontDirectory(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts');
}
