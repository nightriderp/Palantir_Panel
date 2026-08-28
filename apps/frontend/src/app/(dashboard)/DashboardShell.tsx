'use client';

import { type ReactNode } from 'react';
import { AppShell, Icon, StatusDot, ToastProvider } from '@/components/shared';
import { LiveChannelProvider, useLiveChannel } from '@/lib/live/LiveChannelProvider';
import { APP_VERSION_LABEL } from '@/lib/version';
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
      {user ? (
        <span className="flex items-center gap-2 text-base text-ink-muted">
          <Icon name="user" size={14} />
          {user.displayName}
        </span>
      ) : null}
    </div>
  );
}

function Sidebar() {
  const { user } = useSession();
  return <DashboardNav user={user} />;
}

export interface DashboardShellProps {
  children: ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  return (
    <ToastProvider>
      <SessionProvider>
        <LiveChannelProvider>
          <AppShell
            sidebar={<Sidebar />}
            topbar={<Topbar />}
            sidebarFooter={
              <span className="text-2xs text-ink-faint">Palantir · {APP_VERSION_LABEL}</span>
            }
          >
            {children}
          </AppShell>
        </LiveChannelProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
