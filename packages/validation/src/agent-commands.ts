/**
 * Zod-Gegenstück zu den Befehls-Nutzdaten aus `@palantir/contracts`
 * (Pflichtenheft §5.3).
 *
 * Der Agent prüft jede Nutzlast gegen diese Schemas, bevor er sie an die
 * Container-Runtime weiterreicht. Der Frame-Rahmen ist zu diesem Zeitpunkt
 * bereits geprüft (`backendToAgentFrameSchema`), die Nutzdaten dort aber
 * bewusst als `unknown` offen gelassen – hier werden sie festgenagelt.
 *
 * Das ist keine doppelte Absicherung „für alle Fälle": Die Runtime baut aus
 * diesen Werten Container-Konfiguration, Pfade und Portbindungen. Ein falscher
 * Typ darf dort nicht erst auffallen.
 */

import { z } from 'zod';
import { idSchema } from './common.js';
import { isoTimestampSchema } from './agent-protocol.js';

/** Container-ID der Runtime. Kein festes Format – die vergibt die Engine. */
export const containerIdSchema = z
  .string()
  .min(1, { message: 'containerId darf nicht leer sein.' });

/** Absoluter Pfad im Container. Relative Pfade lehnt schon das Schema ab. */
export const containerPathSchema = z
  .string()
  .min(1)
  .startsWith('/', { message: 'Pfad muss absolut sein (mit / beginnen).' });

const portNumberSchema = z.number().int().min(1).max(65_535);

export const agentPortMappingSchema = z.object({
  containerPort: portNumberSchema,
  hostPort: portNumberSchema,
  protocol: z.enum(['tcp', 'udp']),
});

export const agentResourceLimitsSchema = z.object({
  memoryMb: z.number().int().positive(),
  cpuCores: z.number().positive(),
  pidsLimit: z.number().int().positive().optional(),
});

export const agentVolumeMountSchema = z.object({
  hostPath: z.string().min(1),
  containerPath: containerPathSchema,
  readOnly: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Nutzdaten je Befehl
// ---------------------------------------------------------------------------

export const createCommandPayloadSchema = z.object({
  name: z.string().min(1),
  image: z.string().min(1),
  env: z.record(z.string()),
  command: z.array(z.string()).optional(),
  ports: z.array(agentPortMappingSchema),
  resources: agentResourceLimitsSchema,
  dataVolume: agentVolumeMountSchema,
  extraMounts: z.array(agentVolumeMountSchema).optional(),
  readOnlyRootFilesystem: z.boolean().optional(),
  tmpfsPaths: z.array(containerPathSchema).optional(),
  labels: z.record(z.string()).optional(),
  workingDir: containerPathSchema.optional(),
  user: z.string().min(1).optional(),
  stopTimeoutSeconds: z.number().int().nonnegative().optional(),
});

export const startCommandPayloadSchema = z.object({
  containerId: containerIdSchema,
});

export const stopCommandPayloadSchema = z.object({
  containerId: containerIdSchema,
  timeoutSeconds: z.number().int().nonnegative().optional(),
});

export const restartCommandPayloadSchema = stopCommandPayloadSchema;

export const deleteCommandPayloadSchema = z.object({
  containerId: containerIdSchema,
  removeVolumes: z.boolean().optional(),
  force: z.boolean().optional(),
});

export const getStatsCommandPayloadSchema = z.object({
  containerId: containerIdSchema,
});

export const getLogsCommandPayloadSchema = z.object({
  containerId: containerIdSchema,
  tail: z.number().int().positive().optional(),
  since: isoTimestampSchema.optional(),
  includeStdout: z.boolean().optional(),
  includeStderr: z.boolean().optional(),
});

export const execConsoleCommandPayloadSchema = z.object({
  containerId: containerIdSchema,
  // Mindestens ein Element: Ein leerer Befehl hätte keine Bedeutung, würde aber
  // je nach Engine unterschiedlich behandelt.
  command: z.array(z.string()).min(1),
});

export const fileListCommandPayloadSchema = z.object({
  containerId: containerIdSchema,
  path: containerPathSchema,
});

export const fileReadCommandPayloadSchema = fileListCommandPayloadSchema;

export const fileWriteCommandPayloadSchema = z.object({
  containerId: containerIdSchema,
  path: containerPathSchema,
  contentBase64: z
    .string()
    .base64({ message: 'contentBase64 ist keine gültige Base64-Kodierung.' }),
});

// ---------------------------------------------------------------------------
// Backup-Befehle (Lastenheft §3.3, Arbeitspaket A3)
// ---------------------------------------------------------------------------
//
// Diese Befehle führt der Agent noch nicht aus; sie stehen deshalb bewusst
// **nicht** in AGENT_COMMAND_PAYLOAD_SCHEMAS weiter unten. Die Schemas
// existieren trotzdem schon, weil das Backend (B5) sie in beiden Richtungen
// braucht: zum Prüfen der eigenen Nutzdaten und – vor allem – zum Prüfen der
// Ergebnisse, die als `unknown` im Envelope zurückkommen.

/** Absoluter Pfad auf dem Homeserver (nicht im Container). */
export const hostPathSchema = z
  .string()
  .min(1)
  .startsWith('/', { message: 'Pfad muss absolut sein (mit / beginnen).' });

export const createBackupCommandPayloadSchema = z.object({
  backupId: idSchema,
  serverId: idSchema,
  sourcePath: hostPathSchema,
  containerId: containerIdSchema.optional(),
  stopContainer: z.boolean().optional(),
  stopTimeoutSeconds: z.number().int().nonnegative().optional(),
});

export const restoreBackupCommandPayloadSchema = z.object({
  backupId: idSchema,
  serverId: idSchema,
  storagePath: hostPathSchema,
  targetPath: hostPathSchema,
  containerId: containerIdSchema.optional(),
  stopTimeoutSeconds: z.number().int().nonnegative().optional(),
});

export const downloadBackupCommandPayloadSchema = z.object({
  backupId: idSchema,
  storagePath: hostPathSchema,
  offset: z.number().int().nonnegative(),
  maxBytes: z.number().int().positive(),
});

export const deleteBackupCommandPayloadSchema = z.object({
  backupId: idSchema,
  storagePath: hostPathSchema,
});

/** SHA-256 als 64 Hex-Zeichen in Kleinbuchstaben. */
export const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, { message: 'checksumSha256 ist keine SHA-256-Prüfsumme.' });

export const createBackupCommandResultSchema = z.object({
  backupId: idSchema,
  storagePath: hostPathSchema,
  sizeBytes: z.number().int().nonnegative(),
  checksumSha256: sha256Schema,
  containerStopped: z.boolean(),
  startedAt: isoTimestampSchema,
  completedAt: isoTimestampSchema,
});

export const restoreBackupCommandResultSchema = z.object({
  backupId: idSchema,
  restoredBytes: z.number().int().nonnegative(),
  containerStopped: z.boolean(),
  startedAt: isoTimestampSchema,
  completedAt: isoTimestampSchema,
});

export const deleteBackupCommandResultSchema = z.object({
  backupId: idSchema,
  removed: z.boolean(),
  freedBytes: z.number().int().nonnegative(),
});

export const downloadBackupCommandResultSchema = z.object({
  backupId: idSchema,
  offset: z.number().int().nonnegative(),
  contentBase64: z
    .string()
    .base64({ message: 'contentBase64 ist keine gültige Base64-Kodierung.' }),
  bytesRead: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  eof: z.boolean(),
});

/**
 * Nachschlagetabelle Befehl → Schema.
 *
 * Nur die Befehle, die der Agent tatsächlich ausführt
 * (`IMPLEMENTED_AGENT_COMMANDS` in `@palantir/contracts`). Für die übrigen
 * antwortet er mit `AGENT_COMMAND_NOT_IMPLEMENTED`, ohne die Nutzdaten zu
 * prüfen – es gibt noch nichts, wogegen zu prüfen wäre.
 */
export const AGENT_COMMAND_PAYLOAD_SCHEMAS = {
  CREATE: createCommandPayloadSchema,
  START: startCommandPayloadSchema,
  STOP: stopCommandPayloadSchema,
  RESTART: restartCommandPayloadSchema,
  DELETE: deleteCommandPayloadSchema,
  GET_STATS: getStatsCommandPayloadSchema,
  GET_LOGS: getLogsCommandPayloadSchema,
  EXEC_CONSOLE: execConsoleCommandPayloadSchema,
  FILE_LIST: fileListCommandPayloadSchema,
  FILE_READ: fileReadCommandPayloadSchema,
  FILE_WRITE: fileWriteCommandPayloadSchema,
} as const;

/**
 * `serverId` im Befehls-Frame – hier nur re-exportiert, damit B3 nicht raten
 * muss, welches Format gemeint ist (dieselbe UUID wie alle Entitäts-IDs).
 */
export const agentServerIdSchema = idSchema;
