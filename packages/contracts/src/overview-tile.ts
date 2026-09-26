/**
 * Übersichts-Kacheln ohne Server (Betreiber-Wunsch 26.09.2026).
 *
 * Eine Kachel in der Übersicht, hinter der **kein** Server des Panels steht:
 * ein befreundeter Server auf einer fremden Instanz, ein öffentlicher
 * Community-Server, ein Discord. Sie sieht aus wie eine angeheftete Server-
 * Karte, kann aber nichts – nicht starten, nicht stoppen, keine Messwerte.
 * Was es nicht gibt, zeigt die Karte ausgegraut, damit sie neben den echten
 * Karten nicht aus der Reihe fällt.
 *
 * **Für alle, nicht je Konto.** Anders als `server_pins` (Anheftung je
 * Betrachter) legt ein Administrator die Kacheln einmal an, und jedes
 * freigeschaltete Konto sieht dieselben. Eine Kachel je Konto ergäbe keinen
 * Sinn: Sie wirbt für etwas, das jeder sehen soll.
 *
 * **Warum das Spiel nur als Kennung.** Symbol und Kachelbild gehören zur
 * Vorlage (`GameTypeDto.iconUrl` / `coverImageUrl`), und die Übersicht kennt
 * die Spieleliste ohnehin. Die Kachel trägt deshalb nur `gameTypeId`; die
 * Bilder holt sich die Oberfläche von dort – kein zweiter Bildspeicher.
 */

import { type WithPermissions } from './permissions.js';

/** Was der Aufrufer mit einer Kachel tun darf (Pflichtenheft §5.2). */
export interface OverviewTilePermissions {
  /** Kachel ändern (`instance.manage`). */
  canEdit: boolean;
  /** Kachel entfernen (`instance.manage`). */
  canDelete: boolean;
}

/** Höchstlängen der Textfelder – dieselben Werte prüft `@palantir/validation`. */
export const OVERVIEW_TILE_TITLE_MAX_LENGTH = 80;
export const OVERVIEW_TILE_SUBTITLE_MAX_LENGTH = 160;
export const OVERVIEW_TILE_GAME_LABEL_MAX_LENGTH = 40;
export const OVERVIEW_TILE_ADDRESS_MAX_LENGTH = 160;
export const OVERVIEW_TILE_LINK_URL_MAX_LENGTH = 400;
export const OVERVIEW_TILE_LINK_LABEL_MAX_LENGTH = 40;
/** Reihenfolge in der Übersicht – kleine Zahl zuerst. */
export const OVERVIEW_TILE_SORT_ORDER_MAX = 1000;

/**
 * Eine Kachel, wie die Übersicht und die Verwaltung sie zeigen.
 *
 * Wie jedes DTO vollständig samt `permissions` – keine view-spezifisch
 * zusammengestrichene Sonderform (Entwicklungsregeln §3).
 */
export interface OverviewTileDto extends WithPermissions<OverviewTilePermissions> {
  id: string;
  /** Name, wie er groß auf der Kachel steht. */
  title: string;
  /** Zweite Zeile unter dem Namen; `null` = keine. */
  subtitle: string | null;
  /**
   * Spieltyp aus dem Katalog (`GameTypeDto.id`), für Symbol und Kachelbild;
   * `null`, wenn das Spiel im Katalog nicht vorkommt.
   */
  gameTypeId: string | null;
  /**
   * Spielbezeichnung als Text, z. B. „CS2 · Surf".
   *
   * Steht neben oder statt des Spieltyps: Ein Surf-Server ist zwar CS2, aber
   * „Counter-Strike 2" allein sagte nicht, was dort gespielt wird.
   */
  gameLabel: string | null;
  /**
   * Verbindungsadresse, wie ein Spieler sie eintippt (`host:port`).
   *
   * `null`, solange keine hinterlegt ist – die Kachel zeigt dann den Chip
   * ausgegraut, wie eine nicht freigegebene Adresse.
   */
  address: string | null;
  /** Ziel des Knopfes auf der Kachel (nur `http`/`https`); `null` = kein Knopf. */
  linkUrl: string | null;
  /** Beschriftung des Knopfes, z. B. „Discord"; ohne Angabe „Öffnen". */
  linkLabel: string | null;
  /** Reihenfolge in der Übersicht – kleine Zahl zuerst, gleiche Zahl nach Titel. */
  sortOrder: number;
  /**
   * Eingeschaltet? (Betreiber-Wunsch 26.09.2026.)
   *
   * Ausgeschaltet heißt: nicht in der Übersicht, aber nicht gelöscht – die
   * Angaben bleiben erhalten, ein Klick holt die Kachel zurück. Wer die
   * Kacheln verwaltet, bekommt auch die ausgeschalteten geliefert (mit diesem
   * Feld `false`); alle anderen sehen nur eingeschaltete.
   */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
