import { type ConsoleQuickCommand, type GameConfigValues } from './game-type.js';
import { type HostNodeStatus } from './resources.js';
import { type ServerStatus } from './server-lifecycle.js';

/**
 * Serverseitig berechnetes `permissions`-Objekt eines Gameservers (Pflichtenheft §5.2).
 *
 * Berechtigungslogik lebt ausschließlich im Backend. Das Frontend zeigt oder
 * versteckt Bedienelemente **nur** anhand dieser Flags und leitet nie selbst
 * etwas aus Rollen ab (Entwicklungsregeln §3, Pflichtenheft §8).
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
  /**
   * Besitzer des Servers wechseln (Lastenheft §3.7, Pflichtenheft §7).
   *
   * Nur mit `server.manage.any` – ein Verwaltungsvorgang, kein Recht des
   * Besitzers: Eine Weitergabe „ins Blaue" durch Nutzer ist nicht vorgesehen,
   * dafür gibt es die Mitgliederverwaltung.
   */
  canTransferOwnership: boolean;
  /**
   * Neue Fassung des Spiel-Images übernehmen (Pflichtenheft §9, Review
   * 2026-09-16). Ein Server behält seine Fassung, bis jemand mit diesem Recht
   * „Aktualisieren" drückt – dasselbe Recht wie Starten und Stoppen.
   */
  canUpdate: boolean;
}

/** Ressourcen-Limits eines Servers (Pflichtenheft §6, `GameServer.resourceLimits`). */
export interface ServerResourceLimits {
  ramMb: number;
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
 * Ein verbundener Spieler (WORK_STATUS.md, Gefundener Punkt 51).
 *
 * Bewusst nur der Name: Mehr gibt nicht jedes Spiel heraus, und mehr braucht
 * die Liste im Reiter „Übersicht" nicht. Wer später Punktestand oder Team
 * anzeigen will, ergänzt hier additiv.
 */
export interface ServerLivePlayer {
  name: string;
}

/**
 * Live-Messwerte eines Servers (Pflichtenheft §5.3, WebSocket-Kanal `STATS_UPDATE`).
 *
 * Bewusst getrennt vom `GameServerDto`: der DTO kommt per REST, die Messwerte
 * laufen über den Live-Kanal und fehlen, solange der Server nicht läuft.
 * Einzelne Werte sind `null`, wenn das jeweilige Spiel sie nicht liefert.
 */
export interface ServerLiveStats {
  /**
   * CPU-Auslastung in **Prozent eines Kerns** (WORK_STATUS.md, Gefundener
   * Punkt 23).
   *
   * `250` heißt also 2,5 ausgelastete Kerne, nicht „250 % von irgendetwas".
   * Der Wert kommt unverändert aus `AgentContainerStats.cpuPercent`, und
   * dieselbe Größe hält der Verlauf in `server_stats_samples.cpu_percent` fest.
   *
   * Eine **Bezugsgröße nennt der Vertrag nicht**, weil es seit dem Wegfall der
   * CPU-Zuweisung keine servereigene mehr gibt: Ein Container bekommt alle
   * Kerne der Node und teilt sie sich mit den übrigen. Wer einen Anteil
   * anzeigen will, nimmt die Kerne der Node (`NodeResources.cpuCores`) – die
   * Umrechnung gehört in die Ansicht, nicht in den Vertrag.
   *
   * `null`, solange keine Messung vorliegt.
   */
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
  /**
   * Empfangene und gesendete Pakete seit dem letzten Start (Mockup-Abgleich 4.8).
   *
   * Optional und zusaetzlich zu den Byte-Zaehlern: Bytes sagen, wie viel
   * geflossen ist, Pakete sagen, wie oft – bei einem Gameserver ist das der
   * Unterschied zwischen "viel Verkehr" und "viele Spieler". Fehlt das Feld,
   * meldet die Runtime es nicht.
   */
  networkRxPackets?: number | null;
  networkTxPackets?: number | null;
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
  /**
   * Schnellbefehle der Live-Konsole aus der Spiele-Definition
   * (`GameTypeDefinition.consoleQuickCommands`). Additiv und optional, damit
   * ältere Backends den DTO weiter liefern; das Backend füllt das Feld immer,
   * notfalls leer.
   */
  consoleQuickCommands?: readonly ConsoleQuickCommand[];
  /**
   * Nimmt dieses Spiel überhaupt Konsolenbefehle entgegen
   * (`GameTypeDefinition.console` ist nicht `{ kind: 'none' }`)?
   *
   * Getrennt von `permissions.canUseConsole`: Das eine sagt, ob der Aufrufer
   * darf, das andere, ob es etwas zu bedienen gibt. Beides muss zutreffen,
   * damit die Oberfläche ein Eingabefeld zeigt.
   *
   * Additiv und optional, damit ältere Backends den DTO weiter liefern; das
   * Backend füllt das Feld immer. Fehlt es, ist `true` die richtige Annahme —
   * bis auf Valheim hat jedes Spiel eine Konsole.
   */
  supportsConsole?: boolean;
  status: ServerStatus;
  /** Erläuterung zum Status, z. B. letzte Fehlermeldung bei `error`/`crashed`. */
  statusMessage: string | null;
  hostId: string;
  /** Anzeigename der Node; `null`, wenn für den Aufrufer nicht sichtbar. */
  hostName: string | null;
  /**
   * Verbindungszustand der Node, auf der dieser Server liegt.
   *
   * Ohne ihn lässt sich in der Detailansicht nicht sagen, **warum** keine
   * Messwerte da sind: „noch keine Messwerte" und „die Node ist gar nicht
   * verbunden" sehen im Panel gleich aus, sind für den Betreiber aber zwei
   * verschiedene Lagen – die eine wartet man ab, die andere sieht man sich an.
   * Dieselbe Angabe steht in `HostNodeDto`, die Serverlisten holen die
   * Node-Liste aber nicht mit.
   *
   * `null`, wenn der Aufrufer die Node nicht sehen darf – wie bei `hostName`.
   * Optional, damit der Vertrag für sich stehen kann (Entwicklungsregeln §3): Fehlt das
   * Feld, bleibt die Oberfläche bei ihrer bisherigen, unschärferen Auskunft.
   */
  hostStatus?: HostNodeStatus | null;
  /**
   * Kerne der Node, auf der dieser Server läuft – Bezugsgröße der CPU-Anzeige.
   *
   * `ServerLiveStats.cpuPercent` zählt in Prozent **eines** Kerns: 250 heißt
   * 2,5 ausgelastete Kerne. Ohne die Kerne der Node lässt sich daraus kein
   * Anteil bilden, und die Detailansicht musste die nackte Kernzahl zeigen -
   * „2,5 Kerne" sagt nicht, ob die Maschine am Anschlag läuft oder sich
   * langweilt. Dieselbe Angabe steht in `HostNodeDto.capacity`, die
   * Detailansicht holt die Node-Liste aber nicht mit, und ein Konto ohne
   * `canViewNodes` bekäme sie ohnehin nicht.
   *
   * `null`, wenn der Aufrufer die Node nicht sehen darf – wie bei `hostName`
   * und `hostStatus`. Optional, damit der Vertrag für sich stehen kann
   * (Entwicklungsregeln §3): Fehlt das Feld, bleibt die Oberfläche bei der Kernzahl.
   */
  hostCpuCores?: number | null;
  /**
   * Seit wann der Server in seinem jetzigen Zustand ist (ISO-8601).
   *
   * Gebraucht für die Uhr an einem laufenden Übergang: „Startet … seit 2:14
   * min". Bis hierher nahm die Oberfläche dafür {@link lastStartedAt} - den
   * Zeitpunkt des letzten ERFOLGREICHEN Starts. Der wird aber erst gesetzt,
   * wenn der Server `running` erreicht; während des Startens stand dort der
   * Start von vorhin, und die Uhr zählte von dort: „seit 105:07 min" für einen
   * Server, der seit zwei Minuten hochfährt (im Betrieb gesehen, 15.09.2026).
   *
   * Die Datenbank führt den Wert seit jeher (`status_changed_at`,
   * Pflichtenheft §9); er stand nur nie im Vertrag.
   */
  statusChangedAt?: string;
  /**
   * Summe aller bisherigen Laufzeiten in Sekunden, **ohne** die laufende
   * Sitzung.
   *
   * Die Detailansicht zeigt gross die laufende Sitzung (seit
   * {@link lastStartedAt}, als tickende Uhr) und klein die Gesamtlaufzeit; die
   * ist die Summe hier plus der laufenden Sitzung. Getrennt gefuehrt, weil nur
   * so beides ohne Raten geht: Aus `createdAt` laesst sich keine Laufzeit
   * ableiten - ein Server, der seit einem Jahr steht, ist ein Jahr alt und war
   * vielleicht zwei Stunden an.
   *
   * Gezaehlt wird beim Verlassen des Zustands `running`; die laufende Sitzung
   * steht deshalb noch nicht darin. Optional, damit der Vertrag fuer sich
   * stehen kann: Fehlt das Feld, zeigt die Oberflaeche nur die Sitzung.
   */
  totalUptimeSeconds?: number;
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
  /**
   * Hat der Aufrufer diesen Server angeheftet (WORK_STATUS.md, Gefundener Punkt
   * 50)?
   *
   * Sicht des Aufrufers wie `permissions`: Dieselbe Zeile ist für zwei Konten
   * unterschiedlich angeheftet. Bis hierher lag die Anheftung im `localStorage`
   * und galt damit pro Gerät – wer am Telefon anheftete, sah am Rechner nichts
   * davon.
   */
  pinned: boolean;
  /** Letzter erfolgreicher Start als ISO-8601; `null`, wenn nie gestartet. */
  lastStartedAt: string | null;
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
  permissions: GameServerPermissions;
}
