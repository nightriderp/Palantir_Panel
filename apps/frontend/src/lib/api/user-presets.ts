import { type UserPresetDto } from '@palantir/contracts';
import { type CreateUserPresetInput, type UpdateUserPresetInput } from '@palantir/validation';
import { type ApiResult, apiRequest } from './client';

/**
 * Eigene Profile der Steuerung (Idee P / A2, 26.09.2026). Jedes Konto sieht
 * nur seine eigenen.
 */

export function fetchUserPresets(
  gameType: string,
  signal?: AbortSignal,
): Promise<ApiResult<UserPresetDto[]>> {
  return apiRequest<UserPresetDto[]>(`/user-presets?gameType=${encodeURIComponent(gameType)}`, {
    signal,
  });
}

export function createUserPreset(input: CreateUserPresetInput): Promise<ApiResult<UserPresetDto>> {
  return apiRequest<UserPresetDto>('/user-presets', { method: 'POST', json: input });
}

export function updateUserPreset(
  id: string,
  input: UpdateUserPresetInput,
): Promise<ApiResult<UserPresetDto>> {
  return apiRequest<UserPresetDto>(`/user-presets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    json: input,
  });
}

export function deleteUserPreset(id: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/user-presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
