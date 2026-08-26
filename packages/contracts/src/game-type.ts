import { type ServerResourceLimits } from './game-server.js';

/**
 * Spiele-Registry als DTO (Pflichtenheft §11).
 *
 * `GameTypeDefinition` kapselt alles Spielspezifische. Nach außen – also in den
 * „Server erstellen"-Wizard (F3) und in die Einstellungen eines Servers – geht
 * davon nur der Teil, den die Oberfläche darstellen darf: Anzeigetexte, Bilder,
 * Ressourcen-Empfehlung und das editierbare Config-Schema. Docker-Image,
 * Standard-Umgebungsvariablen und Query-Typ bleiben im Backend.
 */

/**
 * Feldtypen des editierbaren Config-Schemas.
 *
 * Bewusst klein gehalten: das Frontend baut daraus generische Formularfelder,
 * ohne je ein konkretes Spiel zu kennen (Pflichtenheft §11 – neue Spiele ohne
 * Architekturänderung).
 */
export const GAME_CONFIG_FIELD_TYPES = ['text', 'number', 'select', 'toggle', 'password'] as const;

export type GameConfigFieldType = (typeof GAME_CONFIG_FIELD_TYPES)[number];

/** Zulässige Werte eines Config-Feldes. */
export type GameConfigValue = string | number | boolean;

/** Vollständige Konfiguration eines Servers (`GameServer.configJson`, Pflichtenheft §6). */
export type GameConfigValues = Record<string, GameConfigValue>;

/** Ein editierbares Feld aus dem Config-Schema einer `GameTypeDefinition`. */
export interface GameConfigField {
  /** Schlüssel in `GameConfigValues`, z. B. `maxPlayers`. */
  key: string;
  /** Deutsche Beschriftung für das Formular (Lastenheft §4). */
  label: string;
  type: GameConfigFieldType;
  /** Erklärtext unter dem Feld; `null`, wenn keiner nötig ist. */
  description: string | null;
  required: boolean;
  defaultValue: GameConfigValue;
  /** Auswahlwerte bei `select`; sonst leer. */
  options: string[];
  /** Untergrenze bei `number`; `null`, wenn unbegrenzt. */
  min: number | null;
  /** Obergrenze bei `number`; `null`, wenn unbegrenzt. */
  max: number | null;
  /**
   * Nach dem Anlegen unveränderlich (z. B. der Welt-Seed) – eine Änderung würde
   * eine neue Welt erzeugen und die bestehende zurücklassen. Der Wizard zeigt
   * das Feld normal, die Einstellungen zeigen es gesperrt.
   */
  lockedAfterCreate: boolean;
}

/**
 * Spieltyp, wie ihn der Wizard und die Server-Einstellungen sehen.
 *
 * `available === false` bedeutet: der Typ steht fachlich noch nicht bereit
 * (Phase 2/3, Lastenheft §3.5). Das Frontend zeigt ihn dann gesperrt statt ihn
 * zu verstecken, damit erkennbar bleibt, was kommt.
 */
export interface GameTypeDto {
  id: string;
  name: string;
  description: string;
  /** Kachelbild der Übersicht; `null`, solange keins hinterlegt ist. */
  iconUrl: string | null;
  /** Titelbild im Wizard; `null`, solange keins hinterlegt ist. */
  coverImageUrl: string | null;
  /** Zugriff ohne sichtbaren Port möglich (Pflichtenheft §13). */
  supportsVirtualHostRouting: boolean;
  /** Kann der Wizard bestehende Weltdaten übernehmen (Lastenheft §3.3)? */
  supportsWorldImport: boolean;
  defaultPorts: number[];
  resourceDefaults: ServerResourceLimits;
  configFields: GameConfigField[];
  available: boolean;
  /** Grund, wenn `available === false`, z. B. „Kommt in Phase 2". */
  unavailableReason: string | null;
}

// ---------------------------------------------------------------------------
// Vollständige Definition (ergänzt in B3)
// ---------------------------------------------------------------------------
// Der DTO oben ist die Sicht des Frontends. Die vollständige Definition steht
// hier, weil der Vertrag beschreiben muss, was ein Spiel ausmacht – die
// konkreten Definitionen liegen als Registry im Backend
// (`apps/backend/src/modules/server-orchestration/game-registry.ts`), denn neue
// Spiele werden in Version 1 per Code ergänzt, nicht über eine Oberfläche
// (Pflichtenheft §11).

/**
 * Art der Erreichbarkeitsprüfung (Pflichtenheft §9: „Query via `gamedig` bzw.
 * generischer Port-Connect-Test beim Test-Typ").
 *
 * `portConnect` prüft nur, ob sich eine TCP-Verbindung aufbauen lässt, und
 * liefert deshalb keine Spielerzahlen. `gamedig` fragt das Spieleprotokoll ab
 * und liefert zusätzlich Spielerzahl und Ping.
 */
export const GAME_QUERY_KINDS = ['portConnect', 'gamedig'] as const;

export type GameQueryKind = (typeof GAME_QUERY_KINDS)[number];

/** Generischer Port-Connect-Test (Phase 1, Test-Typ). */
export interface PortConnectQuerySpec {
  readonly kind: 'portConnect';
  /** Container-Port, auf dem geprüft wird; muss in `ports` vorkommen. */
  readonly containerPort: number;
}

/**
 * Abfrage über `gamedig` (Phase 2+).
 *
 * `protocol` ist der Bezeichner der `gamedig`-Bibliothek, z. B. `minecraft`.
 * Bewusst ein freier String: Die Liste unterstützter Protokolle gehört der
 * Bibliothek, nicht diesem Vertrag.
 */
export interface GamedigQuerySpec {
  readonly kind: 'gamedig';
  readonly protocol: string;
  readonly containerPort: number;
}

export type GameQuerySpec = PortConnectQuerySpec | GamedigQuerySpec;

export type GameTypePortProtocol = 'tcp' | 'udp';

/** Ein Standard-Port einer Spiele-Definition. */
export interface GameTypePort {
  readonly containerPort: number;
  readonly protocol: GameTypePortProtocol;
  /**
   * `true` beim Port, den der Spieler benutzt. Genau einer je Definition; er
   * landet als sichtbarer Port in der Verbindungsadresse (Pflichtenheft §13).
   */
  readonly primary: boolean;
  /** Beschriftung für die Oberfläche, z. B. „Spiel-Port" oder „RCON". */
  readonly label: string;
}

/**
 * Vollständige Spiele-Definition (Pflichtenheft §11).
 *
 * Änderungen sind bevorzugt additiv (neue optionale Felder).
 */
export interface GameTypeDefinition {
  /** Stabile Kennung, wie sie in `GameServer.gameType` steht, z. B. `test-echo`. */
  readonly id: string;
  /** Anzeigename, z. B. „Minecraft (Paper)". */
  readonly name: string;
  readonly description: string;
  readonly dockerImage: string;
  /** Startbefehl; ohne Angabe gilt der Entrypoint des Images. */
  readonly defaultCommand?: readonly string[];
  readonly defaultEnv: Readonly<Record<string, string>>;
  readonly ports: readonly GameTypePort[];
  readonly configFields: readonly GameConfigField[];
  readonly resourceDefaults: ServerResourceLimits;
  readonly query: GameQuerySpec;
  readonly iconUrl: string | null;
  readonly coverImageUrl: string | null;
  /**
   * Hostname-basiertes Routing über einen einzigen öffentlichen Port
   * (Pflichtenheft §2.4, §13 – initial nur Minecraft). Bei `true` bekommt der
   * Spieler keinen Port zu sehen.
   */
  readonly supportsVirtualHostRouting: boolean;
  /** Kann der Wizard bestehende Weltdaten übernehmen (Lastenheft §3.3)? */
  readonly supportsWorldImport: boolean;
  /** Beschreibbarer Datenordner im Container – der einzige dauerhaft beschreibbare Ort. */
  readonly dataVolumeContainerPath: string;
  /**
   * Read-only-Root-Filesystem. Pflichtenheft §2.3 verlangt das „wo vom Spiel
   * unterstützt" – die Entscheidung trifft diese Definition, nicht der Agent.
   */
  readonly readOnlyRootFilesystem?: boolean;
  /** Zusätzliche beschreibbare tmpfs-Pfade bei read-only Root (z. B. `/tmp`). */
  readonly tmpfsPaths?: readonly string[];
  /** Kulanzzeit für SIGTERM vor SIGKILL. */
  readonly stopTimeoutSeconds?: number;
  /**
   * Wie lange nach dem Start auf einen erfolgreichen Health-Check gewartet wird,
   * bevor der Start als gescheitert gilt (Pflichtenheft §9). Ein Spiel, das
   * seine Welt erst generieren muss, braucht hier mehr Zeit als ein Test-Typ.
   */
  readonly startupTimeoutSeconds: number;
  /**
   * Ausbaustufe, ab der dieses Spiel fachlich existiert (Lastenheft §3.5).
   * Definitionen späterer Phasen sind sichtbar, aber nicht auswählbar.
   */
  readonly phase: 1 | 2 | 3;
}
