'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
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
  /**
   * Das Konto im Rahmen ersetzen, wenn eine Ansicht es geaendert hat.
   *
   * Ohne das bliebe etwa der Anzeigename im Nutzermenue auf dem alten Stand,
   * bis die Seite neu geladen wird – geaendert wird er auf dem Profil, das
   * seine eigene Kopie haelt.
   */
  setUser: (account: AccountDto) => void;
}

const SessionContext = createContext<SessionValue>({
  user: null,
  loading: true,
  setUser: () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, loading, setData } = useApiResource<AccountDto>(() => loadAccount(), []);

  const value = useMemo<SessionValue>(
    () => ({ user: data, loading, setUser: setData }),
    [data, loading, setData],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
