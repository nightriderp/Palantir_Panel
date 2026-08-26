/**
 * Backend-Gegenstück zum Agent-Protokoll (Pflichtenheft §2.2 und §5.3).
 *
 * Der Agent baut die Verbindung auf, das Backend nimmt sie an. Hier steht die
 * Protokoll-Logik einer solchen Verbindung: Handshake, Korrelations-IDs,
 * Zuordnung von Befehl und Ergebnis, Fristen, Weiterreichen der Ereignisse.
 *
 * Die Datei kennt Fastify nicht und `ws` nicht – sie arbeitet gegen
 * {@link AgentSocket}, eine Schnittstelle mit zwei Methoden. Das Einhängen in
 * Fastify steht in `agent-route.ts`. Grund ist derselbe wie bei
 * `ContainerRuntime` im Agent (Pflichtenheft §2.5): Der heikle Teil – was
 * passiert bei einem doppelten Ergebnis, bei einer Frist, bei einem Abbruch
 * mitten im Befehl – ist ohne echten Socket prüfbar.
 *
 * Festlegungen aus Pflichtenheft §5.3, die hier umgesetzt werden:
 * - Korrelations-ID: UUID v4, erzeugt vom **Backend**
 * - Token im `Authorization: Bearer …`-Header des Handshakes, nicht im Frame
 * - Befehlsergebnisse nutzen den Response-Envelope aus §5.1
 * - Ein Ergebnis mit `duplicate: true` ist die Wiederholung eines bereits
 *   verarbeiteten Befehls und wird wie ein reguläres Ergebnis behandelt
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AGENT_PROTOCOL_VERSION,
  type AgentCommandName,
  type AgentCommandPayloads,
  type AgentCommandResultFrame,
  type AgentCommandResults,
  type AgentEventFrame,
  type AgentStateReportFrame,
  type ApiResponse,
  type BackendCommandFrame,
  type BackendStateRequestFrame,
  type BackendToAgentFrame,
  type BackendWelcomeFrame,
  type CorrelationId,
  isErrorCode,
} from '@palantir/contracts';
import { agentToBackendFrameSchema } from '@palantir/validation';
import { ServerOrchestrationError } from './errors.js';

/**
 * Close-Code für eine abgelehnte Authentifizierung.
 *
 * Muss zu `CLOSE_CODE_UNAUTHORIZED` in
 * `apps/agent/src/connection/websocket-transport.ts` passen – der Agent
 * unterscheidet daran „falsches Token" (Reconnect hilft nicht) von „Backend
 * gerade weg" (Reconnect hilft).
 */
export const CLOSE_CODE_UNAUTHORIZED = 4401;

/** Close-Code bei unterschiedlicher Protokollversion. */
export const CLOSE_CODE_PROTOCOL_MISMATCH = 4400;

/** Close-Code, wenn das Backend die Verbindung regulär beendet. */
export const CLOSE_CODE_GOING_AWAY = 1001;

/** Was diese Datei von einem WebSocket braucht – mehr nicht. */
export interface AgentSocket {
  send(data: string): void;
  close(code: number, reason: string): void;
}

export interface AgentGatewayLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface AgentSessionHandlers {
  /** Vollständiger Ist-Zustands-Bericht – Grundlage des Soll/Ist-Abgleichs. */
  onStateReport(hostId: string, frame: AgentStateReportFrame): Promise<void> | void;
  /** Unaufgefordertes Ereignis (`STATUS_CHANGED`, `STATS_UPDATE`, `LOG_LINE`, `CRASHED`). */
  onEvent(hostId: string, frame: AgentEventFrame): Promise<void> | void;
}

export interface AgentSessionOptions {
  readonly hostId: string;
  readonly socket: AgentSocket;
  readonly handlers: AgentSessionHandlers;
  readonly log: AgentGatewayLogger;
  /** Frist, in der ein Befehl beantwortet sein muss. */
  readonly commandTimeoutMs?: number;
  /** Nur für Tests: feste Zeit bzw. feste Korrelations-IDs. */
  readonly now?: () => Date;
  readonly newCorrelationId?: () => CorrelationId;
}

interface PendingCommand {
  readonly command: AgentCommandName;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Standard-Frist eines Befehls.
 *
 * 30 Sekunden: großzügig genug für ein `CREATE` samt Anlegen der Verzeichnisse,
 * eng genug, dass ein hängender Homeserver nicht einen Request-Handler auf der
 * VPS blockiert. Lange Vorgänge (Backups, Restore) bekommen von A3 einen
 * eigenen Weg über Ereignisse und werden nicht über diese Frist abgewickelt.
 */
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

/**
 * Eine offene Verbindung zu einem Agent.
 *
 * Lebensdauer = Lebensdauer der WebSocket-Verbindung. Nach einem Abbruch legt
 * der Agent eine neue an (exponentielles Backoff, A1) und meldet erneut seinen
 * vollständigen Ist-Zustand.
 */
export class AgentSession {
  readonly hostId: string;

  private readonly socket: AgentSocket;
  private readonly handlers: AgentSessionHandlers;
  private readonly log: AgentGatewayLogger;
  private readonly commandTimeoutMs: number;
  private readonly now: () => Date;
  private readonly newCorrelationId: () => CorrelationId;
  private readonly pending = new Map<CorrelationId, PendingCommand>();

  private helloReceived = false;
  private closed = false;

  constructor(options: AgentSessionOptions) {
    this.hostId = options.hostId;
    this.socket = options.socket;
    this.handlers = options.handlers;
    this.log = options.log;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.now = options.now ?? ((): Date => new Date());
    this.newCorrelationId = options.newCorrelationId ?? ((): string => randomUUID());
  }

  /** `true`, solange die Verbindung benutzbar ist. */
  get isOpen(): boolean {
    return !this.closed;
  }

  /** `true`, sobald der Handshake abgeschlossen ist. */
  get isReady(): boolean {
    return this.helloReceived && !this.closed;
  }

  /**
   * Verarbeitet einen eingehenden Frame.
   *
   * Ungültige Nachrichten beenden die Verbindung **nicht**: Ein einzelner
   * kaputter Frame ist kein Grund, einen laufenden Server unbeaufsichtigt zu
   * lassen. Er wird protokolliert und verworfen.
   */
  handleMessage(raw: string): void {
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(raw);
    } catch {
      this.log.warn({ hostId: this.hostId }, 'Agent-Frame war kein gültiges JSON');
      return;
    }

    const parsed = agentToBackendFrameSchema.safeParse(parsedJson);

    if (!parsed.success) {
      this.log.warn(
        { hostId: this.hostId, issues: parsed.error.issues },
        'Agent-Frame entspricht nicht dem Protokoll',
      );
      return;
    }

    const frame = parsed.data;

    switch (frame.kind) {
      case 'hello':
        this.handleHello(frame.protocolVersion, frame.agentVersion);
        return;
      case 'stateReport':
        void this.handlers.onStateReport(this.hostId, frame as AgentStateReportFrame);
        return;
      case 'event':
        void this.handlers.onEvent(this.hostId, frame as AgentEventFrame);
        return;
      case 'commandResult':
        this.handleCommandResult(frame as AgentCommandResultFrame);
        return;
    }
  }

  private handleHello(protocolVersion: number, agentVersion: string): void {
    if (protocolVersion !== AGENT_PROTOCOL_VERSION) {
      this.log.error(
        { hostId: this.hostId, agentVersion, protocolVersion, expected: AGENT_PROTOCOL_VERSION },
        'Agent spricht eine andere Protokollversion',
      );
      this.close(
        CLOSE_CODE_PROTOCOL_MISMATCH,
        `Erwartet wird Protokollversion ${String(AGENT_PROTOCOL_VERSION)}.`,
      );
      return;
    }

    this.helloReceived = true;
    this.log.info({ hostId: this.hostId, agentVersion }, 'Agent verbunden');

    const welcome: BackendWelcomeFrame = {
      kind: 'welcome',
      protocolVersion: AGENT_PROTOCOL_VERSION,
      sentAt: this.now().toISOString(),
    };

    this.sendFrame(welcome);
  }

  private handleCommandResult(frame: AgentCommandResultFrame): void {
    const pending = this.pending.get(frame.correlationId);

    if (pending === undefined) {
      // Kommt regulär vor: Ein Ergebnis, dessen Frist bereits abgelaufen war,
      // oder eine Wiederholung nach einem Reconnect. Verwerfen ist richtig –
      // der Aufrufer hat längst eine Antwort bekommen.
      this.log.warn(
        { hostId: this.hostId, correlationId: frame.correlationId, command: frame.command },
        'Ergebnis ohne offenen Befehl verworfen',
      );
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(frame.correlationId);

    const result = frame.result as ApiResponse<unknown>;

    if (result.success) {
      pending.resolve(result.data);
      return;
    }

    const code = result.error?.code;

    pending.reject(
      new ServerOrchestrationError(
        code !== undefined && isErrorCode(code) ? code : 'AGENT_COMMAND_FAILED',
        result.error?.message,
        {
          hostId: this.hostId,
          correlationId: frame.correlationId,
          command: frame.command,
          duplicate: frame.duplicate,
        },
      ),
    );
  }

  /**
   * Schickt einen Befehl und wartet auf das Ergebnis.
   *
   * Der Rückgabewert ist das `data` aus dem Envelope; ein Fehlschlag wird als
   * {@link ServerOrchestrationError} mit dem benannten Code des Agents geworfen,
   * nicht als Rückgabewert – der Aufrufer soll ihn nicht übersehen können.
   */
  sendCommand<TCommand extends AgentCommandName>(
    command: TCommand,
    serverId: string | null,
    payload: AgentCommandPayloads[TCommand],
  ): Promise<AgentCommandResults[TCommand]> {
    if (!this.isReady) {
      return Promise.reject(
        new ServerOrchestrationError('AGENT_NOT_CONNECTED', undefined, {
          hostId: this.hostId,
          command,
        }),
      );
    }

    const correlationId = this.newCorrelationId();

    const frame: BackendCommandFrame = {
      kind: 'command',
      correlationId,
      command,
      serverId,
      payload,
      issuedAt: this.now().toISOString(),
    };

    return new Promise<AgentCommandResults[TCommand]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(
          new ServerOrchestrationError('AGENT_COMMAND_TIMEOUT', undefined, {
            hostId: this.hostId,
            correlationId,
            command,
          }),
        );
      }, this.commandTimeoutMs);

      this.pending.set(correlationId, {
        command,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.sendFrame(frame);
    });
  }

  /** Fordert einen vollständigen Ist-Zustands-Bericht an (Pflichtenheft §2.2). */
  requestState(): void {
    const frame: BackendStateRequestFrame = {
      kind: 'stateRequest',
      requestedAt: this.now().toISOString(),
    };

    this.sendFrame(frame);
  }

  /**
   * Beendet die Verbindung und bricht alle offenen Befehle ab.
   *
   * Offene Befehle scheitern mit `AGENT_NOT_CONNECTED` statt still zu hängen:
   * Ein Aufrufer, der auf ein `STOP` wartet, muss erfahren, dass es nie
   * ankommen wird.
   */
  close(code: number = CLOSE_CODE_GOING_AWAY, reason = 'Verbindung wird beendet.'): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    for (const [correlationId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new ServerOrchestrationError('AGENT_NOT_CONNECTED', undefined, {
          hostId: this.hostId,
          correlationId,
          command: pending.command,
        }),
      );
    }

    this.pending.clear();
    this.socket.close(code, reason);
  }

  /** Wird gerufen, wenn die Gegenseite die Verbindung geschlossen hat. */
  handleSocketClosed(code: number, reason: string): void {
    if (this.closed) {
      return;
    }

    this.log.warn({ hostId: this.hostId, code, reason }, 'Agent-Verbindung beendet');
    this.close(code, reason);
  }

  private sendFrame(frame: BackendToAgentFrame): void {
    if (this.closed) {
      return;
    }

    this.socket.send(JSON.stringify(frame));
  }
}

/**
 * Alle offenen Agent-Verbindungen, nach Node.
 *
 * Bewusst nur im Arbeitsspeicher: Eine Verbindung überlebt keinen Neustart des
 * Backends, und der Agent baut nach einem Neustart ohnehin neu auf und meldet
 * seinen vollständigen Ist-Zustand (Pflichtenheft §2.2).
 */
export class AgentRegistry {
  private readonly sessions = new Map<string, AgentSession>();

  /**
   * Trägt eine Verbindung ein.
   *
   * Eine bereits bestehende Verbindung derselben Node wird beendet: Zwei
   * gleichzeitige Agents auf einer Node würden dieselben Container doppelt
   * steuern. Die neuere gewinnt, weil die ältere in aller Regel eine bereits
   * tote Verbindung ist, deren Abbruch das Backend noch nicht bemerkt hat.
   */
  register(session: AgentSession): void {
    const existing = this.sessions.get(session.hostId);

    if (existing !== undefined && existing !== session) {
      existing.close(CLOSE_CODE_GOING_AWAY, 'Eine neuere Verbindung dieser Node hat übernommen.');
    }

    this.sessions.set(session.hostId, session);
  }

  unregister(session: AgentSession): void {
    if (this.sessions.get(session.hostId) === session) {
      this.sessions.delete(session.hostId);
    }
  }

  /** Verbindung einer Node; `null`, wenn gerade keine besteht. */
  get(hostId: string): AgentSession | null {
    const session = this.sessions.get(hostId);

    return session !== undefined && session.isReady ? session : null;
  }

  /** Wie {@link get}, bricht aber mit `AGENT_NOT_CONNECTED` ab. */
  require(hostId: string): AgentSession {
    const session = this.get(hostId);

    if (session === null) {
      throw new ServerOrchestrationError('AGENT_NOT_CONNECTED', undefined, { hostId });
    }

    return session;
  }

  /** Alle Nodes mit offener Verbindung. */
  connectedHostIds(): readonly string[] {
    return [...this.sessions.entries()]
      .filter(([, session]) => session.isReady)
      .map(([hostId]) => hostId);
  }

  /** Beendet alle Verbindungen – für den Shutdown des Backends. */
  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.close(CLOSE_CODE_GOING_AWAY, 'Das Backend wird beendet.');
    }

    this.sessions.clear();
  }
}

/**
 * Prüft das Pre-Shared-Token aus dem `Authorization`-Header (Pflichtenheft §2.2).
 *
 * Der Vergleich läuft zeitkonstant: Ein Vergleich mit `===` bricht beim ersten
 * abweichenden Zeichen ab und verrät über die Laufzeit, wie viele Zeichen
 * stimmen. Das ist über einen WireGuard-Tunnel schwer auszunutzen, aber der
 * richtige Vergleich kostet hier nichts.
 */
export function isAuthorizedAgentHandshake(
  authorizationHeader: string | undefined,
  expectedToken: string | undefined,
): boolean {
  if (expectedToken === undefined || expectedToken.length === 0) {
    // Ohne konfiguriertes Token gibt es keine Authentifizierung – dann wird
    // gar keine Verbindung angenommen. Ein offener Agent-Endpunkt wäre ein
    // vollständiger Zugriff auf den Homeserver (Pflichtenheft §18).
    return false;
  }

  if (authorizationHeader === undefined) {
    return false;
  }

  const match = /^Bearer (.+)$/.exec(authorizationHeader);
  const presented = match?.[1];

  if (presented === undefined) {
    return false;
  }

  const presentedBytes = Buffer.from(presented, 'utf8');
  const expectedBytes = Buffer.from(expectedToken, 'utf8');

  if (presentedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(presentedBytes, expectedBytes);
}
