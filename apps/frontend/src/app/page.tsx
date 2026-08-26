'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { fetchSession } from '@/lib/auth/api';
import { AUTH_ROUTES, landingPathForAccount } from '@/lib/auth/routes';

/**
 * Startseite `/`.
 *
 * Sie zeigt selbst nichts, sondern leitet weiter: bei bestehender Sitzung
 * dorthin, wo das Konto hingehört (`landingPathForAccount()` aus F1 – also
 * Serverübersicht, Wartebildschirm oder Anmeldung), sonst zur Anmeldung.
 *
 * Erledigt „Gefundener Punkt" 31: die Seite lag bisher als Platzhaltertext des
 * Grundgerüsts herum und gehörte weder F1 noch F3 allein.
 */
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    void fetchSession()
      .then((account) => {
        if (!cancelled) router.replace(landingPathForAccount(account));
      })
      .catch(() => {
        // Keine gültige Sitzung (oder Backend nicht erreichbar): zur Anmeldung.
        if (!cancelled) router.replace(AUTH_ROUTES.login);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-base text-ink-muted">Palantir wird geladen …</p>
    </main>
  );
}
