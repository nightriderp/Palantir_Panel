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
export const ARCADE_GAME_REGISTRY: Partial<Record<ArcadeGameId, ArcadeGame<any>>> = {
  kriechpfad,
  ballwechsel,
  steinbrecher,
  blockstapel,
  punktejaeger,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- siehe oben.
export function getArcadeGame(id: ArcadeGameId): ArcadeGame<any> {
  const game = ARCADE_GAME_REGISTRY[id];
  if (!game) throw new Error(`Kein Spiel für ${id}.`);
  return game;
}

/**
 * Übergang (Contracts-PR Spielhalle, 26.09.2026): Der Katalog kennt schon alle
 * 26 Spiele, diese Oberfläche nur die ersten fünf. Die Auswahlseite zeigt bis
 * zum Spielhallen-PR nur, was hier spielbar ist.
 */
export function isPlayableHere(id: ArcadeGameId): boolean {
  return id in ARCADE_GAME_REGISTRY;
}
