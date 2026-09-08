/**
 * Schriften der Oberfläche (Lastenheft §3.10 – Vertragsteil).
 *
 * Bisher lädt das Frontend zwei Schriften zur Laufzeit von Google
 * (`apps/frontend/src/app/layout.tsx`). Das endet: Schriften kommen künftig aus
 * der Instanz selbst – mitgeliefert oder vom Administrator hochgeladen. Damit
 * lädt die Oberfläche nichts mehr von einem fremden Host, und eine Instanz
 * ohne Internetzugang sieht aus wie eine mit.
 *
 * **Zwei Rollen, nicht eine.** Die Oberfläche braucht eine proportionale
 * Schrift; Konsole, Logs und Serveradressen brauchen eine dicktengleiche, sonst
 * verrutschen Spalten und eine Adresse lässt sich nicht mehr zeichenweise
 * vorlesen. Beide werden deshalb getrennt gewählt (siehe
 * `InstanceSettingsDto.uiFontId` / `monospaceFontId` in `instance.ts`).
 *
 * **Warum der Vertrag hier liegt:** Backend (Upload, Ablage, Auslieferung) und
 * Frontend (Auswahl, erzeugte `@font-face`-Regeln) müssen dieselben Formate,
 * Grenzen und Kennungen kennen – kein zweiter, abweichender Regelsatz
 * (CLAUDE.md §3). Die Eingabeprüfung der Upload-Angaben steht in
 * `@palantir/validation` (`font.ts`), nicht hier.
 */

/**
 * Herkunft einer Schrift.
 *
 * `bundled` – mit der Instanz ausgeliefert, frei lizenziert, immer vorhanden
 * und nie löschbar. `uploaded` – vom Administrator hochgeladen und damit auch
 * wieder entfernbar.
 */
export const FONT_SOURCES = ['bundled', 'uploaded'] as const;

export type FontSource = (typeof FONT_SOURCES)[number];

/** Unterstützte Dateiformate einer Schrift. */
export const FONT_FORMATS = ['woff2', 'woff', 'ttf', 'otf'] as const;

export type FontFormat = (typeof FONT_FORMATS)[number];

/** Beschreibung eines Formats: Endung, MIME-Typ, CSS-Bezeichner und Obergrenze. */
export interface FontFormatDefinition {
  /** Dateiendung inklusive Punkt – so, wie sie am Upload ankommt. */
  readonly extension: string;
  /** MIME-Typ, mit dem das Backend die Datei ausliefert (RFC 8081). */
  readonly mimeType: string;
  /**
   * Bezeichner im `format(...)`-Teil einer `@font-face`-Regel.
   *
   * Steht hier, weil er sich **nicht** aus der Endung ableiten lässt: `.ttf`
   * heißt in CSS `truetype`, `.otf` heißt `opentype`. Beide Seiten würden die
   * Zuordnung sonst je für sich nachbauen – und eine falsche Zuordnung fällt
   * erst auf, wenn die Schrift im Browser stumm bleibt.
   */
  readonly cssFormat: string;
  /**
   * Höchstgröße einer einzelnen Datei dieses Formats in Bytes.
   *
   * Je Format verschieden, weil die Formate verschieden dicht packen: `woff2`
   * ist Brotli-komprimiert, `woff` schwächer, `ttf`/`otf` gar nicht. Eine
   * einzige Zahl für alle wäre entweder für `woff2` sinnlos hoch oder für
   * `otf` unbrauchbar niedrig. Überschreitung ist `FONT_FILE_TOO_LARGE`.
   */
  readonly maxSizeBytes: number;
}

/**
 * Katalog der Formate samt erlaubter Höchstgrößen.
 *
 * Die Grenzen liegen deutlich über einer üblichen Textschrift (ein variabler
 * `woff2`-Schnitt wiegt selten mehr als 100 KiB) und deutlich unter dem, was
 * eine Oberfläche noch in vertretbarer Zeit lädt. Sie sind eine Missbrauchs-
 * und Versehensgrenze, kein Qualitätsmerkmal.
 */
export const FONT_FORMAT_CATALOG: Record<FontFormat, FontFormatDefinition> = {
  woff2: {
    extension: '.woff2',
    mimeType: 'font/woff2',
    cssFormat: 'woff2',
    maxSizeBytes: 2 * 1024 * 1024,
  },
  woff: {
    extension: '.woff',
    mimeType: 'font/woff',
    cssFormat: 'woff',
    maxSizeBytes: 4 * 1024 * 1024,
  },
  ttf: {
    extension: '.ttf',
    mimeType: 'font/ttf',
    cssFormat: 'truetype',
    maxSizeBytes: 8 * 1024 * 1024,
  },
  otf: {
    extension: '.otf',
    mimeType: 'font/otf',
    cssFormat: 'opentype',
    maxSizeBytes: 8 * 1024 * 1024,
  },
};

/**
 * Größte überhaupt zulässige Upload-Größe über alle Formate.
 *
 * Die Grenze, die der Multipart-Empfänger im Backend setzt, **bevor** das
 * Format feststeht: Ohne sie müsste erst die ganze Datei entgegengenommen
 * werden, um sie anschließend als zu groß abzulehnen. Die feinere Prüfung je
 * Format kommt danach.
 */
export const FONT_UPLOAD_MAX_SIZE_BYTES = Math.max(
  ...Object.values(FONT_FORMAT_CATALOG).map((definition) => definition.maxSizeBytes),
);

/**
 * Präfix der Kennungen mitgelieferter Schriften.
 *
 * **Warum ein Präfix und keine zweite Liste:** Die gewählte Schrift steht als
 * Kennung in den Instanz-Einstellungen. Beim Auflösen muss ohne Datenbankabruf
 * entscheidbar sein, ob die Kennung auf eine mitgelieferte Datei im
 * Auslieferungsverzeichnis oder auf einen hochgeladenen Datensatz zeigt –
 * sonst kostet jede Seitenauslieferung eine Abfrage, nur um festzustellen, dass
 * es die Standardschrift ist.
 *
 * Die beiden Kennungsräume können sich nicht überschneiden: hochgeladene
 * Schriften tragen eine UUID (Version 4, wie jede Entität – siehe `idSchema`
 * in `@palantir/validation`), und eine UUID besteht ausschließlich aus
 * Hexziffern und Bindestrichen. `u`, `n` und `l` aus `bundled-` kommen dort
 * nicht vor.
 */
export const BUNDLED_FONT_ID_PREFIX = 'bundled-';

/**
 * Vollständiges Format einer mitgelieferten Kennung: `bundled-<slug>`.
 *
 * Der Slug ist kleingeschrieben und bindestrichgetrennt (`bundled-jetbrains-mono`).
 * Bewusst ohne Versionsangabe: Die Kennung steht in den Einstellungen und muss
 * einen Austausch der Schriftdatei überleben – eine Kennung mit Version wäre
 * nach dem ersten Aktualisieren der mitgelieferten Schriften ungültig, und die
 * Instanz fiele stillschweigend auf die Vorgabe zurück.
 */
export const BUNDLED_FONT_ID_PATTERN = /^bundled-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Höchstlänge einer Kennung – deckt UUID (36) und jeden sinnvollen Slug ab. */
export const FONT_ID_MAX_LENGTH = 64;

/**
 * Erkennt eine Kennung als mitgeliefert.
 *
 * Rein an der Form der Kennung, ohne Katalog: Welche Schriften eine Instanz
 * mitbringt, entscheidet die Auslieferung – der Vertrag legt nur fest, woran
 * man sie erkennt. Eine unbekannte, aber formal mitgelieferte Kennung ist
 * deshalb `FONT_NOT_FOUND` und nicht etwa „hochgeladen".
 */
export function isBundledFontId(value: string): boolean {
  return BUNDLED_FONT_ID_PATTERN.test(value);
}

/** Prüft, ob ein beliebiger String ein unterstütztes Schriftformat ist. */
export function isFontFormat(value: string): value is FontFormat {
  return (FONT_FORMATS as readonly string[]).includes(value);
}

/** Höchstgröße zu einem Format. */
export function maxSizeBytesForFontFormat(format: FontFormat): number {
  return FONT_FORMAT_CATALOG[format].maxSizeBytes;
}

/**
 * Kleinstes und größtes CSS-Schriftgewicht (`font-weight`).
 *
 * Grenzen der CSS-Spezifikation, nicht der Instanz: Was außerhalb liegt, ist
 * keine ungewöhnliche Schrift, sondern eine falsch ausgelesene Datei.
 */
export const FONT_WEIGHT_MIN = 1;
export const FONT_WEIGHT_MAX = 1000;

/** Abgedeckter Gewichtsbereich einer Schrift. */
export interface FontWeightRange {
  /** Kleinstes verfügbares Gewicht. */
  min: number;
  /** Größtes verfügbares Gewicht; bei statischen Schriften gleich `min`. */
  max: number;
}

/** Was der Aufrufer mit einer Schrift tun darf (Pflichtenheft §5.2). */
export interface FontPermissions {
  /**
   * Darf die Schrift gelöscht werden?
   *
   * Für mitgelieferte Schriften **nie** `true` – sie liegen im
   * Auslieferungsverzeichnis und wären nach dem nächsten Aufspielen ohnehin
   * wieder da (`FONT_BUNDLED_PROTECTED`). Für hochgeladene Schriften zusätzlich
   * `false`, solange sie in den Instanz-Einstellungen gewählt ist
   * (`FONT_IN_USE`) – sonst stünde die Oberfläche ohne Schrift da.
   */
  canDelete: boolean;
}

/**
 * Eine Schrift, wie sie die Verwaltung und die Auswahl zeigen.
 *
 * Wie jedes DTO vollständig samt `permissions` – keine view-spezifisch
 * zusammengestrichene Sonderform (CLAUDE.md §3).
 */
export interface FontDto {
  /**
   * Stabile Kennung.
   *
   * Mitgeliefert: `bundled-<slug>` (siehe {@link BUNDLED_FONT_ID_PREFIX}).
   * Hochgeladen: die vom Backend erzeugte UUID des Datensatzes. Die Kennung
   * bleibt über Umbenennungen hinweg gleich, weil sie in den
   * Instanz-Einstellungen steht – der `family`-Name darf sich ändern, die
   * Kennung nicht.
   */
  id: string;
  /**
   * Name, der im `font-family` der erzeugten Regel steht.
   *
   * Wird vom Backend in eine `@font-face`-Regel geschrieben und ist deshalb der
   * einzige Wert dieses DTOs, der je in eine Formatvorlage gelangt. Der
   * Zeichenvorrat ist entsprechend eng gefasst – geprüft wird das beim
   * Hochladen (`fontFamilyNameSchema` in `@palantir/validation`), nicht erst
   * beim Erzeugen des CSS.
   */
  family: string;
  /** Anzeigename in der Oberfläche; rein zur Darstellung, nie im CSS. */
  label: string;
  source: FontSource;
  format: FontFormat;
  /** Größe der Schriftdatei in Bytes. */
  sizeBytes: number;
  /** ISO-8601 des Hochladens; `null` bei mitgelieferten Schriften. */
  uploadedAt: string | null;
  /**
   * Anzeigename des Hochladenden zum Zeitpunkt des Uploads; `null` bei
   * mitgelieferten Schriften.
   *
   * Bewusst der Name und nicht die Konto-Kennung: Die Angabe soll auch dann
   * noch lesbar sein, wenn das Konto längst gelöscht ist – wie beim Audit-Log.
   */
  uploadedByDisplayName: string | null;
  /**
   * Variable Schrift – eine Datei, die einen ganzen Gewichtsbereich abdeckt.
   *
   * Entscheidet, wie die `@font-face`-Regel aussieht: Bei einer variablen
   * Schrift trägt sie `font-weight: <min> <max>` und der Browser interpoliert;
   * bei einer statischen genau ein Gewicht. Steht der Schalter falsch, rendert
   * der Browser fette Texte künstlich verzerrt („faux bold") statt den
   * vorhandenen Schnitt zu benutzen.
   */
  variable: boolean;
  /**
   * Abgedeckter Gewichtsbereich.
   *
   * Auch bei statischen Schriften gefüllt – dann mit `min === max`. Ein
   * `null` für den statischen Fall würde jede auswertende Stelle zu einer
   * Fallunterscheidung zwingen, obwohl „genau ein Gewicht" ein Bereich der
   * Länge null ist.
   */
  weightRange: FontWeightRange;
  /**
   * Dicktengleiche Schrift – jedes Zeichen ist gleich breit.
   *
   * Steht im DTO, weil die Oberfläche **zwei** Rollen getrennt besetzt
   * (`uiFontId` und `monospaceFontId`) und für die zweite nur dicktengleiche
   * Schriften taugen: Konsole, Logs und Serveradressen verrutschen sonst
   * spaltenweise. Ohne diese Angabe kann die Auswahl weder vorsortieren noch
   * warnen, und der Fehler fällt erst auf, wenn jemand eine Konsolenausgabe
   * liest.
   *
   * **Eine Angabe, keine Messung.** Ob eine Schrift wirklich dicktengleich ist,
   * stünde in der `post`-Tabelle der Schriftdatei; die auszulesen hieße, einen
   * Parser über fremdbestimmte Daten zu führen. Bei mitgelieferten Schriften
   * setzt der Katalog den Wert, bei hochgeladenen der Administrator beim
   * Hochladen. Falsch gesetzt ist er eine unschöne Anzeige, kein Sicherheits-
   * oder Datenproblem.
   */
  monospace: boolean;
  permissions: FontPermissions;
}
