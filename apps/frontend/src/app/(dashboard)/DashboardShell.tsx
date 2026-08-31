'use client';

import { type ReactNode } from 'react';
import { AppShell, StatusDot, ToastProvider } from '@/components/shared';
import { UserMenu } from '@/components/account/UserMenu';
import { LiveChannelProvider, useLiveChannel } from '@/lib/live/LiveChannelProvider';
import { DashboardNav } from './DashboardNav';
import { SessionProvider, useSession } from './SessionProvider';

/**
 * Rahmen des eingeloggten Bereichs.
 *
 * **Zwischenstand:** Der Rahmen entsteht hier, weil F3 die erste Ansicht unter
 * `(dashboard)` ist; STRUKTUR.md weist ihn keinem Arbeitspaket zu. Er hält sich
 * bewusst kurz – Seitenleiste, Kopfzeile, Toasts, Live-Kanal – damit F4–F11 nur
 * ihre Route ergänzen müssen. Vermerkt unter „Gefundene Punkte" in
 * WORK_STATUS.md.
 */

/** Zustand der Live-Verbindung in der Kopfleiste (Pflichtenheft §5.3). */
function LiveConnectionBadge() {
  const { connection } = useLiveChannel();

  const meta = {
    open: { tone: 'success', label: 'Live verbunden' },
    connecting: { tone: 'warning', label: 'Verbindung wird aufgebaut …' },
    closed: { tone: 'danger', label: 'Live-Verbindung unterbrochen' },
  } as const;

  const { tone, label } = meta[connection];

  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-faint" title={label}>
      <StatusDot tone={tone} pulse={connection !== 'closed'} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

function Topbar() {
  const { user } = useSession();

  return (
    <div className="flex flex-1 items-center justify-end gap-4">
      <LiveConnectionBadge />
      <UserMenu user={user} />
    </div>
  );
}

function Sidebar() {
  const { user } = useSession();
  return <DashboardNav user={user} />;
}

export interface DashboardShellProps {
  children: ReactNode;
  /**
   * Version des laufenden Deployments für die Fußzeile der Seitenleiste.
   *
   * Kommt von der Server-Seite (`layout.tsx`), weil der Wert erst zur Laufzeit
   * feststeht: Die Images entstehen beim Merge nach `main`, das Versions-Tag
   * erst beim Freigeben.
   */
  versionLabel: string;
}

export function DashboardShell({ children, versionLabel }: DashboardShellProps) {
  return (
    <ToastProvider>
      <SessionProvider>
        <LiveChannelProvider>
          <AppShell
            sidebar={<Sidebar />}
            topbar={<Topbar />}
            sidebarFooter={
              <span className="text-2xs text-ink-faint">Palantir · {versionLabel}</span>
            }
          >
            {children}
          </AppShell>
        </LiveChannelProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
