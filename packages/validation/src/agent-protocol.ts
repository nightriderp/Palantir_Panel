/**
 * Zod-Gegenstück zum Agent-Protokoll aus `@palantir/contracts`
 * (Pflichtenheft §2.2 und §5.3).
 *
 * Der Agent vertraut keinem eingehenden Frame blind, sondern prüft ihn gegen
 * `backendToAgentFrameSchema`; das Backend prüft umgekehrt gegen
 * `agentToBackendFrameSchema`. Beide Seiten laufen zwar durch den
 * WireGuard-Tunnel, aber Formatprüfung ist unabhängig davon nötig – ein
 * fehlerhafter Frame darf nicht als halb verstandener Befehl ausgeführt werden.
 */

import {
  AGENT_COMMANDS,
  AGENT_CONTAINER_STATUSES,
  AGENT_EVENTS,
  type BackendToAgentFrame,
} from '@palantir/contracts';
import { z } from 'zod';
import { idSchema } from './common.js';
import { apiResponseSchema } from './envelope.js';

/**
 * Korrelations-ID (Pflichtenheft §2.2) – dasselbe UUID-Format wie alle
 * Entitäts-IDs, damit nicht zwei ID-Formate nebeneinander existieren.
 */
export const correlationIdSchema = idSchema;

/** Zeitstempel im Protokoll sind durchgehend ISO-8601-Strings. */
export const isoTimestampSchema = z
  .string()
  .datetime({ offset: true, message: 'Zeitstempel muss ISO-8601 sein.' });

export const agentCommandNameSchema = z.enum(AGENT_COMMANDS);
export const agentEventNameSchema = z.enum(AGENT_EVENTS);
export const agentContainerStatusSchema = z.enum(AGENT_CONTAINER_STATUSES);

export const agentContainerStateSchema = z.object({
  serverId: idSchema.nullable(),
  containerId: z.string().min(1),
  status: agentContainerStatusSchema,
  exitCode: z.number().int().nullable(),
  startedAt: isoTimestampSchema.nullable(),
  observedAt: isoTimestampSchema,
});

// ---------------------------------------------------------------------------
// Backend -> Agent
// ---------------------------------------------------------------------------

export const backendWelcomeFrameSchema = z.object({
  kind: z.literal('welcome'),
  protocolVersion: z.number().int().positive(),
  sentAt: isoTimestampSchema,
});

export const backendCommandFrameSchema = z.object({
  kind: z.literal('command'),
  correlationId: correlationIdSchema,
  command: agentCommandNameSchema,
  serverId: idSchema.nullable(),
  payload: z.unknown(),
  issuedAt: isoTimestampSchema,
});

export const backendStateRequestFrameSchema = z.object({
  kind: z.literal('stateRequest'),
  requestedAt: isoTimestampSchema,
});

export const backendToAgentFrameSchema = z.discriminatedUnion('kind', [
  backendWelcomeFrameSchema,
  backendCommandFrameSchema,
  backendStateRequestFrameSchema,
]) satisfies z.ZodType<BackendToAgentFrame, z.ZodTypeDef, unknown>;

// ---------------------------------------------------------------------------
// Agent -> Backend
// ---------------------------------------------------------------------------

export const agentHelloFrameSchema = z.object({
  kind: z.literal('hello'),
  protocolVersion: z.number().int().positive(),
  agentVersion: z.string().min(1),
  /** Node-Kennung, falls der Agent sie kennt – additiv, siehe Contracts. */
  nodeId: idSchema.nullish(),
  sentAt: isoTimestampSchema,
});

export const agentNodeStatsSchema = z.object({
  cpuCores: z.number().int().positive(),
  cpuLoad1m: z.number().nonnegative().nullable(),
  ramTotalMb: z.number().nonnegative(),
  ramAvailableMb: z.number().nonnegative(),
  diskTotalMb: z.number().nonnegative(),
  diskAvailableMb: z.number().nonnegative(),
  observedAt: isoTimestampSchema,
});

export const agentStateReportFrameSchema = z.object({
  kind: z.literal('stateReport'),
  reason: z.enum(['connected', 'requested']),
  containers: z.array(agentContainerStateSchema),
  // Additiv (Contracts §3): fehlt das Feld, bleibt der Frame gültig.
  nodeStats: agentNodeStatsSchema.optional(),
  reportedAt: isoTimestampSchema,
});

/**
 * Obergrenze für ein **einzelnes** Textfeld einer Ereignis-Nutzlast, in Zeichen
 * (Audit W2-30, Fundpunkt 145).
 *
 * Gedeckelt war bisher nur der ganze Frame (`MAX_AGENT_FRAME_BYTES`, 1 MiB).
 * Ein einzelnes Feld durfte diesen Rahmen also allein ausfüllen – und genau das
 * tut die interessanteste Nutzlast: `LOG_LINE.message` wandert ungefiltert in
 * den Konsolenpuffer **jedes** Browsers, der den Server abonniert hat. Eine
 * Logzeile von einem Megabyte war damit kein Protokollfehler, sondern ein
 * gültiger Frame, den das Backend an alle Zuschauer weiterreichte.
 *
 * **Warum 16 384.** Das ist die Chunk-Grenze der Docker-Log-Treiber
 * (`json-file`/`local` zerlegen eine längere Ausgabe in Stücke von höchstens
 * 16 KiB). Eine echte Logzeile erreicht den Agent deshalb nie am Stück länger
 * als 16 KiB; in Zeichen gerechnet ist die Grenze selbst für reines ASCII nicht
 * enger als die Quelle. Es wird also keine legitime Zeile abgeschnitten, und
 * ein einzelnes Feld kann den Frame-Rahmen nicht mehr allein ausschöpfen.
 */
export const AGENT_EVENT_PAYLOAD_MAX_STRING_LENGTH = 16_384;

/**
 * Nutzlast eines Ereignis-Frames – beliebig geformt, aber mit begrenzten
 * Textfeldern.
 *
 * Die Form je Ereignis bleibt bewusst offen (siehe `AgentEventFrame` in
 * `@palantir/contracts`: der Agent bringt sie additiv mit). Geprüft wird
 * deshalb nicht die Struktur, sondern nur eine Eigenschaft, die für jede Form
 * gilt: Kein Text darin ist länger als
 * {@link AGENT_EVENT_PAYLOAD_MAX_STRING_LENGTH}.
 *
 * Rekursiv über Objekte und Arrays, damit die Grenze auch dann greift, wenn ein
 * späteres Ereignis seine Zeilen verschachtelt statt flach meldet.
 */
export const agentEventPayloadSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string().max(AGENT_EVENT_PAYLOAD_MAX_STRING_LENGTH, {
      message: `Einzelne Textfelder einer Ereignis-Nutzlast dürfen höchstens ${String(AGENT_EVENT_PAYLOAD_MAX_STRING_LENGTH)} Zeichen lang sein.`,
    }),
    z.number(),
    z.boolean(),
    z.null(),
    // Wie zuvor bei `z.unknown()`: Ein Feld ohne Wert ist kein Protokollfehler.
    // Über die Leitung kommt es ohnehin nicht an (JSON kennt kein `undefined`),
    // im Prozess soll es aber nicht den ganzen Frame verwerfen.
    z.undefined(),
    z.array(agentEventPayloadSchema),
    z.record(agentEventPayloadSchema),
  ]),
);

export const agentEventFrameSchema = z.object({
  kind: z.literal('event'),
  event: agentEventNameSchema,
  serverId: idSchema.nullable(),
  // `.optional()` hält den Frame ohne Nutzlast gültig – `payload` ist im
  // Vertrag optional (`AgentEventFrame`), und `z.unknown()` war es hier bisher
  // ebenfalls.
  payload: agentEventPayloadSchema.optional(),
  emittedAt: isoTimestampSchema,
});

export const agentCommandResultFrameSchema = z.object({
  kind: z.literal('commandResult'),
  correlationId: correlationIdSchema,
  command: agentCommandNameSchema,
  result: apiResponseSchema(z.unknown()),
  duplicate: z.boolean(),
  completedAt: isoTimestampSchema,
});

export const agentToBackendFrameSchema = z.discriminatedUnion('kind', [
  agentHelloFrameSchema,
  agentStateReportFrameSchema,
  agentEventFrameSchema,
  agentCommandResultFrameSchema,
]);
