/**
 * Attrappen für die Tests der Schriftverwaltung (Arbeitspaket S-2).
 *
 * Alle Regeln des Moduls sind ohne PostgreSQL und ohne Platte prüfbar
 * (CLAUDE.md §4) – dafür stehen Repository und Ablage hinter Ports. Die Datei
 * liegt neben dem Modul, wie `admin/test-support.ts`.
 */

import { type FontFormat } from '@palantir/contracts';
import {
  type CreateUploadedFontData,
  type FontRepository,
  type UploadedFontRecord,
} from './repository.js';
import { type FontSelectionSource } from './service.js';
import { type FontFileStore, resolveInside } from './storage.js';

export const UPLOADED_FONT_ID = '44444444-4444-4444-8444-444444444444';

/** Ein hochgeladener Datensatz mit brauchbaren Vorgaben. */
export function uploadedFontRecord(
  overrides: Partial<UploadedFontRecord> = {},
): UploadedFontRecord {
  return {
    id: UPLOADED_FONT_ID,
    family: 'Atkinson Hyperlegible',
    label: 'Atkinson Hyperlegible',
    format: 'woff2',
    sizeBytes: 1024,
    variable: false,
    monospace: false,
    weightMin: 400,
    weightMax: 400,
    sha256: 'a'.repeat(64),
    uploadedAt: new Date('2026-01-02T03:04:05.000Z'),
    uploadedById: null,
    uploadedByDisplayName: 'Test-Admin',
    ...overrides,
  };
}

export interface FakeFontRepository extends FontRepository {
  readonly rows: UploadedFontRecord[];
}

export function createFakeFontRepository(seed: UploadedFontRecord[] = []): FakeFontRepository {
  const rows: UploadedFontRecord[] = [...seed];

  return {
    rows,

    async list() {
      return [...rows];
    },

    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },

    async findByFamily(family) {
      // Wie der Unique-Index: ohne Rücksicht auf Groß-/Kleinschreibung.
      return rows.find((row) => row.family.toLowerCase() === family.toLowerCase()) ?? null;
    },

    async create(data: CreateUploadedFontData) {
      const record: UploadedFontRecord = { ...data, uploadedAt: new Date('2026-02-03T00:00:00Z') };
      rows.push(record);

      return record;
    },

    async remove(id) {
      const index = rows.findIndex((row) => row.id === id);

      if (index < 0) {
        return false;
      }

      rows.splice(index, 1);

      return true;
    },
  };
}

export interface FakeFontFileStore extends FontFileStore {
  readonly files: Map<string, Buffer>;
}

/**
 * Ablage im Arbeitsspeicher.
 *
 * Prüft die Dateinamen mit **derselben** Funktion wie die echte Ablage
 * ({@link resolveInside}): Ein Test, der einen Ausbruch versucht, soll hier
 * genauso scheitern wie auf der Platte.
 */
export function createFakeFontFileStore(
  seed: Record<string, Buffer | string> = {},
): FakeFontFileStore {
  const files = new Map<string, Buffer>(
    Object.entries(seed).map(([name, inhalt]) => [
      name,
      typeof inhalt === 'string' ? Buffer.from(inhalt) : inhalt,
    ]),
  );

  const pruefe = (fileName: string): string => {
    resolveInside('/attrappe', fileName);

    return fileName;
  };

  return {
    files,

    async write(fileName, content) {
      files.set(pruefe(fileName), content);
    },

    async read(fileName) {
      return files.get(pruefe(fileName)) ?? null;
    },

    async size(fileName) {
      return files.get(pruefe(fileName))?.length ?? null;
    },

    async remove(fileName) {
      files.delete(pruefe(fileName));
    },
  };
}

/**
 * Gewählte Schriften – der Löschschutz fragt genau hier nach.
 *
 * Die Rollen ergeben sich der Reihe nach (erste Kennung = Oberfläche, zweite =
 * dicktengleich). Für Tests, die es auf die Rollen anlegt, gibt es
 * {@link roleSelection}.
 */
export function fixedSelection(...ids: string[]): FontSelectionSource {
  return {
    selectedFontIds: async () => ids,
    selectedFontRoles: async () => ({
      uiFontId: ids[0] ?? null,
      monospaceFontId: ids[1] ?? null,
    }),
  };
}

/** Auswahl mit ausdrücklich benannten Rollen – für das erzeugte Stylesheet. */
export function roleSelection(
  uiFontId: string | null,
  monospaceFontId: string | null,
): FontSelectionSource {
  return {
    selectedFontIds: async () =>
      [uiFontId, monospaceFontId].filter((id): id is string => id !== null),
    selectedFontRoles: async () => ({ uiFontId, monospaceFontId }),
  };
}

/**
 * Kopfbytes einer gültigen Datei des Formats plus Füllung.
 *
 * Bewusst über die Kennwerte gebaut und nicht als Testdatei abgelegt: Geprüft
 * werden soll die Erkennung, nicht ob eine mitgelieferte Datei noch da ist.
 */
export function fontBytes(format: FontFormat | 'ttc' | 'zip', fuellung = 16): Buffer {
  const kopf: Record<string, Buffer> = {
    woff2: Buffer.from('wOF2', 'latin1'),
    woff: Buffer.from('wOFF', 'latin1'),
    otf: Buffer.from('OTTO', 'latin1'),
    ttf: Buffer.from([0x00, 0x01, 0x00, 0x00]),
    ttc: Buffer.from('ttcf', 'latin1'),
    zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  };

  const gewaehlt = kopf[format];

  if (gewaehlt === undefined) {
    throw new Error(`Unbekannter Kennwert: ${format}`);
  }

  return Buffer.concat([gewaehlt, Buffer.alloc(fuellung, 0x2a)]);
}
