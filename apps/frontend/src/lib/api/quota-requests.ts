import { type QuotaRequestDto } from '@palantir/contracts';
import { type CreateQuotaRequestInput } from '@palantir/validation';
import { type ApiResult, apiRequest } from './client';

/**
 * Eigene Kontingent-Anfragen (Mockup-Abgleich 12.3.1).
 *
 * Getrennt von `lib/api/admin.ts`: Das hier ruft jedes angemeldete Konto, die
 * Admin-Aufrufe daneben verlangen `user.manage`.
 */

export function fetchOwnQuotaRequests(signal?: AbortSignal): Promise<ApiResult<QuotaRequestDto[]>> {
  return apiRequest<QuotaRequestDto[]>('/quota-requests/mine', { signal });
}

export function createQuotaRequest(
  input: CreateQuotaRequestInput,
): Promise<ApiResult<QuotaRequestDto>> {
  return apiRequest<QuotaRequestDto>('/quota-requests', { method: 'POST', json: input });
}

/** Eigenen offenen Antrag zurückziehen. */
export function withdrawQuotaRequest(id: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/quota-requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
