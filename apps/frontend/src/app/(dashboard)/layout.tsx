import { type ReactNode } from 'react';
import { releaseFromEnvironment } from '@/lib/version';
import { DashboardShell } from './DashboardShell';

/**
 * Layout des eingeloggten Bereichs.
 *
 * Hält sich absichtlich heraus und reicht nur an `DashboardShell` weiter – der
 * Rahmen selbst braucht Zustand (Seitenleiste, Toasts, Live-Kanal) und läuft
 * deshalb im Browser.
 *
 * Eine Sache erledigt das Layout selbst: die Version des laufenden Deployments
 * aus der Umgebung lesen. Das geht nur hier, auf der Server-Seite – im Browser
 * ist `process.env` leer, und zur Bauzeit ist das Versions-Tag noch nicht
 * vergeben (siehe `lib/version.ts`).
 */
/**
 * Kein Vorrendern zur Bauzeit.
 *
 * Die Version des Deployments steht erst zur Laufzeit in der Umgebung
 * (`PALANTIR_RELEASE`, gesetzt von `deploy/vps/deploy.sh`). Ohne diese Zeile
 * rendert Next die Seiten dieses Bereichs beim **Bauen** vor – dort ist die
 * Variable leer, und im Image landete dauerhaft „Entwicklung".
 *
 * Der Bereich verliert dadurch nichts: Er steht hinter der Anmeldung und holt
 * seine Daten ohnehin erst im Browser; vorgerendert war hier nur ein leerer
 * Rahmen.
 */
export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell versionLabel={releaseFromEnvironment()}>{children}</DashboardShell>;
}
