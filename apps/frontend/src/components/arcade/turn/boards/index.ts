import { type ArcadeGameId } from '@palantir/contracts';
import { TURN_GAMES } from '@palantir/arcade';
import { lazy } from 'react';
import { type TurnBoardDefinition } from '../types';
import { meta as solitaerMeta } from './solitaer/meta';
import { meta as galgenmaennchenMeta } from './galgenmaennchen/meta';
import { meta as schachMeta } from './schach/meta';
import { meta as dameMeta } from './dame/meta';
import { meta as muehleMeta } from './muehle/meta';
import { meta as vierGewinntMeta } from './vier-gewinnt/meta';
import { meta as backgammonMeta } from './backgammon/meta';
import { meta as menschAergereDichNichtMeta } from './mensch-aergere-dich-nicht/meta';
import { meta as schiffeVersenkenMeta } from './schiffe-versenken/meta';
import { meta as monopolyMeta } from './monopoly/meta';
import { meta as risikoMeta } from './risiko/meta';
import { meta as catanMeta } from './catan/meta';
import { meta as unoMeta } from './uno/meta';
import { meta as kniffelMeta } from './kniffel/meta';
import { meta as codenamesMeta } from './codenames/meta';
import { meta as blackStoriesMeta } from './black-stories/meta';

/**
 * Oberflächen aller rundenbasierten Spiele.
 *
 * Je Spiel ein Ordner `./<kennung>/` mit `Board.tsx` (exportiert `Board`, lazy
 * geladen – Catan und Monopoly sollen die Auswahlseite nicht schwer machen) und
 * `meta.ts(x)` (exportiert `meta` mit Anleitung und optionaler
 * Einstellungs-Oberfläche).
 */
function board(
  id: ArcadeGameId,
  load: () => Promise<{ Board: TurnBoardDefinition['Board'] }>,
  meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'>,
): TurnBoardDefinition {
  const rules = TURN_GAMES[id];
  if (!rules) throw new Error(`Keine Regeln für ${id}.`);
  return { id, rules, Board: lazy(() => load().then((m) => ({ default: m.Board }))), ...meta };
}

export const TURN_BOARDS: Partial<Record<ArcadeGameId, TurnBoardDefinition>> = {
  solitaer: board('solitaer', () => import('./solitaer/Board'), solitaerMeta),
  galgenmaennchen: board(
    'galgenmaennchen',
    () => import('./galgenmaennchen/Board'),
    galgenmaennchenMeta,
  ),
  schach: board('schach', () => import('./schach/Board'), schachMeta),
  dame: board('dame', () => import('./dame/Board'), dameMeta),
  muehle: board('muehle', () => import('./muehle/Board'), muehleMeta),
  'vier-gewinnt': board('vier-gewinnt', () => import('./vier-gewinnt/Board'), vierGewinntMeta),
  backgammon: board('backgammon', () => import('./backgammon/Board'), backgammonMeta),
  'mensch-aergere-dich-nicht': board(
    'mensch-aergere-dich-nicht',
    () => import('./mensch-aergere-dich-nicht/Board'),
    menschAergereDichNichtMeta,
  ),
  'schiffe-versenken': board(
    'schiffe-versenken',
    () => import('./schiffe-versenken/Board'),
    schiffeVersenkenMeta,
  ),
  monopoly: board('monopoly', () => import('./monopoly/Board'), monopolyMeta),
  risiko: board('risiko', () => import('./risiko/Board'), risikoMeta),
  catan: board('catan', () => import('./catan/Board'), catanMeta),
  uno: board('uno', () => import('./uno/Board'), unoMeta),
  kniffel: board('kniffel', () => import('./kniffel/Board'), kniffelMeta),
  codenames: board('codenames', () => import('./codenames/Board'), codenamesMeta),
  'black-stories': board('black-stories', () => import('./black-stories/Board'), blackStoriesMeta),
};

export function getTurnBoard(id: ArcadeGameId): TurnBoardDefinition | null {
  return TURN_BOARDS[id] ?? null;
}
