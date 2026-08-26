import { type GlobalPermissions } from '@palantir/contracts';
import { type ApiResult, apiRequest } from './client';

/**
 * Angemeldetes Konto (Pflichtenheft §7, §8).
 *
 * F3 braucht davon zwei Dinge: die eigene Id, um „Deine Server" von „Andere
 * Server" zu trennen, und die instanzweiten Flags, um zu entscheiden, ob
 * „Neuer Server" überhaupt erscheint. Das Konto-DTO selbst gehört zu B1/F1;
 * hier steht nur der Lesezugriff darauf. Auch hier gilt: keine Ableitung aus
 * Rollen im Frontend – ausschließlich die gelieferten Flags.
 */
export interface CurrentUserDto {
  id: string;
  displayName: string;
  isOwner: boolean;
  permissions: GlobalPermissions;
}

export function fetchCurrentUser(signal?: AbortSignal): Promise<ApiResult<CurrentUserDto>> {
  return apiRequest<CurrentUserDto>('/api/me', { signal });
}

/** Basis-Domain der Instanz, unter der Server-Subdomains entstehen (§13). */
export const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? 'example.tld';
