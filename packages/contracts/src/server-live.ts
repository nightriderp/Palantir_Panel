import { type WebSocketEventName } from './events.js';
import { type ServerLiveStats } from './game-server.js';
import { type ServerCloneJobDto, type ServerExportJobDto } from './server-jobs.js';
import { type ServerStatus } from './server-lifecycle.js';

/**
 * Live-Kanal zwischen Frontend und Backend (Pflichtenheft §5.3).
 *
 * Konsole, Live-Messwerte und Statuswechsel laufen ausschließlich hierüber –
 * kein Polling. Das Pflichtenheft nennt den Kanal, legt seine Frames aber nicht
 * fest; das geschieht hier einmal zentral (Festlegung dieser Sitzung, F3),
 * damit Frontend und Backend nicht zwei Formate erfinden. Die Ereignisnamen
 * folgen dem Schema aus `events.ts` und stehen dort im Katalog.
 *
 * Nicht zu verwechseln mit dem Agent-Protokoll (`agent-protocol.ts`): das
 * verbindet Backend und Homeserver, dieser Kanal Browser und Backend.
 */

/** Ressource, auf die abonniert wird. Aktuell nur einzelne Gameserver. */
export interface LiveTopic {
  resource: 'server';
  /** Id der Ressource, hier die `GameServer.id`. */
  id: string;
}

/** Frames, die der Browser schickt. */
export type LiveClientFrame =
  | { kind: 'subscribe'; topic: LiveTopic }
  | { kind: 'unsubscribe'; topic: LiveTopic }
  /** Konsolenbefehl (Lastenheft §3.3); erfordert `permissions.canUseConsole`. */
  | { kind: 'consoleCommand'; topic: LiveTopic; command: string };

/** Herkunft einer Konsolenzeile. */
export const CONSOLE_LINE_SOURCES = ['stdout', 'stderr', 'input', 'system'] as const;

export type ConsoleLineSource = (typeof CONSOLE_LINE_SOURCES)[number];

/**
 * Eine Zeile der Live-Konsole.
 *
 * `input` sind Befehle, die aus dem Panel abgeschickt wurden – die Konsole
 * zeigt sie mit vorangestelltem `>` an, damit erkennbar bleibt, was von wem kam.
 */
export interface ServerConsoleLine {
  /** Fortlaufende Id innerhalb der Sitzung – dient als Schlüssel in der Liste. */
  id: string;
  serverId: string;
  source: ConsoleLineSource;
  text: string;
  /** ISO-8601-Zeitstempel. */
  timestamp: string;
}

/**
 * Verlauf der Messwerte (Lastenheft §3.3: „Verlaufsdarstellung").
 *
 * Die Stichproben sind aufsteigend nach `updatedAt` sortiert; ihr Abstand steht
 * in `intervalSeconds`, damit das Frontend Lücken erkennen kann.
 */
export interface ServerStatsHistoryDto {
  serverId: string;
  windowMinutes: number;
  intervalSeconds: number;
  samples: ServerLiveStats[];
}

/**
 * Ereignisse, die über diesen Kanal fließen.
 *
 * Die Namen stehen zugleich im Katalog `WEBSOCKET_EVENTS` – das
 * `satisfies` erzwingt das beim Übersetzen, damit hier kein Name entsteht, den
 * der Katalog nicht kennt (CLAUDE.md §5).
 */
export const LIVE_SERVER_EVENTS = [
  'server.statusChanged',
  'server.statsUpdated',
  'server.consoleLineAppended',
  'serverClone.progressed',
  'serverExport.progressed',
] as const satisfies readonly WebSocketEventName[];

export type LiveServerEventName = (typeof LIVE_SERVER_EVENTS)[number];

export function isLiveServerEventName(value: string): value is LiveServerEventName {
  return (LIVE_SERVER_EVENTS as readonly string[]).includes(value);
}

/** Nutzdaten je Ereignis des Live-Kanals. */
export type LiveServerEventPayloads = {
  'server.statusChanged': {
    serverId: string;
    status: ServerStatus;
    statusMessage: string | null;
  };
  'server.statsUpdated': { serverId: string; stats: ServerLiveStats };
  'server.consoleLineAppended': { serverId: string; line: ServerConsoleLine };
  'serverClone.progressed': { serverId: string; job: ServerCloneJobDto };
  'serverExport.progressed': { serverId: string; job: ServerExportJobDto };
};

/** Frame, das der Browser vom Backend empfängt. */
export type LiveServerEventFrame = {
  [TName in LiveServerEventName]: {
    kind: 'event';
    event: TName;
    topic: LiveTopic;
    data: LiveServerEventPayloads[TName];
    /** ISO-8601-Zeitstempel des Versands. */
    sentAt: string;
  };
}[LiveServerEventName];
