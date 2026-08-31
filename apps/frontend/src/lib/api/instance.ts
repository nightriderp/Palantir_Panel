import { type PublicInstanceStatsDto } from '@palantir/contracts';
import { type ApiResult, apiRequest } from './client';

/**
 * Kennzahlen der Instanz für die Anmeldeseite (Mockup-Abgleich 2.1).
 *
 * Die einzige Ansicht, die diese Route ruft, ist die Anmeldung – **vor** der
 * Sitzung. Ein Fehlschlag ist deshalb kein Fall für eine Fehlermeldung: Die
 * Seite zeigt dann schlicht keine Zahlen, das Formular funktioniert weiter.
 */
export function fetchPublicStats(signal?: AbortSignal): Promise<ApiResult<PublicInstanceStatsDto>> {
  return apiRequest<PublicInstanceStatsDto>('/public/stats', { signal });
}
