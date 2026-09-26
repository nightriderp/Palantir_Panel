/**
 * Nachrechnen einer eingereichten Partie (Neubau 26.09.2026, Vorbild
 * Schwesterprojekt).
 *
 * Der Browser schickt nicht mehr den Punktestand, sondern das, woraus er
 * entsteht: bei Echtzeit-Spielen das Eingabeband, bei rundenbasierten Spielen
 * gegen den Computer die Züge des Menschen. Hier wird die Partie aus dem vom
 * Backend ausgegebenen Startwert mit denselben Regeln (`@palantir/arcade`)
 * nachgespielt; gespeichert wird ausschließlich, was dabei herauskommt.
 *
 * Reine Funktion ohne Datenbank und ohne Uhr: Sie läuft im Worker
 * (`verify-worker.ts`) und in den Tests mit einem eingeschleusten Register.
 */

import {
  ARCADE_GAME_CATALOG,
  ARCADE_SCORE_MAX,
  type ArcadeGameId,
  type ArcadeTurnRecordingDto,
} from '@palantir/contracts';
import {
  type AnyRealtimeGame,
  type AnyTurnGame,
  type SeatController,
  decodeArcadeReplay,
  getRealtimeGame,
  getTurnGame,
  replayFromBase64,
  replayTurnMatch,
  runArcadeReplay,
} from '@palantir/arcade';

/** Woher die Regeln kommen – in Tests durch Mini-Spiele ersetzbar. */
export interface ArcadeRuleRegistry {
  realtime(id: ArcadeGameId): AnyRealtimeGame | null;
  turn(id: ArcadeGameId): AnyTurnGame | null;
}

/** Das echte Register aus `@palantir/arcade`. */
export const defaultArcadeRegistry: ArcadeRuleRegistry = {
  realtime: getRealtimeGame,
  turn: getTurnGame,
};

/**
 * Fassung der Regeln eines Spiels laut Register; `null`, wenn das Register
 * das Spiel (noch) nicht kennt oder die Maschine nicht zum Katalog passt.
 */
export function rulesVersionOf(registry: ArcadeRuleRegistry, gameId: ArcadeGameId): number | null {
  const definition = ARCADE_GAME_CATALOG[gameId];
  const rules =
    definition.engine === 'realtime' ? registry.realtime(gameId) : registry.turn(gameId);

  return rules?.version ?? null;
}

/** Alles, was zum Nachrechnen nötig ist – strukturiert klonbar (Worker). */
export interface ArcadeVerifyRequest {
  gameId: ArcadeGameId;
  seed: number;
  /** Fassung, mit der der Startwert ausgegeben wurde. */
  gameVersion: number;
  replay?: string;
  match?: ArcadeTurnRecordingDto;
}

export type ArcadeVerifyResult = { ok: true; score: number } | { ok: false; reason: string };

function invalid(reason: string): ArcadeVerifyResult {
  return { ok: false, reason };
}

function plausibleScore(score: unknown): score is number {
  return (
    typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= ARCADE_SCORE_MAX
  );
}

/**
 * Rechnet eine Partie nach und liefert den errechneten Stand.
 *
 * Wirft nie: Auch ein Fehler in einer Regel-Datei wird zur Ablehnung – eine
 * Einsendung, die sich nicht nachrechnen lässt, zählt nicht.
 */
export function verifyArcadeRun(
  registry: ArcadeRuleRegistry,
  request: ArcadeVerifyRequest,
): ArcadeVerifyResult {
  try {
    return verifyUnsafe(registry, request);
  } catch (error) {
    return invalid(error instanceof Error ? `Regelfehler: ${error.message}` : 'Regelfehler');
  }
}

function verifyUnsafe(
  registry: ArcadeRuleRegistry,
  request: ArcadeVerifyRequest,
): ArcadeVerifyResult {
  const definition = ARCADE_GAME_CATALOG[request.gameId];

  if (definition.engine === 'realtime') {
    const game = registry.realtime(request.gameId);

    if (!game) return invalid('Spielregeln fehlen.');
    if (game.version !== request.gameVersion) return invalid('Andere Fassung der Spielregeln.');
    if (request.replay === undefined) return invalid('Echtzeit-Spiele brauchen ein Band.');

    const bytes = replayFromBase64(request.replay);

    if (bytes === null) return invalid('Band ist kein gültiges Base64.');

    const decoded = decodeArcadeReplay(bytes);

    if (!decoded.ok) return invalid(`Band unlesbar: ${decoded.reason}`);

    const result = runArcadeReplay(game, request.seed, decoded.recording);

    if (!result.finished) return invalid('Partie ist am Ende des Bandes nicht vorbei.');
    if (!plausibleScore(result.score)) return invalid('Errechneter Stand ist unplausibel.');

    return { ok: true, score: result.score };
  }

  const game = registry.turn(request.gameId);

  if (!game) return invalid('Spielregeln fehlen.');
  if (game.version !== request.gameVersion) return invalid('Andere Fassung der Spielregeln.');
  if (request.match === undefined) return invalid('Rundenbasierte Spiele brauchen die Züge.');

  const recording = request.match;
  const seats: SeatController[] = recording.seats;
  const humans = seats.flatMap((seat, index) => (seat.type === 'human' ? [index] : []));

  // Genau ein Mensch, alle übrigen Sitze Computer: Nur so hängt die Partie
  // allein an den eingereichten Zügen und dem Startwert.
  if (humans.length !== 1) return invalid('Genau ein Sitz muss ein Mensch sein.');
  if (seats.length > 1 && !game.bot) return invalid('Dieses Spiel hat keinen Computergegner.');

  const humanSeat = humans[0] as number;
  const options = game.parseOptions(recording.options ?? game.defaultOptions);

  if (options === null) return invalid('Einstellungen sind ungültig.');

  const replayed = replayTurnMatch(game, request.seed, options, seats, recording.moves);

  if (!replayed.ok) return invalid(replayed.reason);

  if (definition.metric === 'wins') {
    if (!replayed.outcome.winners.includes(humanSeat)) {
      return invalid('Nur Siege werden gewertet.');
    }

    return { ok: true, score: 1 };
  }

  const score = replayed.outcome.scores?.[humanSeat];

  if (!plausibleScore(score)) return invalid('Die Partie liefert keinen gültigen Punktestand.');

  return { ok: true, score };
}
