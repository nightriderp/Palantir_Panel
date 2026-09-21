import {
  type AchievementId,
  type AchievementOverviewDto,
  type AchievementTitleChangeDto,
} from '@palantir/contracts';
import { type ApiResult, apiRequest } from '@/lib/api/client';

/**
 * REST-Endpunkte der Erfolge (Betreiber-Wunsch 21.09.2026).
 *
 * Beide Aufrufe beziehen sich immer auf das **eigene** Konto – die Konto-Id
 * kommt aus der Sitzung, nicht aus der Anfrage. Ergebnis ist der
 * Response-Envelope aus Pflichtenheft §5.1; hier wird nichts ausgepackt und
 * nichts geworfen.
 */

/** Abzeichen, Stufe und Titel des angemeldeten Kontos laden. */
export function fetchAchievements(
  signal?: AbortSignal,
): Promise<ApiResult<AchievementOverviewDto>> {
  return apiRequest<AchievementOverviewDto>('/achievements', { signal });
}

/**
 * Den getragenen Titel wählen; `null` legt ihn ab.
 *
 * Antwortet mit der vollständigen, aktualisierten Übersicht – die Seite muss
 * nach dem Wechsel nicht erneut laden.
 */
export function chooseAchievementTitle(
  achievementId: AchievementId | null,
): Promise<ApiResult<AchievementTitleChangeDto>> {
  return apiRequest<AchievementTitleChangeDto>('/achievements/title', {
    method: 'PUT',
    json: { achievementId },
  });
}
