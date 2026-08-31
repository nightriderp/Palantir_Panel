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

import { ARCHIVE_FORMATS } from '@palantir/contracts';
import { z } from 'zod';
import { idSchema } from './common.js';
import { isoTimestampSchema } from './agent-protocol.js';
import { getStorageBreakdownPayloadSchema } from './storage.js';

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
// Datei-Manager: Löschen und Hochladen (Arbeitspaket P2)
// ---------------------------------------------------------------------------
//
// Diese Befehle führt der Agent noch nicht aus; sie stehen deshalb bewusst
// **nicht** in AGENT_COMMAND_PAYLOAD_SCHEMAS weiter unten – genau wie die
// Backup-Schemas oben. Die Schemas existieren trotzdem schon, damit P2 die
// Nutzdaten prüfen kann, ohne den Vertrag ein zweites Mal zu formulieren.

export const fileDeleteCommandPayloadSchema = z.object({
  containerId: containerIdSchema,
  path: containerPathSchema,
  recursive: z.boolean().optional(),
});

export const fileUploadCommandPayloadSchema = z.object({
  containerId: containerIdSchema,
  path: containerPathSchema,
  contentBase64: z
    .string()
    .base64({ message: 'contentBase64 ist keine gültige Base64-Kodierung.' }),
  overwrite: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Weltdaten-Übernahme (Lastenheft §3.3, Arbeitspaket P4)
// ---------------------------------------------------------------------------

/**
 * `FILE_EXTRACT` – ein hochgeladenes Archiv in den Datenordner entpacken.
 *
 * `path` darf hier **leer** sein: Der Import landet in aller Regel in der
 * Wurzel des Datenordners, und genau die schreibt der Datei-Manager als `''`.
 */
export const fileExtractCommandPayloadSchema = z.object({
  containerId: containerIdSchema,
  path: z.string().max(4_096),
  contentBase64: z
    .string()
    .base64({ message: 'contentBase64 ist keine gültige Base64-Kodierung.' }),
  format: z.enum(ARCHIVE_FORMATS),
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

/** SHA-256 als 64 Hex-Zeichen in Kleinbuchstaben. */
export const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, { message: 'checksumSha256 ist keine SHA-256-Prüfsumme.' });

/**
 * Eine Datei, die zusätzlich zum Datenordner ins Archiv wandert (P8).
 *
 * Der Pfad wird hier schon eingeschränkt: kein führender Schrägstrich, kein
 * `..`. Der Agent legt die Datei ohne weitere Prüfung ins Archiv, und ein
 * Archiv mit `../` im Eintrag wäre beim Entpacken gefährlich.
 */
export const archiveExtraFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(255)
    .refine((wert) => !wert.startsWith('/') && !wert.split('/').includes('..'), {
      message: 'Der Pfad im Archiv darf nicht absolut sein und kein „..“ enthalten.',
    }),
  contentBase64: z
    .string()
    .base64({ message: 'contentBase64 ist keine gültige Base64-Kodierung.' }),
});

export const createBackupCommandPayloadSchema = z.object({
  backupId: idSchema,
  serverId: idSchema,
  sourcePath: hostPathSchema,
  /** Zusätzliche Dateien im Archiv (P8); ohne Angabe nur der Datenordner. */
  extraFiles: z.array(archiveExtraFileSchema).max(16).optional(),
  containerId: containerIdSchema.optional(),
  stopContainer: z.boolean().optional(),
  stopTimeoutSeconds: z.number().int().nonnegative().optional(),
});

export const restoreBackupCommandPayloadSchema = z.object({
  backupId: idSchema,
  serverId: idSchema,
  storagePath: hostPathSchema,
  targetPath: hostPathSchema,
  // Referenz-Prüfsumme aus dem Backup-Datensatz. Der Agent verifiziert das
  // Archiv vor dem Entpacken dagegen (Fundpunkt 99).
  expectedChecksum: sha256Schema,
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

// ---------------------------------------------------------------------------
// Periodische Server-Abfrage und Speicher-Aufräumen (Arbeitspaket A3)
// ---------------------------------------------------------------------------

export const agentQuerySpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('portConnect') }),
  z.object({ kind: z.literal('gamedig'), protocol: z.string().min(1) }),
]);

export const agentServerQueryTargetSchema = z.object({
  containerId: containerIdSchema,
  host: z.string().min(1).optional(),
  hostPort: portNumberSchema,
  query: agentQuerySpecSchema,
  // Untergrenze bewusst im Schema und nicht erst im Job: Ein Intervall von
  // Sekundenbruchteilen wäre für den abgefragten Spielserver eine Last, keine
  // Messung.
  intervalSeconds: z.number().int().min(5).max(3_600).optional(),
});

export const setServerQueryCommandPayloadSchema = z.object({
  serverId: idSchema,
  target: agentServerQueryTargetSchema.nullable(),
});

export const setServerQueryCommandResultSchema = z.object({
  serverId: idSchema,
  active: z.boolean(),
  intervalSeconds: z.number().int().positive().nullable(),
});

/**
 * Zu entfernender Speicher-Posten.
 *
 * `serverData` fehlt bewusst – Datenordner aktiver Server sind über den
 * Storage-Explorer nicht löschbar (Lastenheft §3.8). Die Prüfung steht hier
 * zusätzlich zum Typ, weil die Nutzlast über die Leitung kommt und der Typ
 * dort nichts mehr ausrichtet.
 */
export const removableStorageEntryKindSchema = z.enum(['backup', 'dockerImage', 'orphaned']);

export const removeStorageEntryCommandPayloadSchema = z
  .object({
    kind: removableStorageEntryKindSchema,
    path: hostPathSchema.optional(),
    imageId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'dockerImage') {
      if (value.imageId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['imageId'],
          message: 'Bei kind "dockerImage" wird imageId benötigt.',
        });
      }

      return;
    }

    if (value.path === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['path'],
        message: `Bei kind "${value.kind}" wird path benötigt.`,
      });
    }
  });

export const removeStorageEntryCommandResultSchema = z.object({
  removed: z.boolean(),
  freedBytes: z.number().int().nonnegative(),
});

/**
 * Nutzlast von `STATS_UPDATE` aus der periodischen Server-Abfrage.
 *
 * Steht hier und nicht in `agent-protocol.ts`, weil sie inhaltlich zur Abfrage
 * gehört; das Frame-Schema lässt `payload` bewusst offen.
 */
export const agentServerQueryPayloadSchema = z.object({
  source: z.literal('serverQuery'),
  containerId: containerIdSchema,
  reachable: z.boolean(),
  playersOnline: z.number().int().nonnegative().nullable(),
  playersMax: z.number().int().nonnegative().nullable(),
  /**
   * Namen der verbundenen Spieler, soweit die Abfrage sie herausgibt
   * (Gefundener Punkt 51). Optional und additiv: Ein Agent, der das Feld nicht
   * schickt, bleibt gueltig.
   */
  players: z.array(z.object({ name: z.string().min(1) })).optional(),
  pingMs: z.number().int().nonnegative().nullable(),
  reason: z.string().min(1).nullable(),
  at: isoTimestampSchema,
});

/**
 * Nachschlagetabelle Befehl → Schema.
 *
 * Deckungsgleich mit `IMPLEMENTED_AGENT_COMMANDS` in `@palantir/contracts` –
 * ein Test hält beide Listen zusammen. Seit A3 sind das alle Befehle des
 * Protokolls.
 *
 * `getStorageBreakdownPayloadSchema` steht in `storage.ts`, weil es dort
 * zusammen mit dem Ergebnis-Schema geführt wird (B8); hier wird es nur
 * eingehängt.
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
  FILE_DELETE: fileDeleteCommandPayloadSchema,
  FILE_UPLOAD: fileUploadCommandPayloadSchema,
  FILE_EXTRACT: fileExtractCommandPayloadSchema,
  CREATE_BACKUP: createBackupCommandPayloadSchema,
  RESTORE_BACKUP: restoreBackupCommandPayloadSchema,
  DOWNLOAD_BACKUP: downloadBackupCommandPayloadSchema,
  DELETE_BACKUP: deleteBackupCommandPayloadSchema,
  GET_STORAGE_BREAKDOWN: getStorageBreakdownPayloadSchema,
  SET_SERVER_QUERY: setServerQueryCommandPayloadSchema,
  REMOVE_STORAGE_ENTRY: removeStorageEntryCommandPayloadSchema,
} as const;

/**
 * `serverId` im Befehls-Frame – hier nur re-exportiert, damit B3 nicht raten
 * muss, welches Format gemeint ist (dieselbe UUID wie alle Entitäts-IDs).
 */
export const agentServerIdSchema = idSchema;
