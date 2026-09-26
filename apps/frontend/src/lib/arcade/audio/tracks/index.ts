import { type ArcadeGameId } from '@palantir/contracts';
import { type Track } from '../types';
import { track as kriechpfad } from './kriechpfad';
import { track as blockstapel } from './blockstapel';
import { track as punktejaeger } from './punktejaeger';
import { track as steinbrecher } from './steinbrecher';
import { track as ballwechsel } from './ballwechsel';
import { track as invaders } from './invaders';
import { track as flappy } from './flappy';
import { track as zahlen2048 } from './zahlen2048';
import { track as minesweeper } from './minesweeper';
import { track as simon } from './simon';
import { track as solitaer } from './solitaer';
import { track as galgenmaennchen } from './galgenmaennchen';
import { track as schach } from './schach';
import { track as dame } from './dame';
import { track as muehle } from './muehle';
import { track as vierGewinnt } from './vier-gewinnt';
import { track as backgammon } from './backgammon';
import { track as menschAergereDichNicht } from './mensch-aergere-dich-nicht';
import { track as schiffeVersenken } from './schiffe-versenken';
import { track as monopoly } from './monopoly';
import { track as risiko } from './risiko';
import { track as catan } from './catan';
import { track as uno } from './uno';
import { track as kniffel } from './kniffel';
import { track as codenames } from './codenames';
import { track as blackStories } from './black-stories';

/** Eigene Melodie je Spiel (`./<kennung>.ts` exportiert `track`). */
export const ARCADE_TRACKS: Record<ArcadeGameId, Track> = {
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
};
