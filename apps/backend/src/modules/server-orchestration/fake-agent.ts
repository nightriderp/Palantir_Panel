import {
  type AgentCommandName,
  type AgentContainerState,
  type AgentContainerStatus,
  type ApiResponse,
  fail,
  ok,
} from '@palantir/contracts';
import {
  AgentSession,
  type AgentGatewayLogger,
  type AgentRegistry,
  type AgentSessionHandlers,
} from './agent-gateway.js';

/**
 * Attrappe statt eines echten Agents – **nur für die Entwicklung**.
 *
 * In der Entwicklungsdatenbank stehen Nodes, an denen nie ein Agent hängt.
 * Jeder Versuch, dort etwas zu tun, endet deshalb mit „Die Node ist aktuell
 * nicht verbunden": Der Dateimanager bleibt leer, die Konsole stumm, die Ringe
 * auf „—". Genau die Ansichten also, an denen man arbeitet, lassen sich nicht
 * ansehen. Das Schwesterprojekt `hafenmeister` löst das seit Phase 11 mit
 * `DEV_FAKE_AGENT`; das hier ist dieselbe Idee auf unserem Protokoll.
 *
 * Die Attrappe spricht das echte Protokoll (`hello`, `stateReport`,
 * `commandResult`) über einen Steckplatz, der nie ein Netz sieht. Dadurch
 * läuft im Backend derselbe Weg wie bei einem echten Agent – es gibt keinen
 * zweiten Pfad, der auseinanderlaufen könnte.
 *
 * ⚠️ **Dreifach verriegelt.** Eine Attrappe im Betrieb wäre schlimmer als der
 * Fehler, den sie behebt: Das Panel meldete Erfolge, die nie stattgefunden
 * haben.
 *
 * 1. Nur, wenn `DEV_FAKE_AGENT` ausdrücklich auf `true` steht.
 * 2. Niemals bei `NODE_ENV=production` – auch dann nicht, wenn die Variable
 *    gesetzt ist. Der Start meldet das als Fehler und lässt sie aus.
 * 3. Nur für Nodes, an denen gerade **kein** echter Agent hängt. Ein
 *    verbundener Agent gewinnt immer, sonst legte die Attrappe im Hintergrund
 *    eine echte Umgebung lahm.
 *
 * Was sie **nicht** tut: etwas anlegen, löschen oder starten. Es entsteht kein
 * Container, keine Datei, kein Backup. Sie antwortet, und ihr Gedächtnis lebt
 * im Arbeitsspeicher – ein Neustart des Backends vergisst es, damit niemand es
 * für Buchführung hält.
 */

/** Ein Server dieser Node, so weit die Attrappe ihn braucht. */
export interface FakeAgentServer {
  readonly id: string;
  readonly containerId: string | null;
  /** Zustand laut Datenbank – die Attrappe behauptet genau diesen. */
  readonly running: boolean;
}

export interface FakeAgentOptions {
  readonly agents: AgentRegistry;
  readonly handlers: AgentSessionHandlers;
  readonly log: AgentGatewayLogger;
  /** Nodes, für die eine Attrappe entstehen soll. */
  listHostIds: () => Promise<readonly string[]>;
  /**
   * Server einer Node. Die Attrappe meldet im Zustandsbericht genau das, was
   * die Datenbank ohnehin führt – sonst räumte der Soll/Ist-Abgleich beim
   * Verbinden die Entwicklungsdaten ab (siehe Fundpunkt 272).
   */
  listServers: (hostId: string) => Promise<readonly FakeAgentServer[]>;
  /** Für Tests: Zeitquelle. */
  now?: () => Date;
}

/** Protokollversion, die auch der echte Agent spricht. */
const PROTOCOL_VERSION = 1;

/** Version, die die Attrappe über sich selbst meldet – als solche erkennbar. */
const FAKE_AGENT_VERSION = '0.0.0-attrappe';

/** Abstand zwischen zwei erfundenen Messwerten. */
const STATS_INTERVAL_MS = 5_000;

export function fakeAgentEnabled(env: NodeJS.ProcessEnv, log?: AgentGatewayLogger): boolean {
  if (env.DEV_FAKE_AGENT !== 'true') return false;

  if (env.NODE_ENV === 'production') {
    log?.error(
      {},
      'DEV_FAKE_AGENT ist gesetzt, aber NODE_ENV=production – die Attrappe bleibt AUS. ' +
        'Im Betrieb würde sie Erfolge melden, die nie stattgefunden haben.',
    );

    return false;
  }

  return true;
}

/** Erfundene, aber formgleiche Container-Kennung (64 Hexzeichen). */
function fakeContainerId(seed: string): string {
  let hash = 0x811c9dc5;

  for (const zeichen of seed) {
    hash ^= zeichen.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0').repeat(8);
}

/**
 * Antwort der Attrappe auf einen Befehl.
 *
 * Beantwortet wird, was die Oberfläche zum Anschauen braucht. Alles andere
 * bekommt eine ehrliche Absage statt einer erfundenen Erfolgsmeldung – ein
 * „Backup erstellt", ohne dass eine Datei entsteht, wäre eine Lüge, die beim
 * Wiederherstellen auffliegt.
 */
export function fakeCommandResult(
  command: AgentCommandName,
  serverId: string | null,
  payload: unknown,
  zustand: Map<string, AgentContainerStatus>,
  jetzt: Date,
): ApiResponse<unknown> {
  const container = containerIdVon(payload) ?? fakeContainerId(serverId ?? 'node');

  switch (command) {
    case 'CREATE':
      zustand.set(container, 'created');
      return ok({ containerId: container, name: `palantir-${serverId ?? 'node'}`, warnings: [] });

    case 'START':
    case 'RESTART':
      zustand.set(container, 'running');
      return ok(null);

    case 'STOP':
      zustand.set(container, 'exited');
      return ok(null);

    case 'DELETE':
      zustand.delete(container);
      return ok(null);

    case 'GET_STATS': {
      // Werte, die sich bewegen, aber nicht springen: Die Ringe sollen
      // lebendig aussehen, ohne eine Auslastung zu behaupten, die es nicht
      // gibt. Grundlage ist die Uhr, nicht der Zufall – so ist die Kurve im
      // Verlauf glatt.
      const takt = jetzt.getTime() / 1000;
      const cpu = 18 + Math.sin(takt / 30) * 12;

      return ok({
        containerId: container,
        cpuPercent: Math.max(1, Math.round(cpu * 10) / 10),
        memoryUsedBytes: Math.round((1.6 + Math.sin(takt / 45) * 0.4) * 1024 ** 3),
        memoryLimitBytes: 4 * 1024 ** 3,
        networkRxBytes: Math.round(takt * 1200),
        networkTxBytes: Math.round(takt * 3400),
      });
    }

    case 'GET_LOGS':
      return ok({
        containerId: container,
        lines: [
          {
            stream: 'stdout',
            message: 'Attrappe: hier stünde die Ausgabe des Spielservers.',
            timestamp: jetzt.toISOString(),
          },
        ],
      });

    case 'EXEC_CONSOLE':
      return ok({
        exitCode: 0,
        stdout: 'Attrappe: Befehl angenommen, es läuft kein Spielserver.',
        stderr: '',
      });

    case 'FILE_LIST':
      return ok({
        containerId: container,
        path: pfadVon(payload) ?? '/',
        entries: [
          eintrag('world', 'directory', 0, jetzt),
          eintrag('server.properties', 'file', 1_284, jetzt),
          eintrag('ops.json', 'file', 2, jetzt),
          eintrag('logs', 'directory', 0, jetzt),
        ],
      });

    case 'FILE_READ':
      return ok({
        containerId: container,
        path: pfadVon(payload) ?? '/server.properties',
        contentBase64: Buffer.from(
          '# Attrappe – diese Datei liegt nirgends auf einer Platte.\nmotd=Palantir (Entwicklung)\n',
          'utf8',
        ).toString('base64'),
      });

    case 'FILE_WRITE':
    case 'FILE_DELETE':
    case 'SET_SERVER_QUERY':
      return ok(null);

    case 'GET_STORAGE_BREAKDOWN':
      return ok({ entries: [], totalBytes: 0, measuredAt: jetzt.toISOString() });

    default:
      return fail(
        'AGENT_COMMAND_FAILED',
        `Die Attrappe beantwortet ${command} nicht – dafür braucht es einen echten Agent.`,
      );
  }
}

function eintrag(
  name: string,
  type: 'file' | 'directory',
  sizeBytes: number,
  jetzt: Date,
): Record<string, unknown> {
  return {
    name,
    path: `/${name}`,
    type,
    sizeBytes,
    modifiedAt: jetzt.toISOString(),
    mode: type === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--',
  };
}

function containerIdVon(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const wert = (payload as { containerId?: unknown }).containerId;

  return typeof wert === 'string' && wert.length > 0 ? wert : null;
}

function pfadVon(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const wert = (payload as { path?: unknown }).path;

  return typeof wert === 'string' ? wert : null;
}

/**
 * Hängt für jede Node ohne echten Agent eine Attrappe in die Registry.
 *
 * Rückgabe ist die Abmeldung: Sie schließt alle Attrappen wieder – gebraucht
 * beim Herunterfahren und in Tests.
 */
export async function startFakeAgents(options: FakeAgentOptions): Promise<() => void> {
  const jetzt = options.now ?? ((): Date => new Date());
  const hostIds = await options.listHostIds();
  const sessions: AgentSession[] = [];
  const takte: ReturnType<typeof setInterval>[] = [];

  for (const hostId of hostIds) {
    // Verriegelung 3: Ein echter Agent gewinnt immer.
    if (options.agents.get(hostId) !== null) {
      options.log.info({ hostId }, 'Attrappe übersprungen: an dieser Node hängt ein echter Agent');
      continue;
    }

    const zustand = new Map<string, AgentContainerStatus>();
    // `aktuelle` zeigt auf die Sitzung dieser Node – gebraucht im Steckplatz
    // und im Messwert-Takt, die beide vor ihrer Zuweisung geschrieben werden.
    let aktuelle: AgentSession | null = null;

    const session = new AgentSession({
      hostId,
      socket: {
        send: (data: string) => {
          // Antworten laufen über den Mikrotask, damit `sendCommand` erst
          // seinen Eintrag anlegt und die Antwort danach ankommt – wie über
          // ein Netz auch.
          queueMicrotask(() => {
            const antwort = beantworte(data, zustand, jetzt());
            if (antwort !== null) aktuelle?.handleMessage(antwort);
          });
        },
        close: () => {
          /* Die Attrappe hat keine Verbindung, die sich schließen ließe. */
        },
      },
      handlers: options.handlers,
      log: options.log,
    });

    aktuelle = session;
    options.agents.register(session);
    sessions.push(session);

    // Begrüßung wie ein echter Agent: erst `hello`, dann der Zustandsbericht.
    session.handleMessage(
      JSON.stringify({
        kind: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        agentVersion: FAKE_AGENT_VERSION,
        nodeId: hostId,
        sentAt: jetzt().toISOString(),
      }),
    );

    const server = await options.listServers(hostId);
    session.handleMessage(
      JSON.stringify({
        kind: 'stateReport',
        reason: 'connected',
        containers: server.map((eintrag) => zustandsZeile(eintrag, zustand, jetzt())),
        reportedAt: jetzt().toISOString(),
      }),
    );

    /*
     * Laufende Messwerte für die Server, die als „läuft" geführt werden.
     *
     * Ohne sie bleiben die Ringe auf „—": Das Backend kennt Live-Werte nur aus
     * `STATS_UPDATE`-Ereignissen des Agents, und genau die fehlen in der
     * Entwicklung. Der Takt ist bewusst gemächlich – gebraucht wird eine
     * Anzeige, die sich bewegt, kein Datenstrom.
     */
    const laufende = server.filter((eintrag) => eintrag.running);

    if (laufende.length > 0) {
      const takt = setInterval(() => {
        for (const eintrag of laufende) {
          const stand = jetzt();
          const sekunden = stand.getTime() / 1000;

          aktuelle?.handleMessage(
            JSON.stringify({
              kind: 'event',
              event: 'STATS_UPDATE',
              serverId: eintrag.id,
              payload: {
                containerId: eintrag.containerId ?? fakeContainerId(eintrag.id),
                cpuPercent: Math.max(1, Math.round((18 + Math.sin(sekunden / 30) * 12) * 10) / 10),
                memoryUsedBytes: Math.round((1.6 + Math.sin(sekunden / 45) * 0.4) * 1024 ** 3),
                networkRxBytes: Math.round(sekunden * 1200),
                networkTxBytes: Math.round(sekunden * 3400),
              },
              emittedAt: stand.toISOString(),
            }),
          );
        }
      }, STATS_INTERVAL_MS);

      // Der Takt darf den Prozess nicht am Leben halten: Ein Backend, das sich
      // wegen einer Attrappe nicht beenden lässt, wäre die nächste Falle.
      takt.unref?.();
      takte.push(takt);
    }

    options.log.warn(
      { hostId },
      'DEV_FAKE_AGENT: Diese Node wird von einer Attrappe bedient. Befehle werden beantwortet, ' +
        'ohne dass irgendwo ein Container entsteht.',
    );
  }

  return () => {
    for (const takt of takte) clearInterval(takt);
    for (const session of sessions) {
      options.agents.unregister(session);
    }
  };
}

/** Ein Container im Zustandsbericht – genau so, wie die Datenbank ihn führt. */
function zustandsZeile(
  server: FakeAgentServer,
  zustand: Map<string, AgentContainerStatus>,
  jetzt: Date,
): AgentContainerState {
  const containerId = server.containerId ?? fakeContainerId(server.id);
  const status: AgentContainerStatus = server.running ? 'running' : 'exited';
  zustand.set(containerId, status);

  return {
    serverId: server.id,
    containerId,
    status,
    exitCode: server.running ? null : 0,
    startedAt: server.running ? jetzt.toISOString() : null,
    observedAt: jetzt.toISOString(),
  };
}

/** Eingehenden Backend-Frame beantworten – oder `null`, wenn nichts zu sagen ist. */
function beantworte(
  data: string,
  zustand: Map<string, AgentContainerStatus>,
  jetzt: Date,
): string | null {
  let frame: unknown;

  try {
    frame = JSON.parse(data);
  } catch {
    return null;
  }

  if (typeof frame !== 'object' || frame === null) return null;
  const kind = (frame as { kind?: unknown }).kind;

  if (kind === 'command') {
    const { correlationId, command, serverId, payload } = frame as {
      correlationId: string;
      command: AgentCommandName;
      serverId: string | null;
      payload?: unknown;
    };

    return JSON.stringify({
      kind: 'commandResult',
      correlationId,
      command,
      result: fakeCommandResult(command, serverId, payload, zustand, jetzt),
      duplicate: false,
      completedAt: jetzt.toISOString(),
    });
  }

  if (kind === 'stateRequest') {
    return JSON.stringify({
      kind: 'stateReport',
      reason: 'requested',
      containers: [...zustand.entries()].map(([containerId, status]) => ({
        serverId: null,
        containerId,
        status,
        exitCode: status === 'exited' ? 0 : null,
        startedAt: status === 'running' ? jetzt.toISOString() : null,
        observedAt: jetzt.toISOString(),
      })),
      reportedAt: jetzt.toISOString(),
    });
  }

  // `welcome` braucht keine Antwort.
  return null;
}
