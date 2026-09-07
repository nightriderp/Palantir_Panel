'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PageHeader } from '@/components/shared';
import { ADMIN_ENTRIES, visibleEntries } from '@/app/(dashboard)/DashboardNav';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { AdminAccessNotice, AdminLoading } from './common';

/**
 * Einstieg `/admin` (Arbeitspaket F10).
 *
 * Zeigt selbst nichts, sondern leitet zum ersten Bereich weiter, für den das
 * Konto eine Berechtigung hat. Welche Bereiche in Frage kommen, entscheidet
 * allein das `permissions`-Objekt (Pflichtenheft §5.2). Hat das Konto für
 * keinen Bereich eine Berechtigung, bleibt der Zugriffshinweis stehen.
 *
 * **Eine Quelle mit der Seitenleiste** (Fundpunkt frontend-app-04): Bereiche
 * und Reihenfolge kommen aus `ADMIN_ENTRIES` in `DashboardNav`, gefiltert mit
 * derselben Funktion `visibleEntries`. Vorher stand hier eine zweite Liste von
 * Hand, in der `canManageNodes` und `canManageGameTypes` fehlten: Ein Konto mit
 * nur einem dieser beiden Rechte sah in der Seitenleiste „Nodes" bzw.
 * „Templates", bekam auf `/admin` aber „Kein Zugriff auf den Admin-Bereich".
 */

export function AdminLanding() {
  const router = useRouter();
  const { user, loading } = useSession();

  // Einträge ohne `href` sind noch nicht gebaut und taugen nicht als Sprungziel.
  const target = visibleEntries(ADMIN_ENTRIES, user).find(
    (entry) => entry.href !== undefined,
  )?.href;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (loading) {
    return <AdminLoading label="Administration wird geöffnet …" />;
  }

  if (!target) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Administration" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="den Admin-Bereich" />
      </div>
    );
  }

  return <AdminLoading label="Administration wird geöffnet …" />;
}
