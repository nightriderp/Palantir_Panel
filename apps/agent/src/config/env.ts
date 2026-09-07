import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Der Agent liest dieselbe zentrale `.env` wie das Backend (Pflichtenheft
 * §12.1), aber nur die für ihn relevanten Variablen.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
loadDotenv({ path: path.join(repoRoot, '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** WebSocket-Endpunkt des Backends, erreichbar über den WireGuard-Tunnel. */
  AGENT_BACKEND_WS_URL: z.string().url().default('ws://10.10.0.1:4000/agent'),
  /**
   * Pre-Shared-Token zur Authentifizierung des Agents (Pflichtenheft §2.2).
   *
   * Entweder das Token dieser Node (über `POST /admin/nodes/:nodeId/agent-token`
   * vergeben) oder – bei genau einem Homeserver – das gemeinsame `AGENT_TOKEN`
   * aus der zentralen `.env` des Backends.
   */
  AGENT_TOKEN: z.string().min(1).optional(),
  /**
   * Node, für die sich dieser Agent hält (`HostNode.id`).
   *
   * Optional. Ist sie gesetzt, geht sie im `hello` mit und das Backend prüft,
   * dass sie zu der Node passt, der das Token gehört – sonst wird die
   * Verbindung abgelehnt. Ohne Angabe entscheidet allein das Token
   * (WORK_STATUS.md, Gefundener Punkt 57).
   */
  AGENT_NODE_ID: z.string().uuid().optional(),
  /** Docker-Socket-Proxy – der Agent spricht nie direkt mit dem Docker-Socket. */
  DOCKER_SOCKET_PROXY_URL: z.string().url().default('http://127.0.0.1:2375'),
  /** Basisverzeichnis der Server-Datenordner; Bind-Mounts sind darauf begrenzt. */
  AGENT_DATA_DIR: z.string().min(1).default('/srv/palantir/servers'),
  /** Basisverzeichnis der Backups; für Restore-Mounts ebenfalls zugelassen. */
  AGENT_BACKUP_DIR: z.string().min(1).default('/srv/palantir/backups'),
  /**
   * Registry, aus der Spiel-Images geholt werden (Gefundener Punkt 111).
   *
   * Öffentliche Images brauchen keine Angabe. Für die eigenen Images aus dem
   * privaten GHCR-Repository sind Benutzer und Token nötig: Der Agent spricht
   * die Engine-API über den Socket-Proxy an, und die liest keine
   * Docker-CLI-Anmeldung von der Node.
   */
  AGENT_REGISTRY_SERVER: z.string().min(1).default('ghcr.io'),
  AGENT_REGISTRY_USERNAME: z.string().min(1).optional(),
  AGENT_REGISTRY_TOKEN: z.string().min(1).optional(),
  /**
   * Optionaler Pfad zu einem eigenen Seccomp-Profil (Pflichtenheft §2.3).
   * Ohne Angabe greift das Standardprofil der Container-Engine.
   */
  AGENT_SECCOMP_PROFILE_PATH: z.string().min(1).optional(),
  /**
   * Abstand der periodischen Server-Abfrage, wenn das Backend im Befehl
   * `SET_SERVER_QUERY` keinen eigenen mitgibt (Pflichtenheft §9).
   */
  AGENT_QUERY_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3_600).default(60),
  /** Frist einer einzelnen Server-Abfrage, bevor sie als fehlgeschlagen gilt. */
  AGENT_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
  /**
   * Obergrenze eines `DOWNLOAD_BACKUP`-Blocks. Deckelt den vom Backend
   * angeforderten `maxBytes`, damit ein zu großer Wert den Agent nicht
   * umbringt (Lastenheft §3.3).
   */
  AGENT_DOWNLOAD_BLOCK_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 1024 * 1024),
  /**
   * Obergrenze der **gesamten** blockweisen Archiv-Übernahme
   * (`UPLOAD_ARCHIVE_BLOCK`, Audit agent-conn-02).
   *
   * Gegenstück zu `AGENT_DOWNLOAD_BLOCK_MAX_BYTES` für die andere Richtung:
   * Ohne Deckel kann ein fehlerhaftes Backend mit fortlaufenden Blöcken die
   * Platte füllen, und das abschließende Lesen des Archivs bringt den Agent
   * über den Speicher. Vorgabe: 512 MiB – dieselbe Zahl wie die Grenze des
   * Entpackens.
   */
  AGENT_UPLOAD_ARCHIVE_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(512 * 1024 * 1024),
});

/**
 * Namen aller Umgebungsvariablen, die der Agent liest.
 *
 * Aus dem Schema selbst abgeleitet, damit die `environment:`-Liste des
 * Agent-Dienstes in `deploy/gamenode/docker-compose.yml` dagegen geprüft werden
 * kann (Audit W2-23, infra-images-03; siehe `deploy-umgebung.test.ts`). Seit
 * dort kein `env_file: ../../.env` mehr steht – der Agent trug damit sämtliche
 * Geheimnisse der Instanz –, wäre eine hier ergänzte und dort vergessene
 * Variable sonst nicht zu bemerken: Der Container zöge still den Vorgabewert.
 */
export const AGENT_UMGEBUNGSVARIABLEN: readonly string[] = Object.keys(envSchema.shape);

/**
 * In einer `.env` bedeutet `SCHLUESSEL=` „nicht gesetzt", nicht „leerer Wert" –
 * und dasselbe gilt für `SCHLUESSEL: ${SCHLUESSEL}` in der Compose-Datei, wenn
 * der Wert in der `.env` leer bleibt (Audit W2-23).
 *
 * Ohne diese Normalisierung greift kein Vorgabewert: Die Vorlage liefert
 * `AGENT_REGISTRY_USERNAME=`, `AGENT_SECCOMP_PROFILE_PATH=` und
 * `AGENT_NODE_ID=` leer aus, und `z.string().min(1)` bzw. `.url()` weisen den
 * leeren String zurück – der Agent käme mit der ausgelieferten Vorlage gar
 * nicht erst hoch. Gleiche Umsetzung wie im Backend
 * (`apps/backend/src/config/env.ts`, `leereWerteAlsUngesetzt`); bewusst
 * doppelt statt über ein gemeinsames Paket, weil `packages/contracts` und
 * `packages/validation` die Vertragsgrenze zwischen den Komponenten sind und
 * keine Laufzeit-Hilfsfunktionen aufnehmen (CLAUDE.md §3).
 */
export function leereWerteAlsUngesetzt(
  werte: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(werte).map(([schlüssel, wert]) => [
      schlüssel,
      typeof wert === 'string' && wert.trim() === '' ? undefined : wert,
    ]),
  );
}

/**
 * Liest einen Satz Umgebungswerte gegen das vollständige Schema.
 *
 * Ausgelagert und exportiert, damit die Normalisierung ohne Neuladen des Moduls
 * testbar ist (CLAUDE.md §4).
 */
export function umgebungLesen(
  werte: Record<string, string | undefined>,
): z.SafeParseReturnType<unknown, z.infer<typeof envSchema>> {
  return envSchema.safeParse(leereWerteAlsUngesetzt(werte));
}

const parsed = umgebungLesen(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Ungültige Umgebungskonfiguration für den Agent:\n${details}`);
}

export const env = parsed.data;
export type Env = typeof env;
