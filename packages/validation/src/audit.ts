/**
 * Zod-Schemas zum Audit-Log (Pflichtenheft §6).
 *
 * Es gibt hier bewusst **kein** Update- oder Delete-Schema: Das Log ist
 * append-only (CLAUDE.md §2). Geprüft werden ausschließlich die Filter der
 * Leseabfrage und die Nutzlast eines neuen Eintrags.
 */

import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@palantir/contracts';
import { z } from 'zod';
import { idSchema } from './common.js';
import { isoTimestampSchema } from './agent-protocol.js';

export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export const auditTargetTypeSchema = z.enum(AUDIT_TARGET_TYPES);

/**
 * Zusatzangaben eines Eintrags.
 *
 * Bewusst offen typisiert (`unknown` je Schlüssel): Was zu einer Aktion
 * festgehalten wird, unterscheidet sich je Arbeitspaket. Verboten ist nur
 * Unstrukturiertes an der Stelle der benannten Felder – die Aktion selbst
 * bleibt ein Wert aus dem Katalog.
 */
export const auditMetadataSchema = z.record(z.unknown());

/** Nutzlast eines neuen Eintrags (nur Anhängen, nie Ändern). */
export const appendAuditEntryInputSchema = z.object({
  action: auditActionSchema,
  actorId: idSchema.nullish(),
  actorDisplayName: z.string().trim().max(100).nullish(),
  targetType: auditTargetTypeSchema.nullish(),
  targetId: z.string().trim().max(200).nullish(),
  ipHint: z.string().trim().max(64).nullish(),
  metadata: auditMetadataSchema.default({}),
});

/**
 * Filter der Audit-Log-Abfrage (F10).
 *
 * Das Log wächst dauerhaft, deshalb ist die Seitengröße nach oben begrenzt und
 * hat einen Standardwert – eine Abfrage ohne Limit gibt es nicht.
 */
export const auditLogQuerySchema = z
  .object({
    action: auditActionSchema.optional(),
    actorId: idSchema.optional(),
    targetType: auditTargetTypeSchema.optional(),
    targetId: z.string().trim().max(200).optional(),
    /** Nur Einträge ab diesem Zeitpunkt (einschließlich). */
    from: isoTimestampSchema.optional(),
    /** Nur Einträge bis zu diesem Zeitpunkt (einschließlich). */
    to: isoTimestampSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  /*
   * Zeitvergleich, kein Zeichenkettenvergleich (contracts-validation-07).
   *
   * `isoTimestampSchema` erlaubt Zonen-Offsets ausdrücklich (`offset: true`).
   * Damit fallen lexikographische und chronologische Reihenfolge auseinander:
   * `2026-01-01T10:00:00+02:00` ist 08:00 UTC und liegt damit **vor**
   * `2026-01-01T09:00:00Z`, steht als Zeichenkette aber dahinter. Ein
   * `from <= to` auf den Rohtexten hätte den einen Zeitraum fälschlich
   * abgelehnt und den umgekehrten fälschlich durchgelassen.
   *
   * Beide Werte sind an dieser Stelle bereits als ISO-8601 geprüft, `Date.parse`
   * liefert deshalb immer eine Zahl und nie `NaN`.
   */
  .refine(
    (input) =>
      input.from === undefined ||
      input.to === undefined ||
      Date.parse(input.from) <= Date.parse(input.to),
    {
      // Gleiche Zeitpunkte sind zulässig – der Zeitraum ist beidseitig
      // einschließlich, ein Punkt-Zeitraum ergibt also Sinn.
      message: 'Der Anfangszeitpunkt darf nicht nach dem Endzeitpunkt liegen.',
      path: ['to'],
    },
  );

export type AppendAuditEntryInput = z.infer<typeof appendAuditEntryInputSchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
