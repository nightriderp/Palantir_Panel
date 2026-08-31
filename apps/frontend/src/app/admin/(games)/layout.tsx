import { type ReactNode } from 'react';
import { releaseFromEnvironment } from '@/lib/version';
import { DashboardShell } from '@/app/(dashboard)/DashboardShell';

/**
 * Die Spiele-Verwaltung hängt an der Sitzung (`permissions`-Objekt) und wird
 * nie statisch vorgerendert – dieselbe Begründung wie im Admin-Kernbereich.
 */
export const dynamic = 'force-dynamic';

/**
 * Rahmen der Admin-Spiele-Verwaltung (Arbeitspaket F11).
 *
 * Bewusst derselbe Rahmen wie der übrige Admin-Bereich: Das Mockup zeigt
 * Templates, Bilder, Sticker und Arcade-Musik als weitere Einträge in derselben
 * Seitenleiste, nicht als getrennte Oberfläche. `DashboardShell` bringt
 * Seitenleiste (samt Admin-Navigation aus `DashboardNav`), Kopfzeile, Toasts und
 * den Live-Kanal mit – hier nur wiederverwendet, keine zweite Navigation
 * (`components/shared/README.md`).
 */
export default function AdminGamesLayout({ children }: { children: ReactNode }) {
  return <DashboardShell versionLabel={releaseFromEnvironment()}>{children}</DashboardShell>;
}
