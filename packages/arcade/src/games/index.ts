/**
 * Register aller Spielregeln.
 *
 * Jede Datei `./<kennung>.ts` exportiert `game` – ein `RealtimeGame` oder ein
 * `TurnGame`. Das Backend holt hier die Regeln zum Nachrechnen und für
 * Online-Räume, das Frontend für Partien im Browser.
 */

import { type ArcadeGameId } from '@palantir/contracts';
import { type RealtimeGame } from '../realtime.js';
import { type AnyTurnGame } from '../turn.js';
import { game as kriechpfad } from './kriechpfad.js';
import { game as blockstapel } from './blockstapel.js';
import { game as punktejaeger } from './punktejaeger.js';
import { game as steinbrecher } from './steinbrecher.js';
import { game as ballwechsel } from './ballwechsel.js';
import { game as invaders } from './invaders.js';
import { game as flappy } from './flappy.js';
import { game as zahlen2048 } from './zahlen2048.js';
import { game as minesweeper } from './minesweeper.js';
import { game as simon } from './simon.js';
import { game as solitaer } from './solitaer.js';
import { game as galgenmaennchen } from './galgenmaennchen.js';
import { game as schach } from './schach.js';
import { game as dame } from './dame.js';
import { game as muehle } from './muehle.js';
import { game as vierGewinnt } from './vier-gewinnt.js';
import { game as backgammon } from './backgammon.js';
import { game as menschAergereDichNicht } from './mensch-aergere-dich-nicht.js';
import { game as schiffeVersenken } from './schiffe-versenken.js';
import { game as monopoly } from './monopoly.js';
import { game as risiko } from './risiko.js';
import { game as catan } from './catan.js';
import { game as uno } from './uno.js';
import { game as kniffel } from './kniffel.js';
import { game as codenames } from './codenames.js';
import { game as blackStories } from './black-stories.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zustand je Spiel privat.
export type AnyRealtimeGame = RealtimeGame<any>;

export const REALTIME_GAMES = {
  kriechpfad,
  blockstapel,
  punktejaeger,
  steinbrecher,
  ballwechsel,
  invaders,
  flappy,
  zahlen2048,
  minesweeper,
  simon,
} satisfies Partial<Record<ArcadeGameId, AnyRealtimeGame>> as Partial<
  Record<ArcadeGameId, AnyRealtimeGame>
>;

export const TURN_GAMES = {
  solitaer,
  galgenmaennchen,
  schach,
  dame,
  muehle,
  'vier-gewinnt': vierGewinnt,
  backgammon,
  'mensch-aergere-dich-nicht': menschAergereDichNicht,
  'schiffe-versenken': schiffeVersenken,
  monopoly,
  risiko,
  catan,
  uno,
  kniffel,
  codenames,
  'black-stories': blackStories,
} satisfies Partial<Record<ArcadeGameId, AnyTurnGame>> as Partial<
  Record<ArcadeGameId, AnyTurnGame>
>;

export function getRealtimeGame(id: ArcadeGameId): AnyRealtimeGame | null {
  return REALTIME_GAMES[id] ?? null;
}

export function getTurnGame(id: ArcadeGameId): AnyTurnGame | null {
  return TURN_GAMES[id] ?? null;
}
