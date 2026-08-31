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
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell versionLabel={releaseFromEnvironment()}>{children}</DashboardShell>;
}
