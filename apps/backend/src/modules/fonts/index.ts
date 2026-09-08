/**
 * S-2 – Schriften der Oberfläche (Backend-Hälfte).
 *
 * Die Oberfläche liefert ihre Schriften aus der eigenen Instanz aus statt sie
 * zur Laufzeit von Google zu laden, und der Betreiber kann weitere hochladen
 * und auswählen. Das Feature steht in keinem der beiden Hefte – es ist eine
 * Anforderung des Betreibers (Datenschutz) und im PR dokumentiert.
 *
 * Aufteilung:
 * - `bundled.ts` – Katalog der mitgelieferten Schriften und ihr Ablageort
 * - `format.ts` – Formaterkennung an den Kopfbytes
 * - `storage.ts` – Ablage der Dateien im Dateisystem (Port + Umsetzung)
 * - `repository.ts` – Tabelle `uploaded_fonts` (Port + Drizzle)
 * - `service.ts` – die Regeln: Liste, Auslieferung, Upload, Löschschutz
 * - `routes.ts` – HTTP
 *
 * Für andere Arbeitspakete relevant: {@link FontService.exists} – daran prüfen
 * die Instanz-Einstellungen die gewählte Kennung (`FONT_NOT_FOUND`).
 */

import type { Database } from '../../db/index.js';
import type { AuditService } from '../admin/index.js';
import { bundledFontDirectory } from './bundled.js';
import { createDrizzleFontRepository } from './repository.js';
import { type FontSelectionSource, type FontService, createFontService } from './service.js';
import { createNodeFontFileStore, defaultFontUploadDirectory } from './storage.js';

export {
  type BundledFont,
  BUNDLED_FONTS,
  DEFAULT_MONOSPACE_FONT_ID,
  DEFAULT_UI_FONT_ID,
  bundledFontDirectory,
  findBundledFont,
} from './bundled.js';
export { FontError, isFontError } from './errors.js';
export {
  type FontSignatureMatch,
  detectFontSignature,
  fontFormatForFileName,
  resolveFontUpload,
} from './format.js';
export {
  type CreateUploadedFontData,
  type FontRepository,
  type UploadedFontRecord,
  createDrizzleFontRepository,
} from './repository.js';
export { type FontRouteOptions, registerFontRoutes } from './routes.js';
export {
  type FontFileDownload,
  type FontSelectionSource,
  type FontService,
  type FontServiceDependencies,
  type FontStylesheet,
  type UploadedFile,
  createFontService,
  resolveWeights,
} from './service.js';
export {
  type FontRoleSelection,
  type StylesheetFont,
  FONT_FILE_ROUTE_PATH,
  FONT_STYLESHEET_ROUTE_PATH,
  MONOSPACE_FONT_CSS_VARIABLE,
  UI_FONT_CSS_VARIABLE,
  buildFontStylesheet,
  cssQuotedString,
  cssUrl,
  fontFileHref,
} from './stylesheet.js';
export {
  type FontFileStore,
  createNodeFontFileStore,
  defaultFontUploadDirectory,
  fontFileName,
  resolveInside,
} from './storage.js';

export interface FontModuleOptions {
  readonly db: Database;
  /**
   * Ablageort der hochgeladenen Dateien (`FONT_UPLOAD_DIR`, .env.example
   * Abschnitt 18). Ohne Angabe die Vorgabe aus {@link defaultFontUploadDirectory}.
   */
  readonly uploadDir?: string | undefined;
  /** Auslieferungsverzeichnis der mitgelieferten Schriften; nur für Tests nötig. */
  readonly bundledDir?: string | undefined;
  /** Gewählte Schriften – für den Löschschutz `FONT_IN_USE`. */
  readonly selection: FontSelectionSource;
  readonly audit: AuditService;
}

export interface FontModule {
  readonly service: FontService;
}

export function createFontModule(options: FontModuleOptions): FontModule {
  return {
    service: createFontService({
      repository: createDrizzleFontRepository(options.db),
      uploads: createNodeFontFileStore(options.uploadDir ?? defaultFontUploadDirectory()),
      bundled: createNodeFontFileStore(options.bundledDir ?? bundledFontDirectory()),
      selection: options.selection,
      audit: options.audit,
    }),
  };
}
