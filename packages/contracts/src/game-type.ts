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
