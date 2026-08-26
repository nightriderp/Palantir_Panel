import { type AccountDto } from '@palantir/contracts';
import { fetchSession } from '@/lib/auth/api';
import { AuthRequestError } from '@/lib/auth/errors';
import { type ApiResult } from './client';

/**
 * Das angemeldete Konto für die Ansichten dieses Arbeitspakets.
 *
 * Geladen wird es über `fetchSession()` aus F1 – es gibt genau einen Weg zur
 * Sitzung, keine zweite Variante. F3 braucht daraus die eigene Id (Trennung
 * „Deine Server" / „Andere Server") und die instanzweiten Flags aus
 * `permissions` (Pflichtenheft §5.2).
 *
 * Die Auth-Aufrufe von F1 werfen bei Fehlern; hier wird das auf denselben
 * Envelope zurückgeführt, mit dem alle anderen Aufrufe in F3 arbeiten.
 */
export function loadAccount(): Promise<ApiResult<AccountDto>> {
  return fetchSession()
    .then((account) => ({ success: true, data: account, error: null }) as ApiResult<AccountDto>)
    .catch((error: unknown) => {
      if (error instanceof AuthRequestError && error.code !== null) {
        return {
          success: false,
          data: null,
          error: { code: error.code, message: error.message },
        } as ApiResult<AccountDto>;
      }
      return {
        success: false,
        data: null,
        error: {
          code: 'NETWORK_UNAVAILABLE' as const,
          message: 'Das Backend ist gerade nicht erreichbar.',
        },
      } as ApiResult<AccountDto>;
    });
}

/** Basis-Domain der Instanz, unter der Server-Subdomains entstehen (§13). */
export const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? 'example.tld';
