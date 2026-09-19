import { type GameRequestDto } from '@palantir/contracts';
import { type CreateGameRequestInput } from '@palantir/validation';
import { type ApiResult, apiRequest } from './client';

/**
 * Eigene Spiel-Wünsche (Betreiber, 19.09.2026).
 *
 * Getrennt von `lib/api/admin.ts`, wie bei den Kontingent-Anfragen: Das hier
 * ruft jedes freigeschaltete Konto, die Bescheide daneben verlangen
 * `user.manage`.
 */

export function fetchOwnGameRequests(signal?: AbortSignal): Promise<ApiResult<GameRequestDto[]>> {
  return apiRequest<GameRequestDto[]>('/game-requests/mine', { signal });
}

export function createGameRequest(
  input: CreateGameRequestInput,
): Promise<ApiResult<GameRequestDto>> {
  return apiRequest<GameRequestDto>('/game-requests', { method: 'POST', json: input });
}

/** Eigenen offenen Wunsch zurückziehen. */
export function withdrawGameRequest(id: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/game-requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
