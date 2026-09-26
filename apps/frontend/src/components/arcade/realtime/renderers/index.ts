import { type ArcadeGameId } from '@palantir/contracts';
import { type AnyRealtimeRenderer } from '../types';
import { renderer as kriechpfad } from './kriechpfad';
import { renderer as blockstapel } from './blockstapel';
import { renderer as punktejaeger } from './punktejaeger';
import { renderer as steinbrecher } from './steinbrecher';
import { renderer as ballwechsel } from './ballwechsel';
import { renderer as invaders } from './invaders';
import { renderer as flappy } from './flappy';
import { renderer as zahlen2048 } from './zahlen2048';
import { renderer as minesweeper } from './minesweeper';
import { renderer as simon } from './simon';

/** Zeichenschichten aller Echtzeit-Spiele (`./<kennung>.ts` exportiert `renderer`). */
export const REALTIME_RENDERERS: Partial<Record<ArcadeGameId, AnyRealtimeRenderer>> = {
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
};

export function getRealtimeRenderer(id: ArcadeGameId): AnyRealtimeRenderer | null {
  return REALTIME_RENDERERS[id] ?? null;
}
