/**
 * Spielhalle – DTOs (Pflichtenheft §17, Lastenheft §3.9).
 *
 * Die Spielhalle hat zwei Arten von Spielen:
 *
 *   - **Echtzeit-Spiele** (Snake, Tetris, Pac-Man …) für eine Person mit
 *     Punktestand. Der Browser schickt nicht den Stand, sondern die Eingaben;
 *     das Backend spielt die Partie aus einem von ihm ausgegebenen Startwert
 *     nach und speichert nur den selbst errechneten Stand (Vorbild:
 *     Schwesterprojekt, Betreiber-Wunsch 26.09.2026).
 *   - **Rundenbasierte Spiele** (Schach, UNO, Catan, Codenames …). Sie laufen am
 *     selben Gerät, gegen den Computer oder online in einem Raum, in dem der
 *     Server die Züge anwendet. In die Bestenliste gehen Siege aus Online-Räumen
 *     und nachgerechnete Siege gegen den Computer.
 *
 * Die Regeln selbst liegen in `@palantir/arcade` und laufen im Browser wie im
 * Backend. Hier steht nur, was über die Leitung geht.
 *
 * **Namen (Abweichung von Lastenheft §3.9, Betreiber-Entscheidung 26.09.2026):**
 * Die Spiele tragen ihre bekannten Namen. Grafik, Musik, Texte und Rätsel sind
 * vollständig eigenständig erstellt – es werden keine Original-Assets verwendet.
 * Die Kennungen der ersten fünf Spiele bleiben unverändert, weil Punktestände
 * und Erfolge an ihnen hängen.
 */

/**
 * Kennungen der Spiele. Reihenfolge = Reihenfolge auf der Auswahlseite
 * innerhalb ihrer Kategorie.
 */
export const ARCADE_GAME_IDS = [
  // Arcade (Echtzeit)
  'kriechpfad',
  'blockstapel',
  'punktejaeger',
  'steinbrecher',
  'ballwechsel',
  'invaders',
  'flappy',
  // Knobeln (Echtzeit-Maschine, Eingabe-getrieben, oder solo rundenbasiert)
  'zahlen2048',
  'minesweeper',
  'simon',
  'solitaer',
  'galgenmaennchen',
  // Brettspiel-Klassiker
  'schach',
  'dame',
  'muehle',
  'vier-gewinnt',
  'backgammon',
  'mensch-aergere-dich-nicht',
  'schiffe-versenken',
  // Große Brettspiele
  'monopoly',
  'risiko',
  'catan',
  // Karten- und Würfelspiele
  'uno',
  'kniffel',
  // Party
  'codenames',
  'black-stories',
] as const;

export type ArcadeGameId = (typeof ARCADE_GAME_IDS)[number];

/** Gruppierung auf der Auswahlseite. */
export type ArcadeCategory = 'arcade' | 'knobel' | 'klassiker' | 'brettspiel' | 'karten' | 'party';

export const ARCADE_CATEGORY_LABELS: Record<ArcadeCategory, string> = {
  arcade: 'Arcade',
  knobel: 'Knobeln & Solo',
  klassiker: 'Brettspiel-Klassiker',
  brettspiel: 'Große Brettspiele',
  karten: 'Karten & Würfel',
  party: 'Party',
};

export const ARCADE_CATEGORIES: readonly ArcadeCategory[] = [
  'arcade',
  'knobel',
  'klassiker',
  'brettspiel',
  'karten',
  'party',
];

/**
 * Welche Maschine ein Spiel antreibt.
 *
 * `realtime` = fester Takt und Eingabeband (`RealtimeGame`), `turn` = Züge
 * (`TurnGame`). Das Backend wählt daran den Weg des Nachrechnens.
 */
export type ArcadeEngine = 'realtime' | 'turn';

/**
 * Was die Bestenliste zählt.
 *
 * `score` = bester Einzelstand je Konto, `wins` = Summe der Siege je Konto.
 */
export type ArcadeMetric = 'score' | 'wins';

/** Wie sich ein Spiel spielen lässt. */
export interface ArcadeGameModes {
  /** Allein ohne Gegner (Echtzeit-Spiele, Solitär, Kniffel solo). */
  solo: boolean;
  /** Gegen Computergegner. */
  bots: boolean;
  /** Mehrere Menschen am selben Gerät. */
  local: boolean;
  /** Online-Raum mit anderen Konten. */
  online: boolean;
}

export interface ArcadeGameDefinition {
  readonly id: ArcadeGameId;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  /** Additiv (26.09.2026). */
  readonly category: ArcadeCategory;
  readonly engine: ArcadeEngine;
  readonly metric: ArcadeMetric;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly modes: ArcadeGameModes;
  /** Akzentfarbe der Kachel (Hex), passend zum Kachelbild. */
  readonly accent: string;
  /** Grobe Spieldauer für die Kachel, z. B. „5–15 Min.". */
  readonly duration: string;
}

const SOLO: ArcadeGameModes = { solo: true, bots: false, local: false, online: false };
const DUELL: ArcadeGameModes = { solo: false, bots: true, local: true, online: true };
const PARTY: ArcadeGameModes = { solo: false, bots: false, local: true, online: true };

function realtime(
  def: Omit<
    ArcadeGameDefinition,
    'engine' | 'metric' | 'minPlayers' | 'maxPlayers' | 'modes' | 'category'
  > & { category?: ArcadeCategory },
): ArcadeGameDefinition {
  return {
    category: 'arcade',
    ...def,
    engine: 'realtime',
    metric: 'score',
    minPlayers: 1,
    maxPlayers: 1,
    modes: SOLO,
  };
}

export const ARCADE_GAME_CATALOG: Record<ArcadeGameId, ArcadeGameDefinition> = {
  kriechpfad: realtime({
    id: 'kriechpfad',
    name: 'Snake',
    tagline: 'Fressen, wachsen, nicht in den eigenen Schwanz beißen',
    description:
      'Steuere die Schlange über das Feld, schnapp dir das Futter und werde mit jedem Bissen länger – und schneller.',
    accent: '#4ade80',
    duration: '2–10 Min.',
  }),
  blockstapel: realtime({
    id: 'blockstapel',
    name: 'Tetris',
    tagline: 'Fallende Steine, volle Reihen',
    description:
      'Drehe und setze die fallenden Formen so, dass volle Reihen entstehen. Mit Vorschau, Halten und steigendem Tempo.',
    accent: '#a78bfa',
    duration: '5–20 Min.',
  }),
  punktejaeger: realtime({
    id: 'punktejaeger',
    name: 'Pac-Man',
    tagline: 'Punkte futtern, Geistern entkommen',
    description:
      'Friss dich durchs Labyrinth, schnapp dir die Kraftpillen und jage dann die Geister, die dich eben noch verfolgt haben.',
    accent: '#facc15',
    duration: '5–15 Min.',
  }),
  steinbrecher: realtime({
    id: 'steinbrecher',
    name: 'Breakout',
    tagline: 'Die Mauer muss weg',
    description:
      'Halte den Ball mit dem Schläger im Spiel und zertrümmere Level um Level die bunte Mauer. Manche Steine lassen Extras fallen.',
    accent: '#fb7185',
    duration: '5–15 Min.',
  }),
  ballwechsel: realtime({
    id: 'ballwechsel',
    name: 'Pong',
    tagline: 'Der Urahn aller Videospiele',
    description:
      'Schläger gegen Schläger gegen den Computer. Wer zuerst sieben Punkte hat, gewinnt – der Ball wird mit jedem Treffer schneller.',
    accent: '#38bdf8',
    duration: '3–8 Min.',
  }),
  invaders: realtime({
    id: 'invaders',
    name: 'Space Invaders',
    tagline: 'Die Invasion rückt näher',
    description:
      'Reihe um Reihe marschieren die Angreifer auf die Erde zu. Schieß sie ab, bevor sie landen, und nutze die Schutzbunker.',
    accent: '#34d399',
    duration: '5–15 Min.',
  }),
  flappy: realtime({
    id: 'flappy',
    name: 'Flappy Bird',
    tagline: 'Ein Flügelschlag zu viel …',
    description:
      'Ein kleiner Vogel, eine endlose Reihe Röhren und nur eine Taste. Wie weit kommst du?',
    accent: '#fbbf24',
    duration: '1–5 Min.',
  }),
  zahlen2048: realtime({
    id: 'zahlen2048',
    category: 'knobel',
    name: '2048',
    tagline: 'Schieben, verschmelzen, verdoppeln',
    description:
      'Schiebe die Zahlenkacheln über das Feld. Gleiche Kacheln verschmelzen – schaffst du die 2048 oder sogar mehr?',
    accent: '#f59e0b',
    duration: '5–20 Min.',
  }),
  minesweeper: realtime({
    id: 'minesweeper',
    category: 'knobel',
    name: 'Minesweeper',
    tagline: 'Logik statt Glück',
    description:
      'Decke alle freien Felder auf, ohne eine Mine zu erwischen. Die Zahlen verraten, wie viele Minen nebenan liegen. Je schneller, desto mehr Punkte.',
    accent: '#94a3b8',
    duration: '2–10 Min.',
  }),
  simon: realtime({
    id: 'simon',
    category: 'knobel',
    name: 'Simon',
    tagline: 'Merk dir die Farbfolge',
    description:
      'Vier Farben, eine immer länger werdende Folge aus Licht und Ton. Spiel sie fehlerfrei nach – so lange du kannst.',
    accent: '#f472b6',
    duration: '2–8 Min.',
  }),
  solitaer: {
    id: 'solitaer',
    category: 'knobel',
    name: 'Solitär',
    tagline: 'Der Klassiker unter den Kartenspielen für eine Person',
    description:
      'Baue die vier Farbstapel von Ass bis König auf. Je weniger Züge du brauchst, desto mehr Punkte gibt es.',
    engine: 'turn',
    metric: 'score',
    minPlayers: 1,
    maxPlayers: 1,
    modes: SOLO,
    accent: '#22c55e',
    duration: '5–15 Min.',
  },
  galgenmaennchen: {
    id: 'galgenmaennchen',
    category: 'knobel',
    name: 'Galgenmännchen',
    tagline: 'Buchstabe für Buchstabe zum Wort',
    description:
      'Rate das gesuchte Wort, bevor das Männchen fertig gezeichnet ist – allein gegen den Computer oder mit Freunden, die sich Wörter ausdenken.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 1,
    maxPlayers: 6,
    modes: { solo: true, bots: false, local: true, online: true },
    accent: '#e879f9',
    duration: '2–5 Min.',
  },
  schach: {
    id: 'schach',
    category: 'klassiker',
    name: 'Schach',
    tagline: 'Das königliche Spiel',
    description:
      'Vollständige Regeln mit Rochade, en passant und Umwandlung. Spiel gegen einen Freund oder fordere den Computer in drei Stärken heraus.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 2,
    modes: DUELL,
    accent: '#e2e8f0',
    duration: '10–60 Min.',
  },
  dame: {
    id: 'dame',
    category: 'klassiker',
    name: 'Dame',
    tagline: 'Springen, schlagen, zur Dame werden',
    description:
      'Schlagen ist Pflicht, Mehrfachsprünge sind erlaubt. Wer die gegnerische Grundlinie erreicht, wird zur Dame.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 2,
    modes: DUELL,
    accent: '#ef4444',
    duration: '10–30 Min.',
  },
  muehle: {
    id: 'muehle',
    category: 'klassiker',
    name: 'Mühle',
    tagline: 'Drei in einer Reihe',
    description:
      'Setzen, ziehen, springen: Bilde Mühlen und nimm dem Gegner Steine weg, bis er nur noch zwei hat oder nicht mehr ziehen kann.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 2,
    modes: DUELL,
    accent: '#d97706',
    duration: '10–20 Min.',
  },
  'vier-gewinnt': {
    id: 'vier-gewinnt',
    category: 'klassiker',
    name: 'Vier gewinnt',
    tagline: 'Vier Steine in einer Linie',
    description:
      'Lass deine Steine in die Spalten fallen – waagrecht, senkrecht oder diagonal: Wer zuerst vier in einer Reihe hat, gewinnt.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 2,
    modes: DUELL,
    accent: '#3b82f6',
    duration: '3–10 Min.',
  },
  backgammon: {
    id: 'backgammon',
    category: 'klassiker',
    name: 'Backgammon',
    tagline: 'Würfelglück trifft Strategie',
    description:
      'Bring alle fünfzehn Steine nach Hause und würfle sie hinaus. Mit Pasch, Schlagen und der Bar – nur ohne Verdopplungswürfel.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 2,
    modes: DUELL,
    accent: '#b45309',
    duration: '10–30 Min.',
  },
  'mensch-aergere-dich-nicht': {
    id: 'mensch-aergere-dich-nicht',
    category: 'klassiker',
    name: 'Mensch ärgere dich nicht',
    tagline: 'Rausschmeißen erlaubt',
    description:
      'Würfle deine vier Figuren einmal ums Brett ins Ziel. Eine Sechs bringt dich raus und lässt dich noch mal würfeln – und wer im Weg steht, fliegt.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 4,
    modes: DUELL,
    accent: '#f97316',
    duration: '20–45 Min.',
  },
  'schiffe-versenken': {
    id: 'schiffe-versenken',
    category: 'klassiker',
    name: 'Schiffe versenken',
    tagline: 'Treffer – versenkt!',
    description:
      'Versteck deine Flotte auf dem Raster und finde die des Gegners, bevor er deine findet.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 2,
    modes: DUELL,
    accent: '#0ea5e9',
    duration: '10–20 Min.',
  },
  monopoly: {
    id: 'monopoly',
    category: 'brettspiel',
    name: 'Monopoly',
    tagline: 'Kaufen, bauen, abkassieren',
    description:
      'Würfle über das Brett, kauf Straßen, bau Häuser und Hotels und treib deine Mitspieler in den Ruin – mit Gefängnis, Ereignis- und Gemeinschaftskarten.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 6,
    modes: DUELL,
    accent: '#16a34a',
    duration: '45–120 Min.',
  },
  risiko: {
    id: 'risiko',
    category: 'brettspiel',
    name: 'Risiko',
    tagline: 'Erobere die Welt',
    description:
      'Verstärken, angreifen, befestigen: Würfle dich über 42 Länder und sechs Kontinente, sammle Karten und tausche sie gegen Armeen.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 6,
    modes: DUELL,
    accent: '#dc2626',
    duration: '45–120 Min.',
  },
  catan: {
    id: 'catan',
    category: 'brettspiel',
    name: 'Catan',
    tagline: 'Siedeln, handeln, bauen',
    description:
      'Sammle Holz, Lehm, Wolle, Getreide und Erz, bau Straßen, Siedlungen und Städte und handle mit Bank, Häfen und Mitspielern. Wer zuerst zehn Siegpunkte hat, gewinnt.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 4,
    modes: DUELL,
    accent: '#ea580c',
    duration: '45–90 Min.',
  },
  uno: {
    id: 'uno',
    category: 'karten',
    name: 'UNO',
    tagline: 'Farbe oder Zahl – und am Ende „UNO!"',
    description:
      'Leg passende Karten ab, ärgere die anderen mit Aussetzen, Richtungswechsel und +4 – und vergiss nicht, „UNO" zu rufen.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 8,
    modes: DUELL,
    accent: '#e11d48',
    duration: '10–30 Min.',
  },
  kniffel: {
    id: 'kniffel',
    category: 'karten',
    name: 'Kniffel',
    tagline: 'Fünf Würfel, drei Würfe, dreizehn Felder',
    description:
      'Würfle Drillinge, Straßen und Full House und trag sie klug ein. Allein auf Bestpunktzahl oder gegen andere.',
    engine: 'turn',
    metric: 'score',
    minPlayers: 1,
    maxPlayers: 6,
    modes: { solo: true, bots: true, local: true, online: true },
    accent: '#8b5cf6',
    duration: '10–30 Min.',
  },
  codenames: {
    id: 'codenames',
    category: 'party',
    name: 'Codenames',
    tagline: 'Ein Wort, eine Zahl – und hoffentlich kein Attentäter',
    description:
      'Zwei Teams, 25 Begriffe. Die Geheimdienstchefs geben Hinweise aus einem Wort, ihre Agenten raten. Wer den Attentäter erwischt, verliert sofort.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 10,
    modes: PARTY,
    accent: '#2563eb',
    duration: '15–30 Min.',
  },
  'black-stories': {
    id: 'black-stories',
    category: 'party',
    name: 'Black Stories',
    tagline: 'Rabenschwarze Rätsel',
    description:
      'Ein makabres Ende, aber was ist passiert? Die Spielleitung kennt die Lösung und antwortet nur mit Ja oder Nein. Eigene, neu geschriebene Rätsel.',
    engine: 'turn',
    metric: 'wins',
    minPlayers: 2,
    maxPlayers: 10,
    modes: PARTY,
    accent: '#71717a',
    duration: '10–30 Min.',
  },
};

export const ARCADE_GAMES: readonly ArcadeGameDefinition[] = ARCADE_GAME_IDS.map(
  (id) => ARCADE_GAME_CATALOG[id],
);

export function isArcadeGameId(value: string): value is ArcadeGameId {
  return Object.prototype.hasOwnProperty.call(ARCADE_GAME_CATALOG, value);
}

/** Obergrenze eines Punktestands – fängt Unsinn ab, bevor er in die Datenbank kommt. */
export const ARCADE_SCORE_MAX = 100_000_000;

// ---------------------------------------------------------------------------
// Punktestände und Bestenliste
// ---------------------------------------------------------------------------

export interface ArcadeScoreDto {
  id: string;
  gameId: ArcadeGameId;
  score: number;
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
}

export interface ArcadeLeaderboardEntryDto {
  rank: number;
  userId: string;
  displayName: string;
  /** Getragener Titel des Kontos; `null`, wenn es keinen trägt (21.09.2026). */
  title: string | null;
  /** Zeitstempel des Profilbilds; `null` ohne Bild (Adresse baut das Frontend). */
  avatarUpdatedAt: string | null;
  /** Bei `metric: 'wins'` die Anzahl Siege, sonst der beste Einzelstand. */
  bestScore: number;
  achievedAt: string;
  isCurrentUser: boolean;
}

export interface ArcadePersonalStatsDto {
  bestScore: number;
  rank: number | null;
  gamesPlayed: number;
}

export interface ArcadeLeaderboardPermissions {
  canSubmit: boolean;
}

export interface ArcadeLeaderboardDto {
  gameId: ArcadeGameId;
  /**
   * Additiv (26.09.2026): was `bestScore` bedeutet. Optional, damit ältere
   * Backends ohne das Feld weiter gültige Antworten liefern – fehlt es, gilt
   * `ARCADE_GAME_CATALOG[gameId].metric`.
   */
  metric?: ArcadeMetric;
  entries: ArcadeLeaderboardEntryDto[];
  personal: ArcadePersonalStatsDto | null;
  permissions: ArcadeLeaderboardPermissions;
}

export interface ArcadeSubmitResultDto {
  score: ArcadeScoreDto;
  personal: ArcadePersonalStatsDto;
  isNewPersonalBest: boolean;
}

export const ARCADE_LEADERBOARD_LIMIT = 20;

// ---------------------------------------------------------------------------
// Startwerte und nachgerechnete Einsendungen
// ---------------------------------------------------------------------------

/**
 * Ein vom Backend ausgegebener Startwert (`POST /arcade/games/:gameId/seed`).
 *
 * Einmal verwendbar und kurzlebig. Der Browser spielt mit genau diesem Wert und
 * schickt ihn mit dem Band zurück; ein Band mit selbst gewähltem Startwert
 * nimmt das Backend nicht an.
 */
export interface ArcadeSeedDto {
  seedId: string;
  seed: number;
  gameId: ArcadeGameId;
  /** Fassung der Spielregeln, gegen die das Backend nachrechnet. */
  gameVersion: number;
  /** ISO-8601; danach verfällt der Startwert. */
  expiresAt: string;
}

/** Wie lange ein Startwert gültig ist (Stunden). Eine Monopoly-Partie dauert. */
export const ARCADE_SEED_TTL_HOURS = 6;

/** Wer auf einem Sitz spielt – Mensch oder Computer mit Stufe. */
export type ArcadeBotLevel = 'leicht' | 'mittel' | 'schwer';

export const ARCADE_BOT_LEVELS: readonly ArcadeBotLevel[] = ['leicht', 'mittel', 'schwer'];

export const ARCADE_BOT_LEVEL_LABELS: Record<ArcadeBotLevel, string> = {
  leicht: 'Leicht',
  mittel: 'Mittel',
  schwer: 'Schwer',
};

export type ArcadeSeatControllerDto = { type: 'human' } | { type: 'bot'; level: ArcadeBotLevel };

/** Aufgezeichnete Partie eines rundenbasierten Spiels gegen den Computer. */
export interface ArcadeTurnRecordingDto {
  options: unknown;
  seats: ArcadeSeatControllerDto[];
  /** Nur die Züge des Menschen, in Reihenfolge. */
  moves: { seat: number; move: unknown }[];
}

/**
 * Rumpf von `POST /arcade/scores` (**Breaking Change 26.09.2026**: vorher
 * `{ gameId, score }`). Genau eines von `replay` (Echtzeit) und `match`
 * (rundenbasiert) ist gesetzt. `claimedScore` dient nur dem Abgleich im Log.
 */
export interface SubmitArcadeRunInput {
  gameId: ArcadeGameId;
  seedId: string;
  replay?: string;
  match?: ArcadeTurnRecordingDto;
  claimedScore?: number;
}

// ---------------------------------------------------------------------------
// Online-Räume
// ---------------------------------------------------------------------------

export type ArcadeRoomStatus = 'lobby' | 'running' | 'finished' | 'closed';

export interface ArcadeRoomSeatDto {
  index: number;
  kind: 'human' | 'bot' | 'open';
  userId: string | null;
  /** Anzeigename des Menschen bzw. „Computer (Mittel)". `null` bei freiem Sitz. */
  displayName: string | null;
  avatarUpdatedAt: string | null;
  botLevel: ArcadeBotLevel | null;
  isCurrentUser: boolean;
  /** Hat der Mensch den Raum gerade offen (Live-Verbindung)? */
  online: boolean;
}

/** Serverseitig berechnete Rechte des aufrufenden Kontos (Pflichtenheft §5.2). */
export interface ArcadeRoomPermissions {
  canJoin: boolean;
  canLeave: boolean;
  /** Nur Gastgeber, nur in der Lobby, genug Sitze belegt. */
  canStart: boolean;
  /** Sitze öffnen, mit Computer belegen, Mitspieler entfernen (Gastgeber). */
  canManageSeats: boolean;
  /** Ist das aufrufende Konto gerade am Zug? */
  canMove: boolean;
  canChat: boolean;
  /** Raum schließen (Gastgeber oder Admin). */
  canClose: boolean;
  /** Nach dem Ende neue Partie mit denselben Leuten (Gastgeber). */
  canRematch: boolean;
}

export interface ArcadeRoomSummaryDto {
  id: string;
  /** Sechsstelliger Beitrittscode, z. B. „K7QX2M". */
  code: string;
  gameId: ArcadeGameId;
  status: ArcadeRoomStatus;
  hostUserId: string;
  hostDisplayName: string;
  /** Private Räume stehen nicht in der Lobby-Liste, nur Code/Link führt hinein. */
  isPrivate: boolean;
  seats: ArcadeRoomSeatDto[];
  createdAt: string;
  updatedAt: string;
  permissions: ArcadeRoomPermissions;
}

export interface ArcadeRoomChatMessageDto {
  id: string;
  userId: string | null;
  displayName: string;
  text: string;
  sentAt: string;
}

export interface ArcadeRoomLogEntryDto {
  seat: number | null;
  text: string;
}

export interface ArcadeRoomOutcomeDto {
  winners: number[];
  summary: string;
  scores?: number[];
}

/**
 * Ein Raum aus Sicht des aufrufenden Kontos.
 *
 * `view` ist die Sicht **seines** Sitzes, wie sie die Regeln liefern
 * (`TurnGame.view`), und damit spielspezifisch. Verdeckte Information anderer
 * Sitze ist darin nie enthalten.
 */
export interface ArcadeRoomDto extends ArcadeRoomSummaryDto {
  options: unknown;
  /** Sitz des aufrufenden Kontos; `null` = Zuschauer. */
  mySeat: number | null;
  /** Steigt mit jeder Änderung; Züge schicken sie mit (Konfliktschutz). */
  version: number;
  activeSeats: number[];
  view: unknown;
  log: ArcadeRoomLogEntryDto[];
  outcome: ArcadeRoomOutcomeDto | null;
  chat: ArcadeRoomChatMessageDto[];
}

export interface CreateArcadeRoomInput {
  gameId: ArcadeGameId;
  seatCount: number;
  isPrivate: boolean;
  options?: unknown;
}

export interface JoinArcadeRoomInput {
  /** Wunschsitz; ohne Angabe der erste freie. */
  seat?: number;
}

export interface SetArcadeRoomSeatInput {
  seat: number;
  kind: 'open' | 'bot';
  botLevel?: ArcadeBotLevel;
}

export interface ArcadeRoomMoveInput {
  version: number;
  move: unknown;
}

export interface ArcadeRoomChatInput {
  text: string;
}

/** Längstes Chat-/Fragen-Textstück in einem Raum. */
export const ARCADE_ROOM_CHAT_MAX_LENGTH = 300;
/** So viele Chatzeilen hält ein Raum. */
export const ARCADE_ROOM_CHAT_LIMIT = 100;
/** So viele offene (nicht beendete) Räume darf ein Konto gleichzeitig leiten. */
export const ARCADE_ROOM_MAX_OPEN_PER_USER = 5;
/** Räume ohne Änderung schließen nach so vielen Stunden. */
export const ARCADE_ROOM_IDLE_HOURS = 48;

/** Live-Ereignis des Spielhallen-Kanals (`/arcade/live`). */
export interface ArcadeRoomUpdatedPayload {
  roomId: string;
  version: number;
  status: ArcadeRoomStatus;
}

export interface ArcadeLiveEventFrame {
  kind: 'event';
  event: 'arcadeRoom.updated';
  data: ArcadeRoomUpdatedPayload;
  sentAt: string;
}

// ---------------------------------------------------------------------------
// Musik
// ---------------------------------------------------------------------------

/**
 * Hochgeladenes Musikstück eines Spiels (Admin-Seite „Arcade-Musik").
 *
 * Ohne aktives Stück spielt die Spielhalle die mitgelieferte, im Browser
 * erzeugte Melodie des Spiels.
 */
export interface ArcadeTrackDto {
  id: string;
  gameId: ArcadeGameId;
  title: string;
  mimeType: ArcadeTrackMimeType;
  sizeBytes: number;
  isActive: boolean;
  uploadedAt: string;
  uploadedByDisplayName: string | null;
}

export interface ArcadeTrackListDto {
  tracks: ArcadeTrackDto[];
  permissions: { canManage: boolean };
}

/** Aktive Stücke je Spiel (für alle angemeldeten Konten). */
export interface ArcadeActiveTracksDto {
  tracks: Partial<
    Record<ArcadeGameId, { id: string; title: string; mimeType: ArcadeTrackMimeType }>
  >;
}

export const ARCADE_TRACK_MIME_TYPES = ['audio/mpeg', 'audio/ogg', 'audio/wav'] as const;
export type ArcadeTrackMimeType = (typeof ARCADE_TRACK_MIME_TYPES)[number];
export const ARCADE_TRACK_MAX_BYTES = 8 * 1024 * 1024;
export const ARCADE_TRACK_TITLE_MAX_LENGTH = 80;

/** Browser → Backend auf `/arcade/live`: Lebenszeichen alle 30 s. */
export interface ArcadeLiveClientFrame {
  kind: 'ping';
}

/** Antwort auf `ping`. */
export interface ArcadeLivePongFrame {
  kind: 'pong';
}

export type ArcadeLiveServerFrame = ArcadeLiveEventFrame | ArcadeLivePongFrame;

// ---------------------------------------------------------------------------
// Additiv (Backend-Neubau, 26.09.2026)
// ---------------------------------------------------------------------------

/**
 * Close-Codes des Kanals `/arcade/live` – dieselben Zahlen wie an Chat- und
 * Inbox-Kanal, damit das Frontend „nicht mehr angemeldet" überall gleich
 * erkennt und keinen neuen Verbindungsversuch startet.
 */
export const ARCADE_LIVE_CLOSE_CODE_UNAUTHORIZED = 4401;
/** Zu viele gleichzeitige Verbindungen dieses Kontos; die älteste wird geschlossen. */
export const ARCADE_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS = 4029;
