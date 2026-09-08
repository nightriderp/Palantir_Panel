/**
 * Persistenz der hochgeladenen Schriften (Arbeitspaket S-2).
 *
 * Wie in den übrigen Modulen liegt die Datenbank hinter einem Port: Der Dienst
 * kennt nur {@link FontRepository}, und die Regeln lassen sich mit einer
 * Attrappe prüfen (CLAUDE.md §4). Die mitgelieferten Schriften kommen **nicht**
 * hierher – sie stehen in `bundled.ts`.
 */

import { type FontFormat } from '@palantir/contracts';
import { eq, sql } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { uploadedFonts } from '../../db/schema.js';

/** Eine hochgeladene Schrift, wie sie in der Datenbank steht. */
export interface UploadedFontRecord {
  readonly id: string;
  readonly family: string;
  readonly label: string;
  readonly format: FontFormat;
  readonly sizeBytes: number;
  readonly variable: boolean;
  /** Dicktengleich – Angabe des Hochladenden, siehe `FontDto.monospace`. */
  readonly monospace: boolean;
  readonly weightMin: number;
  readonly weightMax: number;
  readonly sha256: string;
  readonly uploadedAt: Date;
  readonly uploadedById: string | null;
  readonly uploadedByDisplayName: string | null;
}

/** Angaben für einen neuen Datensatz; die Kennung vergibt der Dienst. */
export interface CreateUploadedFontData {
  readonly id: string;
  readonly family: string;
  readonly label: string;
  readonly format: FontFormat;
  readonly sizeBytes: number;
  readonly variable: boolean;
  readonly monospace: boolean;
  readonly weightMin: number;
  readonly weightMax: number;
  readonly sha256: string;
  readonly uploadedById: string | null;
  readonly uploadedByDisplayName: string | null;
}

export interface FontRepository {
  /** Alle hochgeladenen Schriften, älteste zuerst. */
  list(): Promise<UploadedFontRecord[]>;
  findById(id: string): Promise<UploadedFontRecord | null>;
  /**
   * Sucht nach dem Familiennamen ohne Rücksicht auf Groß-/Kleinschreibung –
   * genauso, wie der Unique-Index vergleicht und wie CSS Familiennamen sieht.
   */
  findByFamily(family: string): Promise<UploadedFontRecord | null>;
  create(data: CreateUploadedFontData): Promise<UploadedFontRecord>;
  /** Entfernt den Datensatz; liefert `false`, wenn es ihn nicht mehr gab. */
  remove(id: string): Promise<boolean>;
}

type Row = typeof uploadedFonts.$inferSelect;

function toRecord(row: Row): UploadedFontRecord {
  return {
    id: row.id,
    family: row.family,
    label: row.label,
    format: row.format,
    sizeBytes: row.sizeBytes,
    variable: row.variable,
    monospace: row.monospace,
    weightMin: row.weightMin,
    weightMax: row.weightMax,
    sha256: row.sha256,
    uploadedAt: row.uploadedAt,
    uploadedById: row.uploadedById,
    uploadedByDisplayName: row.uploadedByDisplayName,
  };
}

export function createDrizzleFontRepository(db: DbConnection): FontRepository {
  return {
    async list() {
      const rows = await db.select().from(uploadedFonts).orderBy(uploadedFonts.uploadedAt);

      return rows.map(toRecord);
    },

    async findById(id) {
      const [row] = await db.select().from(uploadedFonts).where(eq(uploadedFonts.id, id)).limit(1);

      return row ? toRecord(row) : null;
    },

    async findByFamily(family) {
      const [row] = await db
        .select()
        .from(uploadedFonts)
        .where(sql`lower(${uploadedFonts.family}) = lower(${family})`)
        .limit(1);

      return row ? toRecord(row) : null;
    },

    async create(data) {
      const [row] = await db
        .insert(uploadedFonts)
        .values({
          id: data.id,
          family: data.family,
          label: data.label,
          format: data.format,
          sizeBytes: data.sizeBytes,
          variable: data.variable,
          monospace: data.monospace,
          weightMin: data.weightMin,
          weightMax: data.weightMax,
          sha256: data.sha256,
          uploadedById: data.uploadedById,
          uploadedByDisplayName: data.uploadedByDisplayName,
        })
        .returning();

      if (!row) {
        throw new Error('Der Datensatz der Schrift konnte nicht angelegt werden.');
      }

      return toRecord(row);
    },

    async remove(id) {
      const rows = await db
        .delete(uploadedFonts)
        .where(eq(uploadedFonts.id, id))
        .returning({ id: uploadedFonts.id });

      return rows.length > 0;
    },
  };
}
