/**
 * Schriftverwaltung (Arbeitspaket S-2) – Liste, Auslieferung, Upload, Löschung.
 *
 * Der Dienst kennt weder Fastify noch das Dateisystem noch Drizzle: Er spricht
 * über {@link FontRepository} und {@link FontFileStore}. Damit sind seine Regeln
 * – und das sind die interessanten Teile: Löschschutz, Formatprüfung,
 * Namenskollision – ohne Datenbank und ohne Platte prüfbar (CLAUDE.md §4).
 *
 * **Zwei Quellen, eine Liste.** Mitgelieferte Schriften kommen aus `bundled.ts`
 * (Katalog im Code, Dateien im Auslieferungsverzeichnis), hochgeladene aus der
 * Tabelle `uploaded_fonts`. Nach außen ist beides derselbe `FontDto` mit
 * derselben Auslieferungsadresse – die Oberfläche baut für beide dieselbe
 * `@font-face`-Regel und muss den Unterschied nur für den Löschknopf kennen
 * (`permissions.canDelete`).
 */

import {
  FONT_FORMAT_CATALOG,
  type FontDto,
  type FontWeightRange,
  isBundledFontId,
} from '@palantir/contracts';
import { type UploadFontInput } from '@palantir/validation';
import { createHash, randomUUID } from 'node:crypto';
import { isUniqueViolation } from '../../db/errors.js';
import { type AdminContext, type AuditService, entryFor } from '../admin/index.js';
import { hasPermission, type PermissionActor } from '../rbac/index.js';
import { type BundledFont, BUNDLED_FONTS, findBundledFont } from './bundled.js';
import { FontError } from './errors.js';
import { resolveFontUpload } from './format.js';
import { type FontRepository, type UploadedFontRecord } from './repository.js';
import { type FontFileStore, fontFileName } from './storage.js';
import { type FontRoleSelection, type StylesheetFont, buildFontStylesheet } from './stylesheet.js';

/**
 * Berechtigung, die Schriften hochlädt und löscht.
 *
 * Dieselbe wie für die Instanz-Einstellungen (`/admin/instance-settings`) und
 * damit keine neue im Katalog: Wer die Schrift der Instanz auswählen darf, muss
 * auch die Auswahl füllen können – zwei getrennte Rechte für denselben
 * Vorgang ließen sich nicht sinnvoll unterschiedlich vergeben.
 */
const MANAGE_PERMISSION = 'user.manage' as const;

/** Vorgabegewicht, wenn weder Datei noch Formular etwas hergeben (Vertrag). */
const DEFAULT_WEIGHT = 400;

/**
 * Woher der Dienst erfährt, welche Schriften gerade gewählt sind.
 *
 * Ein schmaler Port statt eines Zugriffs auf die Instanz-Einstellungen: Das
 * Schriften-Modul braucht von ihnen nur diese eine Frage, und die Gegenrichtung
 * (Einstellungen prüfen eine Kennung) läuft über {@link FontService.exists}.
 */
export interface FontSelectionSource {
  /** Gewählte Kennungen; ohne die Rollen zu unterscheiden. */
  selectedFontIds(): Promise<readonly string[]>;
  /**
   * Gewählte Kennungen **je Rolle** – für das erzeugte Stylesheet (S-3).
   *
   * Bewusst neben {@link selectedFontIds} und nicht an dessen Stelle: Die
   * beiden Fragen sind verschieden. Der Löschschutz will nur wissen, ob eine
   * Schrift überhaupt in Benutzung ist; das Stylesheet muss wissen, **welche**
   * Rolle sie besetzt, weil daraus zwei verschiedene CSS-Variablen werden.
   */
  selectedFontRoles(): Promise<FontRoleSelection>;
}

/** Eine Schriftdatei, fertig zum Ausliefern. */
export interface FontFileDownload {
  /** Vom Backend bestimmter Name – nie der des Hochladenden. */
  readonly fileName: string;
  readonly mimeType: string;
  readonly content: Buffer;
  /** SHA-256 in Hexschreibweise – Grundlage des `ETag`. */
  readonly fingerprint: string;
  /**
   * Darf die Antwort als `immutable` zwischengespeichert werden?
   *
   * Nur bei hochgeladenen Schriften: Ihre Kennung ist eine UUID, die genau
   * einmal vergeben wird – dieselbe Adresse liefert für immer dieselben Bytes.
   * Mitgelieferte Kennungen sind laut Vertrag bewusst versionslos und
   * überleben einen Austausch der Datei; `immutable` ließe die alte Datei dann
   * bis zu einem Jahr in den Browsern stehen.
   */
  readonly immutable: boolean;
}

/** Das erzeugte Stylesheet samt Fingerabdruck für den `ETag`. */
export interface FontStylesheet {
  readonly css: string;
  /** SHA-256 des CSS in Hexschreibweise – ändert sich mit jeder Änderung. */
  readonly fingerprint: string;
}

export interface FontService {
  /** Mitgelieferte und hochgeladene Schriften gemeinsam, je als volles DTO. */
  list(ctx: AdminContext): Promise<FontDto[]>;
  /** Datei einer Schrift; `FONT_NOT_FOUND`, wenn Kennung oder Datei fehlen. */
  file(id: string): Promise<FontFileDownload>;
  /**
   * Die `@font-face`-Regeln aller Schriften und die beiden CSS-Variablen der
   * aktuellen Auswahl – **ohne Handelnden**.
   *
   * Kein `AdminContext`, weil das Ergebnis keinen enthält: Es steht nichts
   * darin, was nicht ohnehin jeder sieht, der die Oberfläche aufruft. Genau
   * deshalb kann die Route ohne Sitzung antworten und die Anmeldeseite in der
   * Schrift der Instanz stehen.
   */
  stylesheet(): Promise<FontStylesheet>;
  upload(ctx: AdminContext, input: UploadFontInput, file: UploadedFile): Promise<FontDto>;
  remove(ctx: AdminContext, id: string): Promise<void>;
  /**
   * Gibt es diese Schrift – mit Datei?
   *
   * Für die Instanz-Einstellungen: Was hier `false` ist, lässt sich nicht
   * auswählen (`FONT_NOT_FOUND`). Bewusst dieselbe Bedingung wie für die Liste,
   * damit nie etwas wählbar ist, was die Liste nicht zeigt.
   */
  exists(id: string): Promise<boolean>;
}

/** Die entgegengenommene Datei eines Uploads. */
export interface UploadedFile {
  /** Name, wie ihn der Browser mitgeschickt hat – nur für die Endung benutzt. */
  readonly fileName: string;
  readonly content: Buffer;
}

export interface FontServiceDependencies {
  readonly repository: FontRepository;
  /** Ablage der hochgeladenen Dateien (`FONT_UPLOAD_DIR`). */
  readonly uploads: FontFileStore;
  /** Auslieferungsverzeichnis der mitgelieferten Dateien. */
  readonly bundled: FontFileStore;
  /** Gewählte Schriften – für den Löschschutz `FONT_IN_USE`. */
  readonly selection: FontSelectionSource;
  readonly audit: AuditService;
}

function requireManage(actor: PermissionActor): void {
  if (!hasPermission(actor, MANAGE_PERMISSION)) {
    throw new FontError('PERMISSION_DENIED');
  }
}

/**
 * Der belegte Familienname – ein Wortlaut für beide Wege, auf denen er auffällt.
 *
 * `FONT_FAMILY_TAKEN` (409) und nicht `VALIDATION_FAILED` (400): Die Eingabe ist
 * für sich genommen in Ordnung, ihr steht nur der Bestand entgegen – ein
 * Konflikt, den der Aufrufer ausräumt, wie bei `AUTH_USERNAME_TAKEN`. Die
 * Meldung nennt zusätzlich den Grund, weil die Vorgabemeldung des Katalogs den
 * Namen nicht kennt.
 */
function familyTaken(family: string): FontError {
  return new FontError(
    'FONT_FAMILY_TAKEN',
    `Es gibt bereits eine Schrift mit dem Familiennamen „${family}". Zwei gleichnamige Schriften würden sich in den erzeugten @font-face-Regeln gegenseitig überschreiben.`,
  );
}

/**
 * Gewichtsbereich und Variabilität aus den Formularangaben.
 *
 * Der Vertrag gibt der Datei den Vorrang und dem Formular den zweiten Platz.
 * Das Backend liest aus der Datei derzeit nur die Kopfbytes und **nicht** die
 * `fvar`-Tabelle: Deren Auswertung setzte einen eigenen WOFF2-Entpacker voraus
 * (Brotli-Strom plus das eigene Tabellenverzeichnis des Formats), also einen
 * Parser über fremdbestimmte Daten – eine Abhängigkeit bzw. ein Stück Code
 * dieser Größe wird nicht nebenbei eingeführt (CLAUDE.md §1). Damit zählt hier
 * immer das Formular; fehlt auch das, gilt der Vertragsfall „statisch, 400".
 *
 * `variable` gilt nur zusammen mit einem echten Bereich: Ein Schalter ohne
 * `min < max` ergäbe die Regel `font-weight: 400 400`, die nichts anderes sagt
 * als eine statische Schrift – nur missverständlicher.
 */
export function resolveWeights(input: UploadFontInput): {
  variable: boolean;
  weightRange: FontWeightRange;
} {
  const weightRange = input.weightRange ?? { min: DEFAULT_WEIGHT, max: DEFAULT_WEIGHT };

  return {
    weightRange,
    variable: (input.variable ?? false) && weightRange.min < weightRange.max,
  };
}

function bundledDto(font: BundledFont, sizeBytes: number): FontDto {
  return {
    id: font.id,
    family: font.family,
    label: font.label,
    source: 'bundled',
    format: font.format,
    sizeBytes,
    uploadedAt: null,
    uploadedByDisplayName: null,
    variable: font.variable,
    weightRange: font.weightRange,
    monospace: font.monospace,
    // Nie löschbar: Die Datei liegt im Auslieferungsverzeichnis und wäre nach
    // dem nächsten Aufspielen ohnehin wieder da (`FONT_BUNDLED_PROTECTED`).
    permissions: { canDelete: false },
  };
}

function uploadedDto(
  record: UploadedFontRecord,
  actor: PermissionActor,
  selected: ReadonlySet<string>,
): FontDto {
  return {
    id: record.id,
    family: record.family,
    label: record.label,
    source: 'uploaded',
    format: record.format,
    sizeBytes: record.sizeBytes,
    uploadedAt: record.uploadedAt.toISOString(),
    uploadedByDisplayName: record.uploadedByDisplayName,
    variable: record.variable,
    weightRange: { min: record.weightMin, max: record.weightMax },
    monospace: record.monospace,
    permissions: {
      canDelete: hasPermission(actor, MANAGE_PERMISSION) && !selected.has(record.id),
    },
  };
}

export function createFontService(deps: FontServiceDependencies): FontService {
  /**
   * Mitgelieferte Schriften, deren Datei tatsächlich vorhanden ist.
   *
   * Ein Katalogeintrag ohne Datei wird übergangen. Die Alternative – ihn
   * trotzdem zu zeigen – hieße, der Oberfläche eine Schrift anzubieten, die
   * beim Laden stumm bleibt; die Auswahl stünde dann auf einer Kennung, die nie
   * eine Datei bekommt.
   */
  async function verfuegbareMitgelieferte(): Promise<{ font: BundledFont; sizeBytes: number }[]> {
    const treffer: { font: BundledFont; sizeBytes: number }[] = [];

    for (const font of BUNDLED_FONTS) {
      const sizeBytes = await deps.bundled.size(font.fileName);

      if (sizeBytes !== null) {
        treffer.push({ font, sizeBytes });
      }
    }

    return treffer;
  }

  async function gewaehlte(): Promise<ReadonlySet<string>> {
    return new Set(await deps.selection.selectedFontIds());
  }

  return {
    async list(ctx) {
      const [mitgeliefert, hochgeladen, selected] = await Promise.all([
        verfuegbareMitgelieferte(),
        deps.repository.list(),
        gewaehlte(),
      ]);

      return [
        ...mitgeliefert.map(({ font, sizeBytes }) => bundledDto(font, sizeBytes)),
        ...hochgeladen.map((record) => uploadedDto(record, ctx.actor, selected)),
      ];
    },

    async stylesheet() {
      const [mitgeliefert, hochgeladen, auswahl] = await Promise.all([
        verfuegbareMitgelieferte(),
        deps.repository.list(),
        deps.selection.selectedFontRoles(),
      ]);

      const schriften: StylesheetFont[] = [
        ...mitgeliefert.map(({ font }) => ({
          id: font.id,
          family: font.family,
          format: font.format,
          variable: font.variable,
          weightRange: font.weightRange,
        })),
        ...hochgeladen.map((record) => ({
          id: record.id,
          family: record.family,
          format: record.format,
          variable: record.variable,
          weightRange: { min: record.weightMin, max: record.weightMax },
        })),
      ];

      const css = buildFontStylesheet(schriften, auswahl);

      return { css, fingerprint: createHash('sha256').update(css).digest('hex') };
    },

    async file(id) {
      if (isBundledFontId(id)) {
        const font = findBundledFont(id);
        const content = font === null ? null : await deps.bundled.read(font.fileName);

        if (font === null || content === null) {
          throw new FontError('FONT_NOT_FOUND');
        }

        return {
          fileName: font.fileName,
          mimeType: FONT_FORMAT_CATALOG[font.format].mimeType,
          content,
          fingerprint: createHash('sha256').update(content).digest('hex'),
          immutable: false,
        };
      }

      const record = await deps.repository.findById(id);
      const dateiname = record === null ? null : fontFileName(record.id, record.format);
      const content = dateiname === null ? null : await deps.uploads.read(dateiname);

      if (record === null || dateiname === null || content === null) {
        throw new FontError('FONT_NOT_FOUND');
      }

      return {
        fileName: dateiname,
        mimeType: FONT_FORMAT_CATALOG[record.format].mimeType,
        content,
        fingerprint: record.sha256,
        immutable: true,
      };
    },

    async upload(ctx, input, file) {
      requireManage(ctx.actor);

      // Format und Größe zuerst: Was keine brauchbare Schrift ist, soll auch
      // keine Namensprüfung und keinen Schreibvorgang auslösen.
      const format = resolveFontUpload(file.fileName, file.content);

      const belegtMitgeliefert = BUNDLED_FONTS.some(
        (font) => font.family.toLowerCase() === input.family.toLowerCase(),
      );

      if (belegtMitgeliefert || (await deps.repository.findByFamily(input.family)) !== null) {
        throw familyTaken(input.family);
      }

      const { variable, weightRange } = resolveWeights(input);
      const id = randomUUID();
      const dateiname = fontFileName(id, format);
      const sha256 = createHash('sha256').update(file.content).digest('hex');

      await deps.uploads.write(dateiname, file.content);

      let record: UploadedFontRecord;

      try {
        record = await deps.repository.create({
          id,
          family: input.family,
          label: input.label,
          format,
          sizeBytes: file.content.length,
          variable,
          // Angabe des Hochladenden; fehlt sie, gilt „proportional" (Vertrag).
          monospace: input.monospace ?? false,
          weightMin: weightRange.min,
          weightMax: weightRange.max,
          sha256,
          uploadedById: ctx.userId,
          uploadedByDisplayName: ctx.displayName,
        });
      } catch (error: unknown) {
        // Ohne Datensatz ist die Datei nicht erreichbar und nicht löschbar –
        // sie würde für immer im Ablageort liegen bleiben.
        await deps.uploads.remove(dateiname);

        /*
         * Zwei gleichzeitige Uploads desselben Familiennamens (zwei
         * Administratoren, oder ein zweiter Anlauf auf einen hängenden ersten):
         * Beide finden über `findByFamily` nichts, den zweiten Insert fängt
         * `uploaded_fonts_family_lower_idx`. Zwischen Prüfung und Schreiben
         * liegt keine Transaktion – genau der Fall, für den `isUniqueViolation`
         * da ist (`db/errors.ts`, Audit W2-9). Ohne diesen Zweig käme der
         * fachlich benannte Konflikt als `INTERNAL_ERROR` (500) zurück, obwohl
         * die Vorprüfung denselben Fall mit 409 beantwortet.
         */
        if (isUniqueViolation(error)) {
          throw familyTaken(input.family);
        }

        throw error;
      }

      await deps.audit.record(
        entryFor(ctx, {
          action: 'font.uploaded',
          targetType: 'font',
          targetId: record.id,
          metadata: {
            family: record.family,
            label: record.label,
            format: record.format,
            sizeBytes: record.sizeBytes,
            variable: record.variable,
            monospace: record.monospace,
          },
        }),
      );

      return uploadedDto(record, ctx.actor, await gewaehlte());
    },

    async remove(ctx, id) {
      requireManage(ctx.actor);

      if (isBundledFontId(id)) {
        // Eine formal mitgelieferte, aber unbekannte Kennung ist nicht
        // „geschützt", sondern schlicht nicht vorhanden (Vertrag zu
        // `isBundledFontId`).
        throw new FontError(
          findBundledFont(id) === null ? 'FONT_NOT_FOUND' : 'FONT_BUNDLED_PROTECTED',
        );
      }

      const record = await deps.repository.findById(id);

      if (record === null) {
        throw new FontError('FONT_NOT_FOUND');
      }

      if ((await gewaehlte()).has(id)) {
        throw new FontError('FONT_IN_USE');
      }

      /*
       * Erst die Datei, dann der Datensatz. Eine bereits fehlende Datei ist kein
       * Fehler (`remove` löscht mit `force`), ein echter Schreibfehler dagegen
       * schlägt fehl, **bevor** die Zeile weg ist – der Aufruf lässt sich dann
       * unverändert wiederholen. In der umgekehrten Reihenfolge bliebe eine
       * Datei ohne Datensatz zurück, die niemand mehr zuordnen kann.
       */
      await deps.uploads.remove(fontFileName(record.id, record.format));
      await deps.repository.remove(record.id);

      await deps.audit.record(
        entryFor(ctx, {
          action: 'font.deleted',
          targetType: 'font',
          targetId: record.id,
          metadata: { family: record.family, label: record.label, format: record.format },
        }),
      );
    },

    async exists(id) {
      if (isBundledFontId(id)) {
        const font = findBundledFont(id);

        return font !== null && (await deps.bundled.size(font.fileName)) !== null;
      }

      return (await deps.repository.findById(id)) !== null;
    },
  };
}
