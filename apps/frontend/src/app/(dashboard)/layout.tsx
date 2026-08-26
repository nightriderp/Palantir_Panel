import { type ReactNode } from 'react';
import { DashboardShell } from './DashboardShell';

/**
 * Layout des eingeloggten Bereichs.
 *
 * Hält sich absichtlich heraus und reicht nur an `DashboardShell` weiter – der
 * Rahmen selbst braucht Zustand (Seitenleiste, Toasts, Live-Kanal) und läuft
 * deshalb im Browser.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
