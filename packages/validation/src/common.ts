/**
 * Gemeinsame Basis-Schemas, die alle Arbeitspakete brauchen.
 *
 * Hier steht bewusst nichts Fachliches – Entitäts- und Request-Schemas bringt
 * jedes Arbeitspaket selbst mit, zusammen mit dem passenden Typ aus
 * `@palantir/contracts` (CLAUDE.md §3).
 */

import { z } from 'zod';

/**
 * ID-Format aller Entitäten (Pflichtenheft §6).
 *
 * Festlegung dieser Sitzung: UUID (Version 4), erzeugt von der Datenbank.
 * Das Pflichtenheft nennt nur das Feld `id` ohne Format; die Wahl fällt hier
 * einmal zentral, damit nicht jedes Paket ein eigenes Format erfindet.
 */
export const idSchema = z.string().uuid({ message: 'Ungültige ID (erwartet wird eine UUID).' });

export type Id = z.infer<typeof idSchema>;
