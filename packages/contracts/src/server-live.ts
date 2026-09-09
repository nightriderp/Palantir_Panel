import { type BackupStatus } from './backup.js';
import { type ErrorCode } from './errors.js';
import { type WebSocketEventName } from './events.js';
import { type ServerLiveStats } from './game-server.js';
import { type ServerCloneJobDto } from './server-jobs.js';
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

/** Ein einzelner Gameserver: Status, Messwerte, Konsole, Sicherungen. */
export interface LiveServerTopic {
  resource: 'server';
  /** Id der Ressource, hier die `GameServer.id`. */
  id: string;
}

/**
 * Die Serverliste des Aufrufers (Fundpunkt 173).
 *
 * Wer die Übersicht offen hat, erfährt hierüber, dass ein Server angelegt,
 * geklont oder gelöscht wurde – bis dahin zeigte ein zweiter Tab den neuen
 * Server erst nach dem Neuladen. Das Frame nennt nur die Id; die Liste holt
 * sich der Browser danach über die REST-Schnittstelle, die ohnehin nur zeigt,
 * was der Aufrufer sehen darf.
 *
 * `id` ist fest `all`: Es gibt genau eine Liste je Konto, und jedes Frame
 * dieses Kanals trägt weiterhin ein `topic.id` – so bleibt der Schlüssel der
 * Abos (`resource:id`) auf beiden Seiten derselbe.
 */
export interface LiveServerListTopic {
  resource: 'serverList';
  id: 'all';
}

/** Ressource, auf die abonniert wird. */
export type LiveTopic = LiveServerTopic | LiveServerListTopic;

/** Das eine Listen-Thema – zum Abonnieren und zum Vergleichen. */
export const LIVE_SERVER_LIST_TOPIC: LiveServerListTopic = { resource: 'serverList', id: 'all' };

/**
 * Close-Code des Server-Live-Kanals für „nicht (mehr) angemeldet".
 *
 * Aus dem privaten Bereich (4000–4999), damit der Browser „nicht angemeldet"
 * von „Backend gerade weg" unterscheiden kann: im zweiten Fall wird erneut
 * verbunden, im ersten nicht. Dieselbe Zahl wie beim Inbox- und Chat-Kanal,
 * aber ein eigener Name je Kanal – jeder darf sie unabhängig ändern, ohne dass
 * die anderen stillschweigend mitwandern.
 */
export const SERVER_LIVE_CLOSE_CODE_UNAUTHORIZED = 4401;

/**
 * Angemeldet, aber (noch) nicht freigeschaltet bzw. Sitzung entzogen
 * (Lastenheft §3.1).
 *
 * Ebenfalls endgültig: Ein erneuter Verbindungsversuch endete genauso, deshalb
 * verzichtet der Browser danach auf den Wiederanlauf.
 */
export const SERVER_LIVE_CLOSE_CODE_FORBIDDEN = 4403;

/** Frames, die der Browser schickt. */
export type LiveClientFrame =
  | { kind: 'subscribe'; topic: LiveTopic }
  | { kind: 'unsubscribe'; topic: LiveTopic }
  /** Konsolenbefehl (Lastenheft §3.3); erfordert `permissions.canUseConsole`. */
  | { kind: 'consoleCommand'; topic: LiveTopic; command: string }
  /**
   * Lebenszeichen ohne Thema (Audit W2-5, `event-flow-03`).
   *
   * Ein Reverse Proxy schließt eine stille WebSocket-Verbindung nach seinem
   * Idle-Timeout (nginx: 60 s `proxy_read_timeout`). Der Browser schickt
   * deshalb im halben Takt ein `ping` und erwartet ein {@link
   * ServerLivePongFrame} – bleibt es aus, gilt die Verbindung als tot, auch
   * wenn nie ein `close` kam.
   *
   * Bewusst **ohne** `topic`: Das Lebenszeichen gilt der Verbindung, nicht
   * einem Abo.
   */
  | { kind: 'ping' };

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
  'backup.progressed',
  // Auf dem Listen-Thema (Fundpunkt 173): Der Bestand hat sich geändert.
  'server.created',
  'server.cloned',
  'server.deleted',
] as const satisfies readonly WebSocketEventName[];

/** Ereignisse, die auf {@link LiveServerListTopic} statt auf einem Server ankommen. */
export const LIVE_SERVER_LIST_EVENTS = [
  'server.created',
  'server.cloned',
  'server.deleted',
] as const satisfies readonly LiveServerEventName[];

export type LiveServerListEventName = (typeof LIVE_SERVER_LIST_EVENTS)[number];

export function isLiveServerListEventName(value: string): value is LiveServerListEventName {
  return (LIVE_SERVER_LIST_EVENTS as readonly string[]).includes(value);
}

export type LiveServerEventName = (typeof LIVE_SERVER_EVENTS)[number];

export function isLiveServerEventName(value: string): value is LiveServerEventName {
  return (LIVE_SERVER_EVENTS as readonly string[]).includes(value);
}

/**
 * Stand einer Sicherung oder eines Exports (WORK_STATUS.md, Gefundener
 * Punkt 51).
 *
 * Gemeldet wird bei jedem Wechsel: angestoßen, fertig, gescheitert. Damit muss
 * die Oberfläche den Stand nicht mehr auf Klick nachladen – beim Export ist das
 * der Unterschied zwischen „warten und hoffen" und „sieht man".
 *
 * **Bewusst nicht der {@link BackupDto}.** Der trägt Felder, die vom Aufrufer
 * abhängen: `permissions` und `storagePath` (Betriebswissen der Node, für
 * Aufrufer ohne `backup.manage.any` immer `null`). Ein Live-Ereignis geht an
 * **alle** Abonnenten des Server-Themas – ein DTO mit den Rechten eines
 * einzelnen wäre für die übrigen schlicht falsch und gäbe den Ablageort
 * preis. Hier stehen deshalb nur Angaben, die für jeden gelten, der den Server
 * ohnehin sehen darf.
 *
 * Wer den vollständigen DTO braucht (Download-Verweis, Prüfsumme), holt ihn wie
 * bisher über `GET /backups/:id` – dann aber gezielt und nicht mehr blind auf
 * Verdacht.
 */
export interface BackupProgress {
  backupId: string;
  status: BackupStatus;
  /** Volldatenexport statt gewöhnlicher Sicherung (Lastenheft §3.3). */
  isExport: boolean;
  /** Größe des Archivs in Byte; `0`, solange der Vorgang läuft. */
  sizeBytes: number;
  /** ISO-8601-Zeitstempel des Abschlusses; `null`, solange er läuft. */
  completedAt: string | null;
  /** Klartext des Fehlschlags; `null`, wenn nicht gescheitert. */
  failureMessage: string | null;
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
  'backup.progressed': { serverId: string; backup: BackupProgress };
  /*
   * Listen-Ereignisse (Fundpunkt 173) tragen bewusst nur die Id: Name und
   * Rechte holt der Browser über die REST-Schnittstelle, sonst stünde hier
   * ein zweiter, ungeprüfter Weg zum Datensatz.
   */
  'server.created': { serverId: string };
  'server.cloned': { serverId: string };
  'server.deleted': { serverId: string };
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

// ---------------------------------------------------------------------------
// Weitere Frames Backend -> Browser (Audit W2-5)
// ---------------------------------------------------------------------------
//
// Bis zu diesem Vertrag lagen sie doppelt als Provisorium in
// `apps/backend/src/modules/server-orchestration/live-frames.ts` und
// `apps/frontend/src/lib/live/serverChannel.ts` und mussten von Hand gleich
// gehalten werden. Beide Seiten lesen sie jetzt von hier.

/** Antwort des Backends auf ein `ping` des Browsers. */
export interface ServerLivePongFrame {
  kind: 'pong';
  /** ISO-8601-Zeitstempel des Versands. */
  sentAt: string;
}

/**
 * Ist-Stand direkt nach einem `subscribe` (Audit W2-5, `event-flow-03`).
 *
 * Der Browser meldet nach jedem Wiederanlauf seine Abos erneut an; ohne dieses
 * Frame bestätigte das Backend nichts und lieferte auch nichts. Wechselte der
 * Server während der Lücke von `starting` nach `running`, blieb die Anzeige auf
 * dem alten Stand, bis zufällig ein weiteres Ereignis kam – bei `running` kommt
 * außer Messwerten keins mehr.
 */
export interface ServerLiveResyncFrame {
  kind: 'resync';
  topic: LiveTopic;
  data: {
    status: ServerStatus;
    statusMessage: string | null;
  };
  /** ISO-8601-Zeitstempel des Versands. */
  sentAt: string;
}

/**
 * Abgelehntes Frame des Browsers (Audit W2-5, `contracts-validation-04`).
 *
 * Nur dort, wo das Ausbleiben einer Wirkung sonst unerklärlich wäre – heute
 * ausschließlich beim Konsolenbefehl. Unbekannte oder beschädigte Frames werden
 * weiterhin **kommentarlos** verworfen: Eine Rückmeldung gäbe nur Auskunft über
 * das erwartete Format (dieselbe Haltung wie im Inbox-Kanal).
 */
export interface ServerLiveErrorFrame {
  kind: 'error';
  /** Thema, auf das sich die Ablehnung bezieht; `null`, wenn unlesbar. */
  topic: LiveTopic | null;
  /**
   * Code aus dem Katalog (`errors.ts`), kein Freitext.
   *
   * Bewusst auf die beiden Fälle eingeschränkt, die auf diesem Kanal überhaupt
   * entstehen können: Das Frame verletzt das Schema, oder das Konto darf den
   * Befehl nicht absetzen. `Extract` statt einer losen Union, damit ein
   * Tippfehler schon beim Übersetzen auffällt.
   */
  code: Extract<ErrorCode, 'VALIDATION_FAILED' | 'PERMISSION_DENIED'>;
  message: string;
  /** ISO-8601-Zeitstempel des Versands. */
  sentAt: string;
}

/** Alles, was `/live` zusätzlich zum Ereignis-Frame an den Browser schickt. */
export type ServerLiveExtraFrame =
  ServerLivePongFrame | ServerLiveResyncFrame | ServerLiveErrorFrame;

/** Jedes Frame, das der Browser über den Server-Live-Kanal empfangen kann. */
export type ServerLiveFrame = LiveServerEventFrame | ServerLiveExtraFrame;
