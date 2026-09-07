import { type AccountDto, type SessionDto } from '@palantir/contracts';
import { fetchSession, listSessions } from '@/lib/auth/api';
import { AuthRequestError } from '@/lib/auth/errors';
import { type ApiResult } from './client';

/**
 * Einen werfenden Auth-Aufruf auf den Response-Envelope zurückführen.
 *
 * Die Aufrufe aus F1 werfen `AuthRequestError`; die Ansichten hier arbeiten
 * dagegen durchgängig mit `ApiResult` (`useApiResource` erwartet genau das).
 * Ein Fehler ohne Code ist im Browser entstanden – Netzabbruch oder unlesbare
 * Antwort – und bekommt deshalb den Transport-Code.
 */
function alsErgebnis<T>(promise: Promise<T>): Promise<ApiResult<T>> {
  return promise
    .then((data) => ({ success: true, data, error: null }) as ApiResult<T>)
    .catch((error: unknown) => {
      if (error instanceof AuthRequestError && error.code !== null) {
        return {
          success: false,
          data: null,
          error: { code: error.code, message: error.message },
        } as ApiResult<T>;
      }
      return {
        success: false,
        data: null,
        error: {
          code: 'NETWORK_UNAVAILABLE' as const,
          message: 'Das Backend ist gerade nicht erreichbar.',
        },
      } as ApiResult<T>;
    });
}

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
  return alsErgebnis(fetchSession());
}

/**
 * Die angemeldeten Geräte des eigenen Kontos (Lastenheft §3.1).
 *
 * Eigene Ladefunktion statt eines Feldes im Konto-DTO: Die Liste veraltet
 * schneller als das Konto und wird nur auf dem Profil gebraucht.
 */
export function loadSessions(): Promise<ApiResult<SessionDto[]>> {
  return alsErgebnis(listSessions());
}

/** Basis-Domain der Instanz, unter der Server-Subdomains entstehen (§13). */
export const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? 'example.tld';
