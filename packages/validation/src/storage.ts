/**
 * Zod-Schemas zur Speicherverwaltung (Lastenheft §3.8, Pflichtenheft §16).
 *
 * Zwei Richtungen:
 * - `getStorageBreakdownResultSchema` prüft, was der **Agent** meldet, bevor
 *   das Backend es zwischenspeichert. Der Agent läuft auf einer anderen
 *   Maschine; sein Ergebnis ist Eingabe wie jede andere.
 * - Die übrigen Schemas prüfen Requests aus der Admin-Oberfläche.
 */

import { STORAGE_ENTRY_KINDS } from '@palantir/contracts';
import { z } from 'zod';
import { idSchema } from './common.js';
import { isoTimestampSchema } from './agent-protocol.js';

export const storageEntryKindSchema = z.enum(STORAGE_ENTRY_KINDS);

/** Kategorien, die der Agent selbst vergeben kann (ohne `other`). */
export const agentStorageEntryKindSchema = z.enum([
  'serverData',
  'backup',
  'dockerImage',
  'orphaned',
]);

const byteSizeSchema = z.number().int().nonnegative();

/** Ein Posten der Speicherübersicht, wie der Agent ihn meldet. */
export const agentStorageEntrySchema = z.object({
  kind: agentStorageEntryKindSchema,
  path: z.string().min(1).nullable(),
  sizeBytes: byteSizeSchema,
  serverId: idSchema.nullable(),
  backupFileName: z.string().min(1).nullable(),
  imageId: z.string().min(1).nullable(),
  imageTag: z.string().min(1).nullable(),
  inUse: z.boolean(),
  lastModifiedAt: isoTimestampSchema.nullable(),
});

/** Nutzlast des Agent-Befehls `GET_STORAGE_BREAKDOWN`. */
export const getStorageBreakdownPayloadSchema = z.object({
  includeImages: z.boolean().optional(),
});

/** Ergebnis des Agent-Befehls `GET_STORAGE_BREAKDOWN`. */
export const getStorageBreakdownResultSchema = z.object({
  scannedAt: isoTimestampSchema,
  totalBytes: byteSizeSchema,
  usedBytes: byteSizeSchema,
  freeBytes: byteSizeSchema,
  entries: z.array(agentStorageEntrySchema),
});

/** Anfrage, einen neuen Scan anzustoßen (Scan on demand, Pflichtenheft §16). */
export const startStorageScanInputSchema = z.object({
  includeImages: z.boolean().default(true),
});

/**
 * Anfrage, einen Eintrag zu löschen.
 *
 * Die `entryId` ist die Kennung aus dem zwischengespeicherten Scan. Ob der
 * Eintrag überhaupt gelöscht werden darf, entscheidet das Backend – ein
 * Datenordner eines aktiven Servers wird hier mit
 * `STORAGE_ENTRY_NOT_DELETABLE` abgelehnt (Lastenheft §3.8).
 */
export const deleteStorageEntryInputSchema = z.object({
  entryId: z.string().trim().min(1).max(400),
});

export type AgentStorageEntryInput = z.infer<typeof agentStorageEntrySchema>;
export type GetStorageBreakdownResult = z.infer<typeof getStorageBreakdownResultSchema>;
export type StartStorageScanInput = z.infer<typeof startStorageScanInputSchema>;
export type DeleteStorageEntryInput = z.infer<typeof deleteStorageEntryInputSchema>;
