import {
  FONT_FORMAT_CATALOG,
  type FontDto,
  type FontFormat,
  type FontSource,
} from '@palantir/contracts';
import { type ApiResult, errorText, isTransportFailure } from '@/lib/api/client';
import { formatBytes } from '@/components/shared';

/**
 * Beschriftungen und Fehlermeldungen der Schriftverwaltung (Arbeitspaket S-3).
 *
 * Übersetzt wird **anhand des Fehlercodes**, nie anhand des Freitexts aus dem
 * Envelope – derselbe Grundsatz wie in `lib/auth/errors.ts`. Die Sätze hier
 * sind bewusst näher am Formular als die Vorgabemeldungen des Katalogs: Wer
 * gerade eine Datei ausgewählt hat, soll erfahren, was er anders machen kann,
 * und nicht nur, dass etwas nicht ging.
 */

/** Größte über alle Formate erlaubte Datei – für den Hinweis im Formular. */
const GROESSTE_DATEI = Math.max(
  ...Object.values(FONT_FORMAT_CATALOG).map((definition) => definition.maxSizeBytes),
);

/** Anzeigename eines Formats. */
export const FONT_FORMAT_LABELS: Record<FontFormat, string> = {
  woff2: 'WOFF2',
  woff: 'WOFF',
  ttf: 'TrueType',
  otf: 'OpenType',
};

/** Anzeigename der Herkunft. */
export const FONT_SOURCE_LABELS: Record<FontSource, string> = {
  bundled: 'Mitgeliefert',
  uploaded: 'Hochgeladen',
};

/** Die erlaubten Endungen als Aufzählung, z. B. für `accept` am Dateifeld. */
export const FONT_ACCEPT_EXTENSIONS = Object.values(FONT_FORMAT_CATALOG)
  .map((definition) => definition.extension)
  .join(',');

/**
 * Fehlermeldungen der Schriftverwaltung.
 *
 * Nur die Codes, für die die Verwaltung mehr weiß als der Katalog. Alles andere
 * (Berechtigung, Netz, Sitzung) läuft weiter über {@link errorText}.
 */
const FONT_FEHLERTEXTE: Partial<Record<string, string>> = {
  FONT_FILE_TOO_LARGE: `Die Datei ist zu groß – erlaubt sind höchstens ${formatBytes(
    GROESSTE_DATEI,
  )}, je nach Format auch weniger. Ein als WOFF2 komprimierter Schnitt bleibt fast immer deutlich darunter.`,
  FONT_FORMAT_UNSUPPORTED:
    'Dieses Dateiformat wird nicht unterstützt. Erlaubt sind WOFF2, WOFF, TTF und OTF.',
  FONT_FILE_INVALID:
    'Der Inhalt der Datei passt nicht zu ihrer Endung – sie ist keine lesbare Schrift. Bitte lade die Originaldatei der Schrift hoch, nicht ein umbenanntes Archiv.',
  FONT_FAMILY_TAKEN:
    'Diesen Familiennamen gibt es schon. Zwei gleichnamige Schriften würden sich in den erzeugten CSS-Regeln gegenseitig überschreiben – bitte wähle einen anderen Namen.',
  FONT_BUNDLED_PROTECTED:
    'Mitgelieferte Schriften lassen sich nicht löschen – sie gehören zur Instanz und wären nach der nächsten Aktualisierung ohnehin wieder da.',
  FONT_IN_USE:
    'Diese Schrift ist gerade ausgewählt. Wähle für ihre Rolle zuerst eine andere Schrift, dann lässt sie sich löschen.',
  FONT_NOT_FOUND:
    'Diese Schrift gibt es nicht mehr. Lade die Ansicht neu, um den aktuellen Bestand zu sehen.',
};

/** Anzeigetext zu einem fehlgeschlagenen Aufruf der Schriftverwaltung. */
export function fontErrorMessage<T>(result: ApiResult<T>): string {
  if (result.success) return '';
  if (isTransportFailure(result)) return result.error.message;

  return FONT_FEHLERTEXTE[result.error.code] ?? errorText(result);
}

/** Abgedeckte Gewichte als Text – „100–800 (variabel)" oder „400". */
export function weightRangeLabel(font: FontDto): string {
  if (font.variable && font.weightRange.min < font.weightRange.max) {
    return `${font.weightRange.min}–${font.weightRange.max} (variabel)`;
  }

  return String(font.weightRange.min);
}

/**
 * Warum der Löschknopf fehlt.
 *
 * `permissions.canDelete` sagt nur, **dass** nicht gelöscht werden darf – eine
 * Schaltfläche, die sicher scheitert, gehört gar nicht erst angeboten. Der
 * Grund gehört trotzdem sichtbar daneben, sonst rätselt der Betreiber.
 */
export function deleteBlockedReason(font: FontDto, selected: boolean): string | null {
  if (font.permissions.canDelete) return null;
  if (font.source === 'bundled') return 'Mitgeliefert – nicht löschbar';
  if (selected) return 'Ausgewählt – erst abwählen';

  return null;
}
