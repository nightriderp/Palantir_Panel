import {
  type ArcadeGameId,
  type ArcadeLeaderboardDto,
  type ArcadeSubmitResultDto,
} from '@palantir/contracts';
import { type ApiResult, apiRequest } from '@/lib/api/client';

/**
 * REST-Endpunkte des Arcade-Bereichs (Arbeitspaket F8, Pflichtenheft §17).
 *
 * Die Minispiele laufen vollständig im Browser; hierüber wird nur der
 * erreichte Punktestand abgeschickt und die nutzerbezogene Bestenliste je Spiel
 * geladen (Lastenheft §3.9). Ergebnis ist immer der Response-Envelope aus
 * Pflichtenheft §5.1 – hier wird nichts ausgepackt und nichts geworfen.
 */

/** Bestenliste eines Spiels laden. */
export function fetchArcadeLeaderboard(
  gameId: ArcadeGameId,
  signal?: AbortSignal,
): Promise<ApiResult<ArcadeLeaderboardDto>> {
  return apiRequest<ArcadeLeaderboardDto>(`/arcade/leaderboard/${gameId}`, { signal });
}

/**
 * Einen erreichten Punktestand abschicken.
 *
 * Das Backend ist die Instanz, die den Score speichert – eine Bestenliste
 * ausschließlich im Browser genügt der Anforderung nicht (Lastenheft §3.9).
 */
export function submitArcadeScore(
  gameId: ArcadeGameId,
  score: number,
): Promise<ApiResult<ArcadeSubmitResultDto>> {
  return apiRequest<ArcadeSubmitResultDto>('/arcade/scores', {
    method: 'POST',
    json: { gameId, score },
  });
}
