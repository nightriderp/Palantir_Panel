/**
 * Persistente Verbindung des Agents zum Backend (Pflichtenheft §2.2).
 *
 * Diese Klasse hält die gesamte Protokolllogik und kennt bewusst keinen
 * WebSocket – die Übertragung kommt über {@link TransportFactory} herein.
 *
 * Ablauf einer Verbindung:
 *   1. Transport öffnet sich (Authentifizierung ist da bereits erfolgt)
 *   2. Agent sendet `hello` mit seiner Protokollversion
 *   3. Backend antwortet mit `welcome`; erst danach gilt der Handshake als
 *      abgeschlossen und das Backoff wird zurückgesetzt
 *   4. Agent meldet unaufgefordert seinen vollständigen Ist-Zustand
 *      (`stateReport`, Anlass `connected`) – Grundlage des Soll/Ist-Abgleichs
 *      im Backend
 *   5. Laufender Betrieb: `command` -> `commandResult`, `stateRequest` ->
 *      `stateReport`, dazu unaufgeforderte `event`-Frames
 *
 * Bricht die Verbindung an irgendeiner Stelle ab, beginnt der Ablauf nach der
 * Backoff-Wartezeit von vorn. Der Agent baut immer selbst auf und nimmt
 * niemals eingehende Verbindungen an (Pflichtenheft §1, §18).
 */

import {
  AGENT_PROTOCOL_VERSION,
  type AgentContainerState,
  type AgentNodeStats,
  type AgentStateReportReason,
  type AgentToBackendFrame,
  type ApiResponse,
  type BackendCommandFrame,
  fail,
  isAgentCommandName,
} from '@palantir/contracts';
import { backendToAgentFrameSchema, correlationIdSchema } from '@palantir/validation';
import { ExponentialBackoff, type BackoffOptions } from './backoff.js';
import { CorrelationStore, type CorrelationStoreOptions } from './correlation-store.js';
import type { AgentRuntimePort, OutboundEvent } from './ports.js';
import type { Transport, TransportCloseInfo, TransportFactory } from './transport.js';

export interface ConnectionLogger {
  debug(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

/** Voreinstellung: schreibt auf die Konsole, wie das übrige Agent-Grundgerüst. */
export const consoleLogger: ConnectionLogger = {
  debug: (message, details) => console.debug(`[agent:connection] ${message}`, details ?? {}),
  info: (message, details) => console.info(`[agent:connection] ${message}`, details ?? {}),
  warn: (message, details) => console.warn(`[agent:connection] ${message}`, details ?? {}),
  error: (message, details) => console.error(`[agent:connection] ${message}`, details ?? {}),
};

export interface AgentConnectionOptions {
  readonly transportFactory: TransportFactory;
  /** Nahtstelle zur Container-Runtime (A2). */
  readonly runtime: AgentRuntimePort;
  /** Version des Agent-Pakets, geht im `hello`-Frame mit (nur Diagnose). */
  readonly agentVersion: string;
  readonly logger?: ConnectionLogger;
  readonly backoff?: Partial<BackoffOptions>;
  readonly correlationStore?: Partial<CorrelationStoreOptions>;
  /**
   * Frist für das `welcome` des Backends. Läuft sie ab, wird die Verbindung
   * verworfen und neu aufgebaut – ein Socket, der zwar offen ist, aber nie
   * antwortet, ist schlimmer als gar keiner, weil er den Reconnect verhindert.
   */
  readonly handshakeTimeoutMs?: number;
  /**
   * Liest die gemessenen Ist-Ressourcen der Node (Pflichtenheft §11). Ohne
   * diese Option geht der Bericht ohne `nodeStats` raus – additiv zulässig.
   * `null` als Rückgabe bedeutet „gerade nicht messbar" und wird ebenso
   * behandelt.
   */
  readonly readNodeStats?: () => Promise<AgentNodeStats | null>;
}

export type ConnectionState = 'idle' | 'connecting' | 'handshaking' | 'ready' | 'waiting';

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

/** Close-Code für ein reguläres Beenden durch den Agent. */
const CLOSE_NORMAL = 1000;

/** Warteschlange für node-weite Befehle ohne zugeordneten Server. */
const NODE_LANE = '__node__';

export class AgentConnection {
  private readonly options: AgentConnectionOptions;
  private readonly log: ConnectionLogger;
  private readonly backoff: ExponentialBackoff;
  private readonly correlations: CorrelationStore;
  private readonly handshakeTimeoutMs: number;

  private transport: Transport | null = null;
  private state: ConnectionState = 'idle';
  private running = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Befehle werden **je Server** nacheinander abgearbeitet: `STOP` und
   * `RESTART` für denselben Server dürfen sich nicht überholen. Befehle für
   * verschiedene Server laufen dagegen nebeneinander – ein minutenlanges
   * `CREATE_BACKUP` darf nicht die Konsole eines anderen Servers blockieren.
   */
  private readonly commandLanes = new Map<string, Promise<void>>();

  constructor(options: AgentConnectionOptions) {
    this.options = options;
    this.log = options.logger ?? consoleLogger;
    this.backoff = new ExponentialBackoff(options.backoff);
    this.correlations = new CorrelationStore(options.correlationStore);
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  }

  /** Aktueller Verbindungszustand (für Logging und Tests). */
  get connectionState(): ConnectionState {
    return this.state;
  }

  /** `true`, sobald der Handshake abgeschlossen ist und Frames fließen dürfen. */
  get isReady(): boolean {
    return this.state === 'ready';
  }

  /** Baut die Verbindung auf und hält sie ab jetzt dauerhaft offen. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.openTransport();
  }

  /** Beendet die Verbindung und unterbindet weitere Wiederverbindungsversuche. */
  stop(): void {
    this.running = false;
    this.clearReconnectTimer();
    this.clearHandshakeTimer();
    this.state = 'idle';

    const transport = this.transport;
    this.transport = null;
    transport?.close(CLOSE_NORMAL, 'Agent wird beendet');
  }

  /**
   * Meldet ein Ereignis ans Backend (genutzt von A2 und A3).
   *
   * Besteht gerade keine Verbindung, wird das Ereignis **verworfen** statt
   * gepuffert. Der Ist-Zustands-Bericht nach der Wiederverbindung ist die
   * vorgesehene Wiederherstellung (Pflichtenheft §2.2); ein Puffer würde
   * veraltete Statusmeldungen nachliefern, die dem gerade gemeldeten Ist-Zustand
   * widersprechen.
   */
  sendEvent(event: OutboundEvent): boolean {
    if (!this.isReady) {
      this.log.warn('Ereignis verworfen – keine Verbindung zum Backend', {
        event: event.event,
        serverId: event.serverId,
      });
      return false;
    }

    return this.sendFrame({
      kind: 'event',
      event: event.event,
      serverId: event.serverId,
      payload: event.payload,
      emittedAt: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // Verbindungsaufbau und Reconnect
  // -------------------------------------------------------------------------

  private openTransport(): void {
    this.state = 'connecting';
    this.log.info('Verbindungsaufbau zum Backend', { versuch: this.backoff.attempt + 1 });

    this.transport = this.options.transportFactory({
      onOpen: () => this.handleOpen(),
      onMessage: (raw) => this.handleMessage(raw),
      onClose: (info) => this.handleClose(info),
      onError: (error) => {
        // Kein Reconnect von hier aus – auf einen Fehler folgt immer ein
        // onClose, dort wird genau einmal neu geplant.
        this.log.warn('Fehler auf der Verbindung', { fehler: error.message });
      },
    });
  }

  private handleOpen(): void {
    this.state = 'handshaking';
    this.log.info('Verbindung offen, sende hello');

    this.sendFrame({
      kind: 'hello',
      protocolVersion: AGENT_PROTOCOL_VERSION,
      agentVersion: this.options.agentVersion,
      sentAt: new Date().toISOString(),
    });

    this.clearHandshakeTimer();
    this.handshakeTimer = setTimeout(() => {
      this.log.warn('Backend hat den Handshake nicht bestätigt – Verbindung wird verworfen', {
        fristMs: this.handshakeTimeoutMs,
      });
      this.transport?.close(CLOSE_NORMAL, 'Handshake-Frist abgelaufen');
    }, this.handshakeTimeoutMs);
  }

  private handleClose(info: TransportCloseInfo): void {
    this.clearHandshakeTimer();
    this.transport = null;

    if (info.unauthorized) {
      // Kein Abbruch: Ein korrigiertes Token soll ohne Neustart des Agents
      // greifen. Deutlich geloggt, weil sonst nur endlose Versuche zu sehen sind.
      this.log.error('Backend hat die Authentifizierung abgelehnt – AGENT_TOKEN prüfen', {
        code: info.code,
        grund: info.reason,
      });
    } else {
      this.log.warn('Verbindung beendet', { code: info.code, grund: info.reason });
    }

    if (!this.running) {
      this.state = 'idle';
      return;
    }

    const delayMs = this.backoff.nextDelayMs();
    this.state = 'waiting';
    this.log.info('Wiederverbindung geplant', { inMs: delayMs, versuch: this.backoff.attempt });

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) {
        this.openTransport();
      }
    }, delayMs);
  }

  // -------------------------------------------------------------------------
  // Eingehende Frames
  // -------------------------------------------------------------------------

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.log.warn('Nachricht ist kein gültiges JSON – verworfen');
      return;
    }

    const frame = backendToAgentFrameSchema.safeParse(parsed);
    if (!frame.success) {
      this.rejectMalformedFrame(
        parsed,
        frame.error.issues.map((issue) => issue.message).join('; '),
      );
      return;
    }

    switch (frame.data.kind) {
      case 'welcome':
        this.handleWelcome(frame.data.protocolVersion);
        return;
      case 'command':
        this.dispatchCommand(frame.data);
        return;
      case 'stateRequest':
        void this.sendStateReport('requested');
        return;
    }
  }

  private handleWelcome(protocolVersion: number): void {
    this.clearHandshakeTimer();

    if (protocolVersion !== AGENT_PROTOCOL_VERSION) {
      // Bewusst kein „irgendwie weitermachen": halb verstandene Befehle sind
      // gefährlicher als eine getrennte Verbindung.
      this.log.error('Protokollversion passt nicht zum Backend', {
        code: 'AGENT_PROTOCOL_VERSION_MISMATCH',
        agent: AGENT_PROTOCOL_VERSION,
        backend: protocolVersion,
      });
      this.transport?.close(CLOSE_NORMAL, 'Protokollversion passt nicht');
      return;
    }

    this.state = 'ready';
    // Erst jetzt zurücksetzen: Ein Backend, das annimmt und sofort wieder
    // schließt, soll nicht in eine Schleife ohne Wartezeit führen.
    this.backoff.reset();
    this.log.info('Handshake abgeschlossen', { protokollVersion: protocolVersion });

    void this.sendStateReport('connected');
  }

  /**
   * Antwort auf einen Frame, der das Schema verletzt.
   *
   * Nur möglich, wenn Korrelations-ID und Befehlsname trotzdem verwertbar sind –
   * sonst bliebe unklar, worauf sich die Antwort bezieht. Ohne diese Antwort
   * würde das Backend auf eine Korrelations-ID warten, die nie beantwortet wird.
   */
  private rejectMalformedFrame(parsed: unknown, grund: string): void {
    this.log.warn('Frame verletzt das Protokoll-Schema', { grund });

    if (typeof parsed !== 'object' || parsed === null) {
      return;
    }
    const candidate = parsed as Record<string, unknown>;
    if (candidate['kind'] !== 'command') {
      return;
    }

    const correlationId = correlationIdSchema.safeParse(candidate['correlationId']);
    if (!correlationId.success) {
      this.log.warn('Fehlerhafter Befehl ohne verwertbare Korrelations-ID – keine Antwort möglich');
      return;
    }

    const command = candidate['command'];
    if (typeof command !== 'string' || !isAgentCommandName(command)) {
      // Ohne gültigen Befehlsnamen ließe sich kein protokollkonformes Ergebnis
      // bauen – der Log-Eintrag oben ist hier alles, was möglich ist.
      this.log.warn('Fehlerhafter Befehl mit unbekanntem Namen – keine Antwort möglich', {
        command: String(command),
      });
      return;
    }

    this.sendFrame({
      kind: 'commandResult',
      correlationId: correlationId.data,
      command,
      result: fail('AGENT_COMMAND_INVALID', grund),
      duplicate: false,
      completedAt: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // Befehle
  // -------------------------------------------------------------------------

  /**
   * Entscheidet **beim Eingang** über Ausführung oder Verwerfen (Pflichtenheft
   * §2.2) – bewusst nicht erst beim Ausführen: Sonst stünde ein Duplikat schon
   * in der Warteschlange und die Doppel-Erkennung käme zu spät.
   */
  private dispatchCommand(frame: BackendCommandFrame): void {
    const { correlationId, command } = frame;

    const bereitsErledigt = this.correlations.getCompleted(correlationId);
    if (bereitsErledigt) {
      // Nicht erneut ausführen, aber das Ergebnis noch einmal schicken – der
      // Retry entsteht meist gerade deshalb, weil die erste Antwort nicht
      // angekommen ist.
      this.log.info('Befehl bereits verarbeitet – Ergebnis erneut gesendet', {
        correlationId,
        command,
      });
      this.sendFrame({
        kind: 'commandResult',
        correlationId,
        command: bereitsErledigt.command,
        result: bereitsErledigt.result,
        duplicate: true,
        completedAt: bereitsErledigt.completedAt,
      });
      return;
    }

    if (!this.correlations.markInFlight(correlationId)) {
      // Läuft oder wartet bereits – die Antwort darauf folgt ohnehin.
      this.log.info('Befehl läuft bereits – Duplikat verworfen', { correlationId, command });
      return;
    }

    this.enqueueCommand(frame);
  }

  /** Hängt den Befehl an die Warteschlange seines Servers an. */
  private enqueueCommand(frame: BackendCommandFrame): void {
    const lane = frame.serverId ?? NODE_LANE;
    const vorgaenger = this.commandLanes.get(lane) ?? Promise.resolve();
    const naechster = vorgaenger.then(() => this.executeCommand(frame));

    this.commandLanes.set(lane, naechster);
    void naechster.then(() => {
      // Nur aufräumen, wenn seitdem nichts Neues angehängt wurde – sonst würde
      // die Map bei einem dauerhaft laufenden Agent unbegrenzt wachsen.
      if (this.commandLanes.get(lane) === naechster) {
        this.commandLanes.delete(lane);
      }
    });
  }

  private async executeCommand(frame: BackendCommandFrame): Promise<void> {
    const { correlationId, command } = frame;
    let result: ApiResponse<unknown>;
    try {
      result = await this.options.runtime.execute({
        correlationId,
        command,
        serverId: frame.serverId,
        payload: frame.payload,
      });
    } catch (error) {
      // Eine geworfene Ausnahme darf nicht dazu führen, dass das Backend ewig
      // auf eine Antwort wartet.
      const meldung = error instanceof Error ? error.message : String(error);
      this.log.error('Befehlsausführung abgebrochen', { correlationId, command, fehler: meldung });
      result = fail('AGENT_COMMAND_FAILED', `${command}: ${meldung}`);
    }

    const completedAt = new Date().toISOString();
    this.correlations.complete({ correlationId, command, result, completedAt });

    this.sendFrame({
      kind: 'commandResult',
      correlationId,
      command,
      result,
      duplicate: false,
      completedAt,
    });
  }

  // -------------------------------------------------------------------------
  // Ist-Zustand
  // -------------------------------------------------------------------------

  /**
   * Meldet den vollständigen Ist-Zustand aller bekannten Container
   * (Pflichtenheft §2.2) – immer vollständig, nie als Teilmenge.
   */
  private async sendStateReport(reason: AgentStateReportReason): Promise<void> {
    let containers: readonly AgentContainerState[];
    try {
      containers = await this.options.runtime.listContainerStates();
    } catch (error) {
      // Bewusst kein leerer Bericht: „keine Container" wäre für das Backend die
      // Aussage, dass nichts läuft, und würde einen Soll/Ist-Abgleich auslösen,
      // der laufende Server anfasst.
      this.log.error('Ist-Zustand nicht ermittelbar – kein Bericht gesendet', {
        anlass: reason,
        fehler: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // Gemessene Node-Ressourcen begleiten den Bericht (Pflichtenheft §11). Ein
    // Fehlschlag lässt den Bericht bewusst nicht scheitern: Der Ist-Zustand der
    // Container ist der eigentliche Zweck, die Ressourcenmessung nur die Zugabe.
    let nodeStats: AgentNodeStats | undefined;
    if (this.options.readNodeStats) {
      try {
        nodeStats = (await this.options.readNodeStats()) ?? undefined;
      } catch (error) {
        this.log.warn('Node-Ressourcen nicht messbar – Bericht ohne nodeStats', {
          fehler: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const gesendet = this.sendFrame({
      kind: 'stateReport',
      reason,
      containers,
      ...(nodeStats ? { nodeStats } : {}),
      reportedAt: new Date().toISOString(),
    });

    if (gesendet) {
      this.log.info('Ist-Zustand gemeldet', {
        anlass: reason,
        container: containers.length,
        nodeStats: nodeStats !== undefined,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Hilfsfunktionen
  // -------------------------------------------------------------------------

  private sendFrame(frame: AgentToBackendFrame): boolean {
    const transport = this.transport;
    if (!transport) {
      this.log.warn('Frame nicht gesendet – keine Verbindung', { kind: frame.kind });
      return false;
    }
    transport.send(JSON.stringify(frame));
    return true;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }
}
