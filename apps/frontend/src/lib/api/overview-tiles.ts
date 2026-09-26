import { type OverviewTileDto } from '@palantir/contracts';
import { type CreateOverviewTileInput, type UpdateOverviewTileInput } from '@palantir/validation';
import { type ApiResult, apiRequest } from './client';

/**
 * Übersichts-Kacheln ohne Server (Betreiber-Wunsch 26.09.2026).
 *
 * Lesen darf jedes freigeschaltete Konto; Anlegen, Ändern und Entfernen
 * verlangen `instance.manage`. Was ein Konto mit einer Kachel **tun** darf,
 * steht im `permissions`-Objekt jedes Eintrags.
 */
export function fetchOverviewTiles(signal?: AbortSignal): Promise<ApiResult<OverviewTileDto[]>> {
  return apiRequest<OverviewTileDto[]>('/api/overview-tiles', { signal });
}

export function createOverviewTile(
  input: CreateOverviewTileInput,
): Promise<ApiResult<OverviewTileDto>> {
  return apiRequest<OverviewTileDto>('/api/admin/overview-tiles', { method: 'POST', json: input });
}

export function updateOverviewTile(
  tileId: string,
  input: UpdateOverviewTileInput,
): Promise<ApiResult<OverviewTileDto>> {
  return apiRequest<OverviewTileDto>(`/api/admin/overview-tiles/${encodeURIComponent(tileId)}`, {
    method: 'PATCH',
    json: input,
  });
}

export function deleteOverviewTile(tileId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/api/admin/overview-tiles/${encodeURIComponent(tileId)}`, {
    method: 'DELETE',
  });
}
