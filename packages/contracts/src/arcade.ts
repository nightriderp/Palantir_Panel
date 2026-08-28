/**
 * Arcade-DTOs (Pflichtenheft §17, Lastenheft §3.9).
 *
 * Der Arcade-Bereich sind eigenständig entwickelte, rein clientseitige
 * Browser-Minispiele mit einer nutzerbezogenen Bestenliste je Spiel. Persistiert
 * wird ausschließlich der erreichte Punktestand (`ArcadeScore`); die Spiele
 * selbst laufen vollständig im Browser (F8).
 *
 * **Rechtliche Vorgabe (Lastenheft §3.9):** Die Spiele sind eigenständig
 * entwickelt und tragen bewusst **eigene** Namen – keine geschützten Marken,
 * keine Original-Assets oder -Level. Deshalb steht hier ein eigener Katalog mit
 * frei gewählten deutschen Namen statt der bekannten Originaltitel.
 *
 * **Warum der Katalog im Contract liegt:** Backend (Validierung der `gameId`,
 * Titel der Bestenliste) und Frontend (Auswahlseite, Überschriften) müssen
 * dieselbe Liste kennen (CLAUDE.md §3). Die reine Darstellung – Farben,
 * Steuerungshinweise, Spiellogik – bleibt im Frontend.
 *
 * **`ArcadeScore` gegenüber Pflichtenheft §6:** Dort stehen `userId`, `gameId`,
 * `score`, `createdAt`. Der DTO nach außen zeigt zusätzlich die vom Backend
 * erzeugte `id` und lässt `userId` weg, wenn der Datensatz ohnehin dem
 * aufrufenden Konto gehört – die Bestenliste bringt Konto und Anzeigename über
 * ihre Einträge mit. Alle Ergänzungen sind additiv.
 */

/**
 * Kennungen der Minispiele.
 *
 * Bewusst sprechende, eigene Kennungen statt der Originalnamen. Reihenfolge =
 * Reihenfolge auf der Auswahlseite. Der Katalog ist additiv erweiterbar: neues
 * Spiel hier und in `ARCADE_GAME_CATALOG` ergänzen, Rest ist Frontend
 * (Lastenheft §4 „Erweiterbarkeit": neue Spiele ohne Architekturänderung).
 */
export const ARCADE_GAME_IDS = [
  'kriechpfad',
  'ballwechsel',
  'steinbrecher',
  'blockstapel',
  'punktejaeger',
] as const;

/** Gültige Spiel-Kennung – verhindert Freitext-Strings. */
export type ArcadeGameId = (typeof ARCADE_GAME_IDS)[number];

/** Beschreibung eines Minispiels für Auswahlseite und Bestenlisten-Titel. */
export interface ArcadeGameDefinition {
  readonly id: ArcadeGameId;
  /** Angezeigter Name (deutsch, eigenständig – kein Originaltitel). */
  readonly name: string;
  /** Kurzer Untertitel für die Kachel auf der Auswahlseite. */
  readonly tagline: string;
  /** Ein bis zwei Sätze, was das Spiel ist – ohne Bezug auf geschützte Marken. */
  readonly description: string;
}

/**
 * Katalog der Minispiele (Lastenheft §3.9).
 *
 * Fünf eigenständige Spiele in der Tradition bekannter Genres, jeweils mit
 * eigenem Namen. Die Genre-Verwandtschaft steht in der Beschreibung, damit
 * Nutzer wissen, was sie erwartet – ohne einen geschützten Titel zu nennen.
 */
export const ARCADE_GAME_CATALOG: Record<ArcadeGameId, ArcadeGameDefinition> = {
  kriechpfad: {
    id: 'kriechpfad',
    name: 'Kriechpfad',
    tagline: 'Sammle Punkte, ohne dich selbst zu treffen',
    description:
      'Lenke eine wachsende Linie über das Feld, friss Häppchen und weiche deinem eigenen Schweif aus. Jeder Bissen macht dich länger.',
  },
  ballwechsel: {
    id: 'ballwechsel',
    name: 'Ballwechsel',
    tagline: 'Halte den Ball im Spiel',
    description:
      'Ein Schläger, ein Ball, ein Gegner. Wehre jeden Aufprall ab und treibe den Ball an der Abwehr vorbei.',
  },
  steinbrecher: {
    id: 'steinbrecher',
    name: 'Steinbrecher',
    tagline: 'Räume die Mauer ab',
    description:
      'Ein Ball springt gegen eine Wand aus Blöcken. Fange ihn mit dem Schläger auf und zertrümmere Reihe um Reihe.',
  },
  blockstapel: {
    id: 'blockstapel',
    name: 'Blockstapel',
    tagline: 'Fülle die Reihen',
    description:
      'Fallende Formen wollen sinnvoll gestapelt sein. Vollständige Reihen lösen sich auf – lass den Stapel nicht die Decke erreichen.',
  },
  punktejaeger: {
    id: 'punktejaeger',
    name: 'Punktejäger',
    tagline: 'Sammle alles ein, weiche den Wächtern aus',
    description:
      'Ziehe durch ein Labyrinth, sammle jeden Punkt ein und halte Abstand zu den Wächtern, die dich verfolgen.',
  },
};

/** Alle Spiel-Definitionen in Anzeigereihenfolge. */
export const ARCADE_GAMES: readonly ArcadeGameDefinition[] = ARCADE_GAME_IDS.map(
  (id) => ARCADE_GAME_CATALOG[id],
);

/** Prüft, ob ein beliebiger String eine bekannte Spiel-Kennung ist. */
export function isArcadeGameId(value: string): value is ArcadeGameId {
  return Object.prototype.hasOwnProperty.call(ARCADE_GAME_CATALOG, value);
}

/**
 * Obergrenze eines Punktestands.
 *
 * Kein Spiel erreicht realistischerweise auch nur die Nähe dieses Werts; die
 * Grenze fängt nur offensichtlichen Unsinn ab, bevor er in der Datenbank landet
 * (die Bestenliste ist nutzerbezogen und rein zur Unterhaltung, ein
 * server-autoritatives Nachspielen wäre unverhältnismäßig – Lastenheft §3.9).
 */
export const ARCADE_SCORE_MAX = 100_000_000;

/**
 * Ein persistierter Punktestand (Pflichtenheft §6, Entität `ArcadeScore`).
 *
 * Gehört immer dem aufrufenden Konto – deshalb ohne `userId`. Wird beim
 * Absenden eines Spielergebnisses zurückgegeben.
 */
export interface ArcadeScoreDto {
  id: string;
  gameId: ArcadeGameId;
  score: number;
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
}

/**
 * Eine Zeile der Bestenliste eines Spiels (Lastenheft §3.9, „nutzerbezogen").
 *
 * Eine Zeile je Konto – der **beste** je gespielte Punktestand, nicht jeder
 * einzelne Versuch. `rank` beginnt bei 1.
 */
export interface ArcadeLeaderboardEntryDto {
  rank: number;
  userId: string;
  /** Anzeigename des Kontos zum Zeitpunkt der Abfrage. */
  displayName: string;
  bestScore: number;
  /** ISO-8601-Zeitstempel, wann dieser Bestwert erreicht wurde. */
  achievedAt: string;
  /** Gehört diese Zeile dem aufrufenden Konto? Für die Hervorhebung im Frontend. */
  isCurrentUser: boolean;
}

/**
 * Eigene Statistik des aufrufenden Kontos zu einem Spiel.
 *
 * `null` an Stelle des ganzen Objekts bedeutet „noch nie gespielt".
 */
export interface ArcadePersonalStatsDto {
  bestScore: number;
  /** Platz in der Gesamtwertung; `null`, wenn außerhalb der geführten Liste. */
  rank: number | null;
  /** Anzahl der insgesamt abgesendeten Versuche. */
  gamesPlayed: number;
}

/**
 * Serverseitig berechnetes `permissions`-Objekt der Bestenliste
 * (Pflichtenheft §5.2, CLAUDE.md §3).
 *
 * Der Arcade-Bereich kennt keine eigene Permission im Katalog: Spielen darf
 * jedes angemeldete Konto. `canSubmit` ist deshalb schlicht „ist angemeldet"
 * und steuert im Frontend, ob nach einem Spiel ein Ergebnis abgeschickt wird.
 */
export interface ArcadeLeaderboardPermissions {
  canSubmit: boolean;
}

/** Bestenliste eines Spiels samt eigener Statistik (Lastenheft §3.9). */
export interface ArcadeLeaderboardDto {
  gameId: ArcadeGameId;
  /** Absteigend nach `bestScore` sortiert, auf die Spitzenplätze begrenzt. */
  entries: ArcadeLeaderboardEntryDto[];
  /** Statistik des aufrufenden Kontos; `null`, wenn es das Spiel nie gespielt hat. */
  personal: ArcadePersonalStatsDto | null;
  permissions: ArcadeLeaderboardPermissions;
}

/**
 * Ergebnis des Absendens eines Punktestands.
 *
 * Enthält den gespeicherten Datensatz und die aktualisierte eigene Statistik,
 * damit das Frontend nach dem Spiel „Neuer Bestwert!" anzeigen kann, ohne die
 * Bestenliste erneut abzurufen.
 */
export interface ArcadeSubmitResultDto {
  score: ArcadeScoreDto;
  personal: ArcadePersonalStatsDto;
  /** War dieser Versuch besser als alle vorherigen dieses Kontos? */
  isNewPersonalBest: boolean;
}

/** Standardlänge einer Bestenliste (Spitzenplätze). */
export const ARCADE_LEADERBOARD_LIMIT = 20;
