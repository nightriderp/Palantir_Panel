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

export const agentEventFrameSchema = z.object({
  kind: z.literal('event'),
  event: agentEventNameSchema,
  serverId: idSchema.nullable(),
  payload: z.unknown(),
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
