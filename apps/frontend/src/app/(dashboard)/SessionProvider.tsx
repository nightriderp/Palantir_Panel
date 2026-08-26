'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { type AccountDto } from '@palantir/contracts';
import { useApiResource } from '@/lib/api/useApiResource';
import { loadAccount } from '@/lib/api/session';

/**
 * Das angemeldete Konto, einmal für den gesamten eingeloggten Bereich geladen.
 *
 * F3 braucht daraus die eigene Id (Trennung „Deine Server" / „Andere Server")
 * und die instanzweiten Flags. Anmeldung, Abmeldung und Sitzungsverwaltung
 * gehören zu F1/B1 – hier wird nur gelesen.
 *
 * Ist das Konto (noch) nicht ladbar, bleibt `user` schlicht `null`: die
 * Ansichten kommen damit zurecht und zeigen nur weniger. Ein Umleiten auf die
 * Anmeldung gehört zu F1 und wird hier bewusst nicht vorweggenommen.
 */

export interface SessionValue {
  user: AccountDto | null;
  loading: boolean;
}

const SessionContext = createContext<SessionValue>({ user: null, loading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, loading } = useApiResource<AccountDto>(() => loadAccount(), []);

  return (
    <SessionContext.Provider value={{ user: data, loading }}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
