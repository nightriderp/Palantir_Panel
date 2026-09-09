/**
 * Konsole über RCON (P2-9).
 *
 * Bis hierher schrieb `EXEC_CONSOLE` jeden Befehl in die Standardeingabe des
 * Servers (`palantir-console` im Image) und die Antwort stand irgendwo im Log.
 * Für Spiele, deren Definition einen RCON-Anschluss nennt
 * (`GameTypeDefinition.console.kind === 'rcon'`), geht der Befehl stattdessen
 * hierüber – und die Antwort kommt als `stdout` zurück, wie bei einem
 * gewöhnlichen Befehl.
 *
 * **Woher der Zugang kommt.** Das Backend nennt Port und Passwortdatei aus der
 * Spieltyp-Definition (`ExecConsoleCommandPayload.rcon`), nicht das Passwort:
 * Das entsteht auf der Node bei jedem Start neu und verlässt sie nie. Der
 * Agent liest es aus dem Datenordner des Servers – dieselbe Grenze wie bei den
 * Backups (`resolveWithinDirectory`), ein Pfad nach außen scheitert dort.
 *
 * **Wohin die Verbindung geht.** An die Adresse des Containers im Spielenetz,
 * wie bei der Spielerabfrage (Fundpunkt 188). Der RCON-Port wird nie auf den
 * Host veröffentlicht; erreichbar ist er nur aus diesem Netz, und dort nur von
 * der festen Adresse des Agents (`egress-firewall.sh`, Regel „Agent ->
 * Spielserver").
 *
 * **Was ein Fehler ist und was eine Antwort.** Alles, was der Betreiber selbst
 * sehen und verstehen soll – Server noch nicht oben, Passwort fehlt noch,
 * Anmeldung abgelehnt – kommt als `exitCode 1` mit Text in `stderr` zurück und
 * landet so als Zeile in der Live-Konsole. Nur ein Pfad außerhalb des
 * Datenordners ist ein Fehler des Aufrufs und wirft.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExecConsoleCommandPayload } from '@palantir/contracts';
import type { ContainerRuntime, ExecResult } from '../../runtime/index.js';
import { RconError, rconCommand, type RconClient } from '../../runtime/rcon.js';
import { resolveWithinDirectory } from '../paths.js';

/** Frist je Befehl – Verbinden, Anmelden, Antwort. */
export const DEFAULT_RCON_TIMEOUT_MS = 5_000;

/** Zugang, wie das Backend ihn im Befehl nennt (`AgentRconAccess` im Vertrag). */
export type RconAccess = NonNullable<ExecConsoleCommandPayload['rcon']>;

export interface RconConsoleOptions {
  readonly runtime: ContainerRuntime;
  /** Wurzel der Datenordner (`AGENT_DATA_DIR`); darunter liegt `<serverId>/`. */
  readonly dataDir: string;
  /** Netz, in dem der Container seine Adresse hat (`AGENT_CONTAINER_NETWORK`). */
  readonly network: string;
  readonly timeoutMs?: number;
  /** Der eigentliche Client; ohne Angabe {@link rconCommand}. Für Tests. */
  readonly client?: RconClient;
}

/** Minecraft färbt Antworten mit `§x`; in der Konsole des Panels stört das nur. */
const FARBCODE = /§[0-9a-fk-or]/giu;

export class RconConsole {
  readonly #runtime: ContainerRuntime;
  readonly #dataDir: string;
  readonly #network: string;
  readonly #timeoutMs: number;
  readonly #client: RconClient;

  constructor(options: RconConsoleOptions) {
    this.#runtime = options.runtime;
    this.#dataDir = options.dataDir;
    this.#network = options.network;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_RCON_TIMEOUT_MS;
    this.#client = options.client ?? rconCommand;
  }

  /**
   * Schickt `command` über RCON an den Container und liefert die Antwort als
   * `stdout`. Die Argumentliste wird mit Leerzeichen verbunden – RCON kennt
   * keine Argumente, nur eine Zeile.
   */
  async exec(
    serverId: string,
    containerId: string,
    access: RconAccess,
    command: readonly string[],
  ): Promise<ExecResult> {
    const host = await this.#runtime.networkAddress(containerId, this.#network);

    if (host === null) {
      return fehlschlag(
        `Der Container ist im Netz „${this.#network}" nicht erreichbar – läuft der Server schon?`,
      );
    }

    const password = await this.#passwort(serverId, access.passwordFile);

    if (password === null) {
      return fehlschlag(
        `Kein RCON-Passwort unter ${access.passwordFile} – der Server legt es beim Start an.`,
      );
    }

    try {
      const antwort = await this.#client({
        host,
        port: access.port,
        password,
        command: command.join(' '),
        timeoutMs: this.#timeoutMs,
      });

      return { exitCode: 0, stdout: antwort.replace(FARBCODE, ''), stderr: '' };
    } catch (fehler: unknown) {
      if (fehler instanceof RconError) {
        return fehlschlag(`RCON: ${fehler.message}`);
      }

      throw fehler;
    }
  }

  /** Liest das Passwort aus dem Datenordner; `null`, wenn es (noch) keines gibt. */
  async #passwort(serverId: string, passwordFile: string): Promise<string | null> {
    const datei = resolveWithinDirectory(path.join(this.#dataDir, serverId), passwordFile);

    let inhalt: string;

    try {
      inhalt = await fs.readFile(datei, 'utf8');
    } catch (fehler: unknown) {
      if (istEnoent(fehler)) {
        return null;
      }

      throw fehler;
    }

    const passwort = inhalt.trim();

    return passwort.length === 0 ? null : passwort;
  }
}

function fehlschlag(text: string): ExecResult {
  return { exitCode: 1, stdout: '', stderr: text };
}

function istEnoent(fehler: unknown): boolean {
  return (
    typeof fehler === 'object' &&
    fehler !== null &&
    'code' in fehler &&
    (fehler as { code?: unknown }).code === 'ENOENT'
  );
}
