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
  type ErrorCode,
  isErrorCode,
} from '@palantir/contracts';
import { fireAndForget } from '../../lib/fire-and-forget.js';
import {
  CLOSE_CODE_FRAME_TOO_LARGE,
  MAX_AGENT_COMMAND_RESULT_BYTES,
  MAX_AGENT_FRAME_BYTES,
  frameKindOf,
  hatBefund,
  parseAgentFrame,
} from './agent-frame.js';
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

export {
  CLOSE_CODE_FRAME_TOO_LARGE,
  MAX_AGENT_COMMAND_RESULT_BYTES,
  MAX_AGENT_FRAME_BYTES,
} from './agent-frame.js';

/**
 * Fehlercodes, die ein Agent in einem `commandResult` melden darf
 * (Audit security-matrix-07).
 *
 * Bisher wurde jeder Code aus dem Katalog übernommen (`isErrorCode`) und vom
 * Aufrufer als `ServerOrchestrationError` bis in die HTTP-Antwort
 * durchgereicht. Damit bestimmte der Agent den HTTP-Status des Nutzers:
 * Antwortet er auf ein `START` mit `AUTH_REQUIRED`, bekäme der Nutzer eine 401,
 * und das Frontend begänne eine Sitzungs-Erneuerung für einen Fehler, der mit
 * seiner Anmeldung nichts zu tun hat; `AUTH_ACCOUNT_BANNED` ergäbe die Meldung
 * „Konto gesperrt" für einen fehlgeschlagenen Serverstart.
 *
 * Die Liste ist deshalb bewusst geschlossen und deckt genau das ab, was der
 * Agent selbst erzeugt: die Werte aus `RUNTIME_ERROR_TO_API_CODE`
 * (`apps/agent/src/connection/runtime-adapter.ts`) plus die drei Codes, die er
 * in `execute()`/`toErrorResponse()` direkt setzt. Nicht enthalten sind die
 * vier `AGENT_*`-Codes, die dem Backend bzw. dem Handshake gehören
 * (`AGENT_UNAUTHORIZED`, `AGENT_PROTOCOL_VERSION_MISMATCH`,
 * `AGENT_NOT_CONNECTED`, `AGENT_COMMAND_TIMEOUT`) – sie beschreiben Zustände,
 * über die nicht der Agent urteilt.
 *
 * Alles andere wird zu `AGENT_COMMAND_FAILED` (500) und ist im Log mit dem
 * ursprünglich gemeldeten Code nachvollziehbar.
 */
const AGENT_REPORTABLE_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'AGENT_COMMAND_INVALID',
  'AGENT_COMMAND_FAILED',
  'AGENT_COMMAND_NOT_IMPLEMENTED',
  'AGENT_CONTAINER_NOT_FOUND',
  'AGENT_CONTAINER_NOT_RUNNING',
  'AGENT_CONTAINER_STATE_CONFLICT',
  'AGENT_CONTAINER_NAME_CONFLICT',
  'AGENT_IMAGE_NOT_FOUND',
  'AGENT_INVALID_PATH',
  'AGENT_FILE_NOT_FOUND',
  'AGENT_FILE_TOO_LARGE',
  'AGENT_FILE_EXISTS',
  'AGENT_ARCHIVE_INVALID',
  'AGENT_RUNTIME_UNAVAILABLE',
  // Der Agent prüft die Prüfsumme eines Backups selbst und meldet sie unter
  // diesem Code (`RUNTIME_ERROR_TO_API_CODE.CHECKSUM_MISMATCH`).
  'BACKUP_CHECKSUM_MISMATCH',
]);

/** `true`, wenn der Agent diesen Fehlercode melden darf. */
export function isAgentReportableErrorCode(code: string): code is ErrorCode {
  return isErrorCode(code) && AGENT_REPORTABLE_ERROR_CODES.has(code);
}

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
  /**
   * Der Handshake ist abgeschlossen, die Node gilt ab jetzt als verbunden.
   * Optional, damit Tests ohne Persistenz auskommen; ein Fehler hier darf die
   * Verbindung nicht abreißen (siehe Verdrahtung in `index.ts`).
   */
  onConnected?(hostId: string): Promise<void> | void;
  /**
   * Die Verbindung ist beendet – Gegenstück zu {@link onConnected}.
   *
   * @param getrenntSeit Zeitpunkt, zu dem die Trennung bemerkt wurde. Additiv
   * (Audit event-flow-12): Wer den Node-Status fortschreibt, kann damit
   * erkennen, ob inzwischen längst eine neuere Verbindung derselben Node
   * angemeldet ist, und die späte Abmeldung dann fallen lassen. Bestehende
   * Handler, die das Argument nicht nehmen, bleiben gültig.
   */
  onDisconnected?(hostId: string, getrenntSeit: Date): Promise<void> | void;
}

export interface AgentSessionOptions {
  readonly hostId: string;
  readonly socket: AgentSocket;
  readonly handlers: AgentSessionHandlers;
  readonly log: AgentGatewayLogger;
  /** Frist, in der ein Befehl beantwortet sein muss. */
  readonly commandTimeoutMs?: number;
  /**
   * Größte zulässige Nutzlast eines Frames, den der Agent von sich aus schickt;
   * Standard {@link MAX_AGENT_FRAME_BYTES}. Vorgesehen für Tests, die die
   * Grenze nicht mit einem MiB Testdaten überschreiten wollen.
   */
  readonly maxFrameBytes?: number;
  /**
   * Größte zulässige Nutzlast eines `commandResult`; Standard
   * {@link MAX_AGENT_COMMAND_RESULT_BYTES}. Siehe dort, warum
   * Befehlsergebnisse eine eigene Grenze brauchen.
   */
  readonly maxCommandResultBytes?: number;
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
  private readonly maxFrameBytes: number;
  private readonly maxCommandResultBytes: number;
  private readonly now: () => Date;
  private readonly newCorrelationId: () => CorrelationId;
  private readonly pending = new Map<CorrelationId, PendingCommand>();

  private helloReceived = false;
  private closed = false;

  /**
   * Läuft, sobald {@link onDisconnected} dieser Sitzung durch ist.
   *
   * Die Übernahme durch eine neue Verbindung derselben Node wartet darauf,
   * bevor sie sich anmeldet (Audit event-flow-12). Lehnt der Handler ab, gilt
   * die Abmeldung trotzdem als abgeschlossen – die neue Verbindung darf nicht
   * daran hängen bleiben, dass die alte sich nicht abmelden konnte.
   */
  private abmeldungAbgeschlossen: Promise<void> = Promise.resolve();

  /**
   * Wartepunkt vor der Anmeldung, gesetzt von {@link AgentRegistry.register}
   * bei einer Übernahme; `null` im Regelfall (keine Vorgängerverbindung).
   */
  private uebernahmeVon: Promise<void> | null = null;

  constructor(options: AgentSessionOptions) {
    this.hostId = options.hostId;
    this.socket = options.socket;
    this.handlers = options.handlers;
    this.log = options.log;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.maxFrameBytes = options.maxFrameBytes ?? MAX_AGENT_FRAME_BYTES;
    this.maxCommandResultBytes = options.maxCommandResultBytes ?? MAX_AGENT_COMMAND_RESULT_BYTES;
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
   * Läuft, sobald die Abmeldung dieser Sitzung durch ist.
   *
   * Nur für die Registry: Eine übernehmende Verbindung derselben Node wartet
   * darauf, bevor sie sich anmeldet (Audit event-flow-12).
   */
  get disconnectSettled(): Promise<void> {
    return this.abmeldungAbgeschlossen;
  }

  /**
   * Verzögert die Anmeldung dieser Sitzung, bis `abmeldungDerVorherigen` durch
   * ist – gerufen von {@link AgentRegistry.register} bei einer Übernahme.
   */
  deferConnectUntil(abmeldungDerVorherigen: Promise<void>): void {
    this.uebernahmeVon = abmeldungDerVorherigen;
  }

  /**
   * Verarbeitet einen eingehenden Frame.
   *
   * Ungültige Nachrichten beenden die Verbindung **nicht**: Ein einzelner
   * kaputter Frame ist kein Grund, einen laufenden Server unbeaufsichtigt zu
   * lassen. Er wird protokolliert und verworfen. Zwei Ausnahmen gibt es
   * (Audit security-matrix-07): ein Frame über der Größengrenze beendet sie,
   * und vor dem Handshake wird alles außer `hello` verworfen.
   *
   * Der Rohwert darf ein `Buffer` sein: Die Größenprüfung greift dann, bevor
   * die Nutzlast als String im Speicher landet.
   */
  handleMessage(raw: string | Buffer): void {
    if (this.closed) {
      // Nach dem Schließen ist nichts mehr zu verarbeiten – ein noch in der
      // Warteschlange liegender Frame darf keinen Vorgang mehr auslösen.
      return;
    }

    const groesseBytes = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.byteLength;

    /*
     * Zweistufige Größengrenze (Audit security-matrix-07).
     *
     * Vor dem Parsen ist der `kind` noch unbekannt – genau darum geht es ja:
     * Ein 100-MiB-Frame soll nicht erst dekodiert und dann verworfen werden.
     * Maßgeblich ist deshalb, ob überhaupt ein Befehl offen ist. Nur dann kann
     * ein `commandResult` legitim sein, und nur dann gilt die weite Grenze.
     * Eine Verbindung im Leerlauf – der Normalfall – kommt nie über 1 MiB je
     * Frame hinaus.
     */
    const erwartetErgebnis = this.pending.size > 0;
    const vorpruefung = erwartetErgebnis ? this.maxCommandResultBytes : this.maxFrameBytes;

    if (groesseBytes > vorpruefung) {
      this.meldeZuGross(groesseBytes, vorpruefung);

      return;
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    } catch {
      this.log.warn({ hostId: this.hostId }, 'Agent-Frame war kein gültiges JSON');
      return;
    }

    const kind = frameKindOf(parsedJson);

    /*
     * Jetzt steht der `kind` fest: Die weite Grenze gilt ausschließlich für
     * Befehlsergebnisse. Sonst könnte ein Agent, während ein Download läuft,
     * eine 85-MiB-Konsolenzeile mitschicken – und die ginge an alle Abonnenten
     * des Live-Kanals.
     */
    if (kind !== 'commandResult' && groesseBytes > this.maxFrameBytes) {
      this.meldeZuGross(groesseBytes, this.maxFrameBytes, kind);

      return;
    }

    /*
     * Vor dem Handshake zählt nur `hello` (Audit security-matrix-07).
     *
     * Bisher lösten `stateReport` und `event` den Soll/Ist-Abgleich bzw. die
     * Ereignisverarbeitung aus, ohne dass `handleHello` je gelaufen wäre – die
     * Prüfung der Protokollversion und der gemeldeten Node-Kennung ließ sich
     * damit schlicht überspringen. Verworfen wird still bis auf eine Zeile im
     * Log; die Verbindung bleibt offen, damit ein Agent, dessen `hello` sich
     * verzögert, nicht in eine Reconnect-Schleife läuft.
     */
    if (!this.helloReceived && kind !== 'hello') {
      this.log.warn(
        { hostId: this.hostId, kind },
        'Agent-Frame vor dem Handshake verworfen – zuerst wird hello erwartet',
      );

      return;
    }

    const parsed = parseAgentFrame(parsedJson);

    if (!parsed.ok) {
      this.log.warn(
        { hostId: this.hostId, issues: parsed.issues },
        'Agent-Frame entspricht nicht dem Protokoll',
      );
      return;
    }

    /*
     * Die Handler laufen bewusst neben dem Socket-Callback her – ein
     * Soll/Ist-Abgleich darf den Empfang weiterer Frames nicht blockieren.
     * Ihre Fehler müssen aber gefangen werden (Audit W0-5, Fundpunkt 126):
     * Ein zweites `CRASHED` für einen bereits abgestürzten Server oder eine
     * kurz nicht erreichbare Datenbank wären sonst eine unbehandelte
     * Ablehnung, und Node beendete damit das ganze Backend. Ein fehlerhafter
     * (oder feindlicher, aber authentifizierter) Agent könnte das Panel so
     * beliebig oft abschießen.
     */
    if (parsed.kind === 'stateReport') {
      const report = parsed.frame;

      if (hatBefund(parsed.befund)) {
        // Der Bericht wird trotzdem verarbeitet (Audit contract-drift-05) –
        // aber es soll sichtbar sein, dass er unvollständig war.
        this.log.warn(
          { hostId: this.hostId, reason: report.reason, ...parsed.befund },
          'Ist-Zustands-Bericht war teilweise unlesbar – der Kern wird verarbeitet',
        );
      }

      fireAndForget(this.handlers.onStateReport(this.hostId, report), this.log, {
        vorgang: 'Ist-Zustands-Bericht des Agents verarbeiten',
        hostId: this.hostId,
        reason: report.reason,
      });

      return;
    }

    const frame = parsed.frame;

    switch (frame.kind) {
      case 'hello':
        this.handleHello(frame.protocolVersion, frame.agentVersion, frame.nodeId ?? null);
        return;
      case 'event': {
        const event = frame as AgentEventFrame;

        fireAndForget(this.handlers.onEvent(this.hostId, event), this.log, {
          vorgang: 'Agent-Ereignis verarbeiten',
          hostId: this.hostId,
          event: event.event,
          serverId: event.serverId,
        });
        return;
      }
      case 'commandResult':
        this.handleCommandResult(frame as AgentCommandResultFrame);
        return;
    }
  }

  private handleHello(protocolVersion: number, agentVersion: string, nodeId: string | null): void {
    /*
     * Nennt der Agent eine Node, muss sie zu der passen, der sein Token gehört
     * (Gefundener Punkt 57). Beides auseinander zu halten wäre schlimmer als
     * beides zu verlangen: Wer hier der einen oder der anderen Angabe glaubt,
     * ordnet im Zweifel Befehle der falschen Node zu. Ein Agent ohne Kennung
     * wird nicht abgewiesen – das Feld ist additiv, das Token bleibt der
     * Nachweis.
     */
    if (nodeId !== null && nodeId !== this.hostId) {
      this.log.error(
        { hostId: this.hostId, agentVersion, gemeldeteNode: nodeId },
        'Agent meldet eine andere Node als sein Token',
      );
      this.close(CLOSE_CODE_UNAUTHORIZED, 'Node-Kennung passt nicht zum Agent-Token.');

      return;
    }

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
    this.meldeVerbunden();

    const welcome: BackendWelcomeFrame = {
      kind: 'welcome',
      protocolVersion: AGENT_PROTOCOL_VERSION,
      sentAt: this.now().toISOString(),
    };

    this.sendFrame(welcome);
  }

  /**
   * Protokolliert einen zu großen Frame und beendet die Verbindung.
   *
   * Das Log nennt beides – gemessene Größe und die Grenze, die gegriffen hat –,
   * damit im Betrieb ohne Nachrechnen erkennbar ist, ob eine Datei zu groß war
   * oder ein Agent aus der Reihe tanzt.
   */
  private meldeZuGross(groesseBytes: number, grenzeBytes: number, kind?: string | null): void {
    this.log.error(
      {
        hostId: this.hostId,
        groesseBytes,
        grenzeBytes,
        ...(kind === undefined ? {} : { kind }),
      },
      'Agent-Frame überschreitet die zulässige Größe – Verbindung wird beendet',
    );
    this.close(CLOSE_CODE_FRAME_TOO_LARGE, 'Frame überschreitet die zulässige Größe.');
  }

  /**
   * Meldet die Node als verbunden – bei einer Übernahme erst, nachdem die
   * vorherige Verbindung abgemeldet ist (Audit event-flow-12).
   *
   * Ohne diese Reihenfolge liefen `markHostDisconnected` (alte Sitzung) und
   * `markHostConnected` (neue Sitzung) als zwei nicht abgewartete Promises auf
   * verschiedenen Pool-Verbindungen; landete der `offline`-Schreibvorgang nach
   * dem `online`-Schreibvorgang, zeigte die Node-Übersicht „offline" bei
   * verbundenem Agent – und `requireNodeAcceptsStarts` lehnte Starts mit
   * `NODE_UNAVAILABLE` ab, obwohl der Homeserver da war.
   *
   * Ohne Übernahme bleibt es beim bisherigen, sofortigen Melden: Ein
   * zusätzlicher Microtask würde nur die Reihenfolge gegenüber allem anderen
   * verschieben, ohne etwas zu gewinnen.
   */
  private meldeVerbunden(): void {
    const vorherige = this.uebernahmeVon;

    if (vorherige === null) {
      fireAndForget(this.handlers.onConnected?.(this.hostId), this.log, {
        vorgang: 'Node als verbunden melden',
        hostId: this.hostId,
      });

      return;
    }

    this.uebernahmeVon = null;

    fireAndForget(
      (async (): Promise<void> => {
        await vorherige;

        if (this.closed) {
          // Diese Sitzung ist während des Wartens selbst weggefallen – sie als
          // verbunden zu melden, wäre genau der Fehler, den die Reihenfolge
          // verhindern soll.
          return;
        }

        await this.handlers.onConnected?.(this.hostId);
      })(),
      this.log,
      { vorgang: 'Node als verbunden melden', hostId: this.hostId },
    );
  }

  /**
   * Meldet die Node als getrennt und hält den Lauf fest, damit eine
   * übernehmende Verbindung darauf warten kann.
   */
  private meldeGetrennt(): void {
    const getrenntSeit = this.now();
    const lauf = (async (): Promise<void> => {
      await this.handlers.onDisconnected?.(this.hostId, getrenntSeit);
    })();

    // Der Wartepunkt darf nie ablehnen: Eine gescheiterte Abmeldung hält die
    // Anmeldung der Nachfolgeverbindung nicht auf (gemeldet wird sie unten).
    this.abmeldungAbgeschlossen = lauf.then(
      () => undefined,
      () => undefined,
    );

    fireAndForget(lauf, this.log, {
      vorgang: 'Node als getrennt melden',
      hostId: this.hostId,
    });
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
    /*
     * Nur Codes aus {@link AGENT_REPORTABLE_ERROR_CODES} werden übernommen
     * (Audit security-matrix-07). Vorher entschied der Agent über den
     * HTTP-Status des Nutzers, weil `replyWithOrchestrationError()` den Code
     * eins zu eins in den Envelope legt.
     */
    const uebernommen: ErrorCode | null =
      code !== undefined && isAgentReportableErrorCode(code) ? code : null;
    const abgelehnt = code !== undefined && uebernommen === null;

    if (abgelehnt) {
      this.log.warn(
        {
          hostId: this.hostId,
          correlationId: frame.correlationId,
          command: frame.command,
          gemeldeterCode: code,
        },
        'Agent meldete einen Fehlercode, den er nicht setzen darf – als AGENT_COMMAND_FAILED behandelt',
      );
    }

    pending.reject(
      new ServerOrchestrationError(uebernommen ?? 'AGENT_COMMAND_FAILED', result.error?.message, {
        hostId: this.hostId,
        correlationId: frame.correlationId,
        command: frame.command,
        duplicate: frame.duplicate,
        ...(abgelehnt ? { gemeldeterCode: code } : {}),
      }),
    );
  }

  /**
   * Schickt einen Befehl und wartet auf das Ergebnis.
   *
   * Der Rückgabewert ist das `data` aus dem Envelope; ein Fehlschlag wird als
   * {@link ServerOrchestrationError} mit dem benannten Code des Agents geworfen,
   * nicht als Rückgabewert – der Aufrufer soll ihn nicht übersehen können.
   */
  /**
   * @param options.timeoutMs Eigene Frist für diesen Befehl.
   *
   * Nötig, seit der Agent fehlende Images selbst holt (Gefundener Punkt 111):
   * Ein Spiel-Image bringt Hunderte MB mit, das erste `CREATE` einer Definition
   * dauert damit Minuten. Die übliche Frist gilt weiter für alles andere – ein
   * `STOP`, das eine Viertelstunde offen bleibt, wäre kein Fortschritt.
   */
  sendCommand<TCommand extends AgentCommandName>(
    command: TCommand,
    serverId: string | null,
    payload: AgentCommandPayloads[TCommand],
    options: { readonly timeoutMs?: number } = {},
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
      }, options.timeoutMs ?? this.commandTimeoutMs);

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

    // Nur melden, wenn der Handshake überhaupt durchlief – sonst wurde die Node
    // nie als verbunden geführt und dürfte auch nicht als getrennt gemeldet
    // werden (z. B. bei abgelehnter Protokollversion vor dem `hello`).
    if (this.helloReceived) {
      this.meldeGetrennt();
    }

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
   * Zuletzt angestoßene Abmeldung je Node (Audit event-flow-12).
   *
   * Die Übernahme läuft dadurch sequenziell: `onDisconnected` der alten
   * Verbindung ist durch, bevor `onConnected` der neuen beginnt. Der Eintrag
   * verschwindet, sobald die Abmeldung durch ist – die Karte hält also nur
   * Nodes, deren Abmeldung gerade läuft.
   */
  private readonly abmeldungen = new Map<string, Promise<void>>();

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
      this.merkeAbmeldung(existing);
    }

    /*
     * Auch ohne unmittelbare Übernahme kann eine Abmeldung noch laufen: Der
     * Agent baut nach einem Abbruch neu auf, und der `close`-Handler der alten
     * Verbindung hat sie bereits ausgetragen, während `markHostDisconnected`
     * noch unterwegs ist. Auch dieser Fall wird aufgereiht.
     */
    const laufendeAbmeldung = this.abmeldungen.get(session.hostId);

    if (laufendeAbmeldung !== undefined) {
      session.deferConnectUntil(laufendeAbmeldung);
    }

    this.sessions.set(session.hostId, session);
  }

  unregister(session: AgentSession): void {
    if (this.sessions.get(session.hostId) === session) {
      this.sessions.delete(session.hostId);
      this.merkeAbmeldung(session);
    }
  }

  /** Hält die laufende Abmeldung einer Sitzung fest, bis sie durch ist. */
  private merkeAbmeldung(session: AgentSession): void {
    const lauf = session.disconnectSettled;

    this.abmeldungen.set(session.hostId, lauf);

    // `disconnectSettled` lehnt nie ab (siehe `AgentSession.meldeGetrennt`);
    // `void` hält die Kette trotzdem sichtbar als „bewusst nicht abgewartet".
    void lauf.then(() => {
      if (this.abmeldungen.get(session.hostId) === lauf) {
        this.abmeldungen.delete(session.hostId);
      }
    });
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
/**
 * Token aus einem `Authorization: Bearer …`-Header, oder `null`.
 *
 * Als eigene Funktion, weil zwei Wege es brauchen: der Vergleich mit dem
 * gemeinsamen `AGENT_TOKEN` und die Suche nach der Node, der dieses Token
 * gehört (Gefundener Punkt 57).
 */
export function bearerTokenFrom(authorizationHeader: string | undefined): string | null {
  if (authorizationHeader === undefined) {
    return null;
  }

  return /^Bearer (.+)$/.exec(authorizationHeader)?.[1] ?? null;
}

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

  const presented = bearerTokenFrom(authorizationHeader);

  if (presented === null) {
    return false;
  }

  const presentedBytes = Buffer.from(presented, 'utf8');
  const expectedBytes = Buffer.from(expectedToken, 'utf8');

  if (presentedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(presentedBytes, expectedBytes);
}
