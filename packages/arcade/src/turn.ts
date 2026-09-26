/**
 * Rundenbasierte Spiele der Spielhalle (Schach, UNO, Catan, Codenames …).
 *
 * Eine Regel-Datei beschreibt ein Spiel vollständig, und **dieselbe** Datei
 * läuft an drei Stellen:
 *
 *   - im Browser für Partien am selben Gerät und gegen den Computer,
 *   - im Backend für Online-Räume (der Server ist die einzige Instanz, die
 *     Züge anwendet – der Browser schlägt nur vor),
 *   - im Backend beim Nachrechnen einer Partie gegen den Computer, bevor ein
 *     Sieg in die Bestenliste darf.
 *
 * Daraus folgen dieselben Regeln wie bei den Echtzeit-Spielen:
 *
 *   1. Deterministisch. Zufall nur aus `rng.ts`, Generatorzustand im Zustand.
 *   2. Zustand ist **reines JSON** (keine Klassen, Maps, Sets, `undefined` in
 *      Arrays) – er liegt in einer `jsonb`-Spalte.
 *   3. `applyMove` verändert den übergebenen Zustand nicht, sondern gibt einen
 *      neuen zurück. Der Browser-Zustand hängt an React, und das Backend
 *      vergleicht Fassungen.
 *   4. `parseMove` ist die Stelle, an der **fremde Daten** ankommen (Netz).
 *      Sie prüft Form, Wertebereiche und Textlängen und liefert sonst `null`.
 *   5. Verdeckte Information (Handkarten, Codenames-Schlüssel, Black-Stories-
 *      Lösung) verlässt den Server nur über `view(state, seat)`.
 */

import { type ArcadeGameId } from '@palantir/contracts';
import { type RngState, createRng, deriveSeed } from './rng.js';

/** Schwierigkeitsstufen des Computergegners. */
export type BotLevel = 'leicht' | 'mittel' | 'schwer';

export const BOT_LEVELS: readonly BotLevel[] = ['leicht', 'mittel', 'schwer'];

/** Ergebnis einer beendeten Partie. */
export interface TurnOutcome {
  /**
   * Sitze der Gewinner. Mehrere bei Teamspielen (Codenames) oder Gleichstand,
   * leer bei einem Remis ohne Sieger.
   */
  winners: number[];
  /** Ein Satz fürs Ergebnis-Fenster, z. B. „Schachmatt – Weiß gewinnt.". */
  summary: string;
  /** Optionale Punkte je Sitz (Kniffel, Monopoly-Vermögen …). */
  scores?: number[];
}

export type MoveResult<S> = { ok: true; state: S } | { ok: false; error: string };

/** Eine Zeile im Spielverlauf, den die Oberfläche einblendet. */
export interface TurnLogEntry {
  /** Sitz, der den Eintrag ausgelöst hat; `null` = Spiel selbst. */
  seat: number | null;
  text: string;
}

/** Rahmendaten beim Aufbau einer Partie. */
export interface SetupContext<O> {
  /** Anzahl Sitze (inklusive Computergegner). */
  players: number;
  seed: number;
  options: O;
}

/**
 * Regeln eines rundenbasierten Spiels.
 *
 * `S` Zustand (JSON), `M` Zug (JSON), `O` Einstellungen (JSON), `V` Sicht
 * eines Sitzes (JSON; was die Oberfläche zeichnet).
 */
export interface TurnGame<S, M, O = Record<string, never>, V = unknown> {
  readonly kind: 'turn';
  readonly id: ArcadeGameId;
  /** Fassung der Regeln – hochzählen bei Verhaltensänderungen (Nachrechnen). */
  readonly version: number;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly defaultOptions: O;
  /** Einstellungen aus fremden Daten prüfen und mit Vorgaben auffüllen; `null` bei Unfug. */
  parseOptions(raw: unknown): O | null;

  /**
   * Gibt es verdeckte Information? Dann zeigt die Oberfläche am selben Gerät
   * zwischen zwei Sitzen einen Vorhang („Gib das Gerät an …").
   */
  readonly hiddenInformation: boolean;

  setup(ctx: SetupContext<O>): S;

  /**
   * Sitze, die **jetzt** ziehen dürfen. Meist genau einer; mehrere, wenn
   * gleichzeitig gezogen wird (Schiffe setzen, Codenames-Team, Abstimmung).
   * Leer, wenn die Partie vorbei ist.
   */
  activeSeats(state: S): number[];

  /** Fremde Daten in einen Zug übersetzen; `null`, wenn die Form nicht stimmt. */
  parseMove(raw: unknown): M | null;

  /**
   * Zug anwenden. Prüft Legalität (Sitz am Zug, Regel erlaubt es) und gibt
   * sonst eine deutsche Fehlermeldung zurück. Verändert `state` nicht.
   */
  applyMove(state: S, seat: number, move: M): MoveResult<S>;

  /** Ergebnis, sobald die Partie vorbei ist; sonst `null`. */
  outcome(state: S): TurnOutcome | null;

  /**
   * Sicht eines Sitzes; `null` = Zuschauer. Verdeckte Information anderer
   * Sitze darf hier **nicht** enthalten sein. Online bekommt jeder Browser nur
   * seine Sicht; am selben Gerät zeigt die Oberfläche die Sicht des Sitzes,
   * der gerade dran ist.
   */
  view(state: S, seat: number | null): V;

  /** Letzte Einträge des Spielverlaufs (höchstens ~50). */
  log(state: S): TurnLogEntry[];

  /**
   * Computergegner. Fehlt er, lässt sich das Spiel nur mit Menschen spielen
   * (Black Stories, Codenames brauchen Sprache).
   *
   * Muss deterministisch sein: gleicher Zustand, gleiche Stufe, gleicher
   * `rng`-Zustand ⇒ gleicher Zug. Er bekommt den **vollen** Zustand, darf
   * aber fair spielen und nur nutzen, was sein Sitz sehen könnte.
   *
   * Muss einen legalen Zug liefern, solange `seat` in `activeSeats` steht.
   */
  bot?(state: S, seat: number, level: BotLevel, rng: RngState): M;
}

/** Irgendein rundenbasiertes Spiel – für Register und Wirte. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zustand, Zug, Optionen und Sicht sind je Spiel privat; Register und Wirte behandeln sie undurchsichtig.
export type AnyTurnGame = TurnGame<any, any, any, any>;

// ---------------------------------------------------------------------------
// Partie: Regeln + Sitzbelegung + Zugzähler
// ---------------------------------------------------------------------------

/** Wer auf einem Sitz spielt – für die Regeln nur „Mensch" oder „Bot mit Stufe". */
export type SeatController = { type: 'human' } | { type: 'bot'; level: BotLevel };

/** Eine laufende Partie – das, was ein Online-Raum als JSON ablegt. */
export interface TurnMatch<S = unknown, O = unknown> {
  gameId: ArcadeGameId;
  version: number;
  seed: number;
  options: O;
  seats: SeatController[];
  state: S;
  /** Anzahl angewandter Züge – Grundlage für den Zufall der Bots. */
  moveCount: number;
}

/** Ein aufgezeichneter Zug eines Menschen (für das Nachrechnen). */
export interface RecordedMove {
  seat: number;
  move: unknown;
}

/** Neue Partie. Wirft, wenn die Sitzzahl nicht zu den Regeln passt. */
export function createMatch<S, O>(
  game: TurnGame<S, unknown, O, unknown>,
  seed: number,
  options: O,
  seats: SeatController[],
): TurnMatch<S, O> {
  if (seats.length < game.minPlayers || seats.length > game.maxPlayers) {
    throw new Error(
      `${game.id}: ${seats.length} Sitze, erlaubt sind ${game.minPlayers}–${game.maxPlayers}.`,
    );
  }
  return {
    gameId: game.id,
    version: game.version,
    seed: seed >>> 0,
    options,
    seats,
    state: game.setup({ players: seats.length, seed: seed >>> 0, options }),
    moveCount: 0,
  };
}

/** Zug eines Sitzes aus fremden Daten anwenden (Online-Raum, Nachrechnen). */
export function applyRawMove<S, O>(
  game: TurnGame<S, unknown, O, unknown>,
  match: TurnMatch<S, O>,
  seat: number,
  raw: unknown,
): MoveResult<TurnMatch<S, O>> {
  if (game.outcome(match.state)) return { ok: false, error: 'Die Partie ist bereits vorbei.' };
  if (!game.activeSeats(match.state).includes(seat)) {
    return { ok: false, error: 'Du bist gerade nicht am Zug.' };
  }
  const move = game.parseMove(raw);
  if (move === null) return { ok: false, error: 'Dieser Zug ist nicht lesbar.' };
  const result = game.applyMove(match.state, seat, move);
  if (!result.ok) return result;
  return { ok: true, state: { ...match, state: result.state, moveCount: match.moveCount + 1 } };
}

/** Zufall eines Bots für den nächsten Zug – hängt an Startwert, Zugnummer und Sitz. */
export function botRng(match: TurnMatch, seat: number): RngState {
  return createRng(deriveSeed(match.seed, match.moveCount, seat, 0xb07));
}

/**
 * Nächster aktiver Sitz, der ein Bot ist; `null`, wenn gerade kein Bot zieht.
 * Bei mehreren aktiven Sitzen zieht der niedrigste Bot zuerst.
 */
export function nextBotSeat<S>(
  game: TurnGame<S, unknown, unknown, unknown>,
  match: TurnMatch<S>,
): number | null {
  if (game.outcome(match.state)) return null;
  for (const seat of game.activeSeats(match.state)) {
    if (match.seats[seat]?.type === 'bot') return seat;
  }
  return null;
}

/**
 * Einen einzelnen Bot-Zug ausführen, falls ein Bot dran ist.
 *
 * Gibt `null` zurück, wenn kein Bot zieht. Wirft, wenn der Bot einen illegalen
 * Zug liefert – das ist ein Fehler in den Regeln und soll laut werden.
 */
export function stepBot<S, O>(
  game: TurnGame<S, unknown, O, unknown>,
  match: TurnMatch<S, O>,
): TurnMatch<S, O> | null {
  const seat = nextBotSeat(game, match as TurnMatch<S>);
  if (seat === null || !game.bot) return null;
  const controller = match.seats[seat];
  if (controller?.type !== 'bot') return null;
  const move = game.bot(match.state, seat, controller.level, botRng(match as TurnMatch, seat));
  const result = game.applyMove(match.state, seat, move);
  if (!result.ok) {
    throw new Error(
      `${game.id}: Bot auf Sitz ${seat} lieferte einen illegalen Zug (${result.error}).`,
    );
  }
  return { ...match, state: result.state, moveCount: match.moveCount + 1 };
}

/**
 * Obergrenze für Bot-Züge am Stück – schützt vor Endlosschleifen in den Regeln.
 *
 * Großzügig, weil ein Mensch früh ausscheiden kann: Eine Risiko-Partie mit
 * sechs Bots braucht danach allein über 2.000 Züge bis zum Ende. Die Grenze
 * soll Regelfehler fangen, nicht lange Partien.
 */
export const MAX_BOT_CHAIN = 20_000;

/** Alle anstehenden Bot-Züge ausführen, bis ein Mensch dran oder die Partie vorbei ist. */
export function runBots<S, O>(
  game: TurnGame<S, unknown, O, unknown>,
  match: TurnMatch<S, O>,
): TurnMatch<S, O> {
  let current = match;
  for (let i = 0; i < MAX_BOT_CHAIN; i += 1) {
    const next = stepBot(game, current);
    if (next === null) return current;
    current = next;
  }
  throw new Error(`${game.id}: mehr als ${MAX_BOT_CHAIN} Bot-Züge am Stück.`);
}

/** Obergrenze aufgezeichneter Züge beim Nachrechnen. */
export const MAX_RECORDED_MOVES = 5_000;

export type TurnReplayResult<S> =
  { ok: true; match: TurnMatch<S>; outcome: TurnOutcome } | { ok: false; reason: string };

/**
 * Rechnet eine Partie gegen den Computer nach.
 *
 * Die Aufzeichnung enthält nur die Züge der Menschen; die Bot-Züge rechnet das
 * Backend selbst, sie hängen ausschließlich an Startwert und Zustand. Stimmt
 * ein Zug nicht (falscher Sitz, illegal) oder endet die Partie nicht, ist das
 * Band ungültig.
 */
export function replayTurnMatch<S, O>(
  game: TurnGame<S, unknown, O, unknown>,
  seed: number,
  options: O,
  seats: SeatController[],
  moves: readonly RecordedMove[],
): TurnReplayResult<S> {
  if (moves.length > MAX_RECORDED_MOVES) return { ok: false, reason: 'zu viele Züge' };
  let match: TurnMatch<S, O>;
  try {
    match = createMatch(game, seed, options, seats);
    match = runBots(game, match);
    for (const [index, recorded] of moves.entries()) {
      if (seats[recorded.seat]?.type !== 'human') {
        return { ok: false, reason: `Zug ${index}: Sitz ${recorded.seat} ist kein Mensch` };
      }
      const result = applyRawMove(game, match, recorded.seat, recorded.move);
      if (!result.ok) return { ok: false, reason: `Zug ${index}: ${result.error}` };
      match = runBots(game, result.state);
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Regelfehler' };
  }
  const outcome = game.outcome(match.state);
  if (!outcome) return { ok: false, reason: 'Partie nicht beendet' };
  return { ok: true, match: match as TurnMatch<S>, outcome };
}

// ---------------------------------------------------------------------------
// Hilfen für Regel-Dateien
// ---------------------------------------------------------------------------

/** Tiefe Kopie eines JSON-Zustands – für Regeln, die bequem in-place rechnen wollen. */
export function cloneState<S>(state: S): S {
  return structuredClone(state);
}

/** Ist `value` ein einfaches Objekt (für `parseMove`/`parseOptions`)? */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Ganzzahl in [min, max] oder `null`. */
export function intIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

/** Getrimmter Text mit 1 … maxLength Zeichen oder `null`. */
export function textUpTo(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

/** Hängt einen Log-Eintrag an und kürzt auf die letzten `limit` Einträge. */
export function pushLog(log: TurnLogEntry[], entry: TurnLogEntry, limit = 60): TurnLogEntry[] {
  const next = [...log, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}
