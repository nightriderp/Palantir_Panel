'use client';

import { useMemo, type ReactNode } from 'react';
import { type ConversationDto, type GameServerDto, type HostNodeDto } from '@palantir/contracts';
import { AppShell, StatusDot, ToastProvider } from '@/components/shared';
import { UserMenu } from '@/components/account/UserMenu';
import { fetchConversations } from '@/lib/api/chat';
import { fetchNodes } from '@/lib/api/nodes';
import { fetchServers } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { LiveChannelProvider, useLiveChannel } from '@/lib/live/LiveChannelProvider';
import { useServerListLive } from '@/lib/live/useServerLive';
import { DashboardNav } from './DashboardNav';
import { GlobalStatus } from './GlobalStatus';
import { SessionProvider, useSession } from './SessionProvider';
import {
  buildStatusMetrics,
  ownServersForNav,
  type SidebarServer,
  type StatusMetric,
} from './shellSummary';

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

interface ShellData {
  metrics: StatusMetric[];
  ownServers: SidebarServer[];
  unreadMessages: number;
}

/**
 * Daten, die Kopfleiste und Seitenleiste gemeinsam brauchen.
 *
 * Bewusst **hier** und nicht in den beiden Komponenten: sonst liefe jede Liste
 * zweimal über die Leitung. Die Serverübersicht lädt ihre Liste weiterhin
 * selbst – sie braucht mehr als der Rahmen (Filter, Aktionen, Mitglieder) und
 * soll nicht an dessen Ladezustand hängen.
 *
 * Nodes werden nur geholt, wenn das Konto sie sehen darf; sonst bleibt der Wert
 * `null` und die zugehörigen Kennzahlen entfallen, statt Nullen anzuzeigen.
 */
function useShellData(): ShellData {
  const { user } = useSession();
  const canViewNodes = user?.permissions.canViewNodes ?? false;

  const servers = useApiResource<GameServerDto[]>(
    (signal) => fetchServers(signal),
    user ? [user.id] : null,
  );
  const nodes = useApiResource<HostNodeDto[]>(
    (signal) => fetchNodes(signal),
    canViewNodes ? [] : null,
  );
  const conversations = useApiResource<ConversationDto[]>(
    (signal) => fetchConversations(signal),
    user ? [user.id] : null,
  );

  const list = useMemo(() => servers.data ?? [], [servers.data]);
  const serverIds = useMemo(() => list.map((server) => server.id), [list]);
  const { statsById, statusById } = useServerListLive(serverIds);

  // Denselben Abgleich wie die Übersicht: der über den Kanal gemeldete Status
  // ist jünger als der aus dem REST-Aufruf.
  const merged = useMemo(
    () =>
      list.map((server) => {
        const live = statusById[server.id];
        return live === undefined || live === server.status ? server : { ...server, status: live };
      }),
    [list, statusById],
  );

  const metrics = useMemo(
    () =>
      servers.data === null
        ? []
        : buildStatusMetrics({
            servers: merged,
            nodes: canViewNodes ? nodes.data : null,
            statsById,
          }),
    [servers.data, merged, nodes.data, canViewNodes, statsById],
  );

  const ownServers = useMemo(() => ownServersForNav(merged, user?.id ?? null), [merged, user?.id]);

  const unreadMessages = useMemo(
    () => (conversations.data ?? []).reduce((total, entry) => total + (entry.unreadCount ?? 0), 0),
    [conversations.data],
  );

  return { metrics, ownServers, unreadMessages };
}

/** Innerer Teil – braucht Sitzung und Live-Kanal, liegt deshalb unter beiden. */
function Shell({ children, versionLabel }: { children: ReactNode; versionLabel: string }) {
  const { user } = useSession();
  const { metrics, ownServers, unreadMessages } = useShellData();

  return (
    <AppShell
      sidebar={<DashboardNav user={user} ownServers={ownServers} unreadMessages={unreadMessages} />}
      topbar={
        <>
          <GlobalStatus metrics={metrics} />
          <div className="flex shrink-0 items-center gap-4">
            <LiveConnectionBadge />
            <UserMenu user={user} />
          </div>
        </>
      }
      sidebarFooter={
        <span title="Aktuelle Fassung" className="font-mono text-xs text-ink-faint">
          {versionLabel}
        </span>
      }
    >
      {children}
    </AppShell>
  );
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
          <Shell versionLabel={versionLabel}>{children}</Shell>
        </LiveChannelProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
