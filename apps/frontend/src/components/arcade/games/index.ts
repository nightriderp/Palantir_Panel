import { type ArcadeGameId } from '@palantir/contracts';
import { type ArcadeGame } from '../engine/types';
import { ballwechsel } from './ballwechsel';
import { blockstapel } from './blockstapel';
import { kriechpfad } from './kriechpfad';
import { punktejaeger } from './punktejaeger';
import { steinbrecher } from './steinbrecher';

/**
 * Registry der eigenständigen Minispiele (Arbeitspaket F8).
 *
 * Genau ein Spiel je `ArcadeGameId` aus dem Contract-Katalog. Ein neues Spiel
 * ergänzt man hier und im Katalog `ARCADE_GAME_CATALOG` – der Rest (Auswahlseite,
 * Bestenliste) zieht automatisch nach (Lastenheft §4 „Erweiterbarkeit").
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Registry hält Spiele mit unterschiedlichem Zustandstyp; die Typsicherheit je Spiel liegt in dessen Modul.
export const ARCADE_GAME_REGISTRY: Record<ArcadeGameId, ArcadeGame<any>> = {
  kriechpfad,
  ballwechsel,
  steinbrecher,
  blockstapel,
  punktejaeger,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- siehe oben.
export function getArcadeGame(id: ArcadeGameId): ArcadeGame<any> {
  return ARCADE_GAME_REGISTRY[id];
}
