import { type GameConfigValues } from './game-type.js';
import { type ServerStatus } from './server-lifecycle.js';

/**
 * Serverseitig berechnetes `permissions`-Objekt eines Gameservers (Pflichtenheft §5.2).
 *
 * Berechtigungslogik lebt ausschließlich im Backend. Das Frontend zeigt oder
 * versteckt Bedienelemente **nur** anhand dieser Flags und leitet nie selbst
 * etwas aus Rollen ab (CLAUDE.md §3, Pflichtenheft §8).
 */
export interface GameServerPermissions {
  /** Server überhaupt sichtbar (Karte, Detailseite). */
  canView: boolean;
  /** Verbindungsadresse (Subdomain/Port) sichtbar. */
  canViewAddress: boolean;
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
  /** Einstellungen ändern (Ressourcen, Startparameter, Auto-Shutdown). */
  canManageSettings: boolean;
  canDelete: boolean;
  canClone: boolean;
  canManageMembers: boolean;
  canManageBackups: boolean;
  canManageFiles: boolean;
  canManageSchedules: boolean;
  /** Live-Konsole inkl. Befehlseingabe. */
  canUseConsole: boolean;
}

/** Ressourcen-Limits eines Servers (Pflichtenheft §6, `GameServer.resourceLimits`). */
export interface ServerResourceLimits {
  ramMb: number;
  cpuCores: number;
  diskMb: number;
}

/**
 * Verbindungsadresse eines Servers (Pflichtenheft §13).
 *
 * `port === null` bei Spielen mit Hostname-Routing (initial Minecraft) – dort ist
 * für den Spieler kein Port sichtbar.
 */
export interface ServerAddress {
  hostname: string;
  port: number | null;
}

/**
 * Live-Messwerte eines Servers (Pflichtenheft §5.3, WebSocket-Kanal `STATS_UPDATE`).
 *
 * Bewusst getrennt vom `GameServerDto`: der DTO kommt per REST, die Messwerte
 * laufen über den Live-Kanal und fehlen, solange der Server nicht läuft.
 * Einzelne Werte sind `null`, wenn das jeweilige Spiel sie nicht liefert.
 */
/**
 * Ein verbundener Spieler (WORK_STATUS.md, Gefundener Punkt 51).
 *
 * Bewusst nur der Name: Mehr gibt nicht jedes Spiel heraus, und mehr braucht
 * die Liste im Reiter „Übersicht" nicht. Wer später Punktestand oder Team
 * anzeigen will, ergänzt hier additiv.
 */
export interface ServerLivePlayer {
  name: string;
}

export interface ServerLiveStats {
  cpuPercent: number | null;
  ramUsedMb: number | null;
  diskUsedMb: number | null;
  pingMs: number | null;
  playersOnline: number | null;
  playersMax: number | null;
  /**
   * Namen der verbundenen Spieler (Gefundener Punkt 51).
   *
   * Optional und additiv: Nur die Abfrage über das Spielprotokoll (`gamedig`)
   * liefert sie – der generische Port-Connect-Test kennt keine Spieler, und
   * manche Server geben nur einen Auszug oder gar nichts heraus. Fehlt das
   * Feld, heißt das „keine Angabe", **nicht** „niemand da": Die belastbare
   * Zahl steht in {@link ServerLiveStats.playersOnline}.
   *
   * Bewusst **nicht** im Verlauf ({@link ServerStatsHistoryDto}): Eine
   * Namensliste je Stichprobe würde die Tabelle vollschreiben, ohne dass sie
   * jemand über die Zeit auswertet.
   */
  players?: readonly ServerLivePlayer[];
  /**
   * Übertragene Bytes seit dem letzten Start des Servers – die Container-Runtime
   * zählt ab dem Start neu (`AgentContainerStats`). `null`, wenn die Runtime
   * für diesen Container nichts liefert.
   */
  networkRxBytes: number | null;
  networkTxBytes: number | null;
  /** ISO-8601-Zeitstempel der Messung. */
  updatedAt: string;
}

/**
 * Gameserver-DTO (Pflichtenheft §5.2, §6).
 *
 * Enthält den vollständigen Datensatz inkl. `permissions` – kein view-spezifisches
 * Zuschneiden. Der aktuelle Umfang deckt das ab, was die gemeinsame `ServerCard`
 * aus F2 darstellt; B3/F0 erweitern **additiv** um die restlichen Felder aus
 * Pflichtenheft §6 (z. B. `configJson`, `dockerContainerId`).
 */
export interface GameServerDto {
  id: string;
  name: string;
  ownerId: string;
  /** Anzeigename des Besitzers; `null`, wenn für den Aufrufer nicht sichtbar. */
  ownerDisplayName: string | null;
  /** Id der `GameTypeDefinition` (Pflichtenheft §11). */
  gameType: string;
  /** Anzeigename des Spiels, z. B. „Minecraft (Paper)". */
  gameTypeName: string;
  status: ServerStatus;
  /** Erläuterung zum Status, z. B. letzte Fehlermeldung bei `error`/`crashed`. */
  statusMessage: string | null;
  hostId: string;
  /** Anzeigename der Node; `null`, wenn für den Aufrufer nicht sichtbar. */
  hostName: string | null;
  subdomain: string;
  /** `null`, wenn die Adresse für den Aufrufer nicht freigegeben ist. */
  address: ServerAddress | null;
  assignedPorts: number[];
  resourceLimits: ServerResourceLimits;
  autoShutdownEnabled: boolean;
  /**
   * Inaktivitäts-Timeout in Minuten (Pflichtenheft §9). `null` bedeutet: es gilt
   * der Standardwert der Instanz, der Server hat keinen eigenen.
   */
  autoShutdownTimeoutMinutes: number | null;
  /** Startparameter (Lastenheft §3.3); leer, wenn das Spiel keine kennt. */
  startupParameters: string;
  /** Spielspezifische Konfiguration (`GameServer.configJson`, Pflichtenheft §6). */
  config: GameConfigValues;
  /** Container-Id auf dem Homeserver; `null`, solange keiner existiert. */
  dockerContainerId: string | null;
  /** Geänderte Einstellungen greifen erst beim nächsten Neustart. */
  pendingRestart: boolean;
  /** Für das Image des Spieltyps liegt eine neuere Fassung vor. */
  updateAvailable: boolean;
  /** Anzahl der Mitverwalter (`ServerMember`, Pflichtenheft §6). */
  memberCount: number;
  /** Letzter erfolgreicher Start als ISO-8601; `null`, wenn nie gestartet. */
  lastStartedAt: string | null;
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
  permissions: GameServerPermissions;
}
