'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  type ConversationDto,
  type GameServerDto,
  type GameTypeDto,
  type HostNodeDto,
} from '@palantir/contracts';
import { AppShell, DeployBanner, StatusDot, ToastProvider } from '@/components/shared';
import { UserMenu } from '@/components/account/UserMenu';
import { Rundgang } from '@/components/tutorial/Rundgang';
import { RundgangProvider } from '@/components/tutorial/RundgangProvider';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { fetchConversations } from '@/lib/api/chat';
import { fetchNodes } from '@/lib/api/nodes';
import { fetchGameTypes, fetchServers } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { LiveChannelProvider, useLiveChannel } from '@/lib/live/LiveChannelProvider';
import { NotificationLiveProvider } from '@/lib/live/NotificationLiveProvider';
import { mergeLiveStatus } from '@/lib/live/mergeLiveStatus';
import { useDtoRevisions } from '@/lib/live/useDtoRevision';
import { useServerListLive } from '@/lib/live/useServerLive';
import { DashboardNav } from './DashboardNav';
import { GlobalStatus } from './GlobalStatus';
import { AUSFALL_SCHWELLE_MS, liveAnzeige } from './liveBadge';
import { SessionProvider, useSession } from './SessionProvider';
import { ShellDataProvider } from './ShellDataContext';
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

/**
 * Zustand der Live-Verbindung in der Kopfleiste (Pflichtenheft §5.3).
 *
 * Die Beschriftung selbst steht in `liveBadge.ts`; hier läuft nur die Uhr, die
 * einen kurzen Aussetzer von einem echten Ausfall trennt. Sie hängt bewusst am
 * **Ja/Nein** „verbunden", nicht am Verbindungszustand: Sonst würde jeder
 * Fehlversuch sie neu starten, und aus dem Aussetzer würde nie ein Ausfall.
 */
function LiveConnectionBadge() {
  const { connection } = useLiveChannel();
  const [ausfallBestaetigt, setAusfallBestaetigt] = useState(false);

  const getrennt = connection !== 'open';

  // Sobald die Verbindung wieder steht, ist der Ausfall vorbei – noch im
  // Rendern zurückgesetzt, damit kein Bild „Ausfall" bei offener Leitung zeigt.
  const [warGetrennt, setWarGetrennt] = useState(getrennt);
  if (warGetrennt !== getrennt) {
    setWarGetrennt(getrennt);
    if (!getrennt) setAusfallBestaetigt(false);
  }

  useEffect(() => {
    if (!getrennt) return;

    const timer = setTimeout(() => setAusfallBestaetigt(true), AUSFALL_SCHWELLE_MS);
    return () => clearTimeout(timer);
  }, [getrennt]);

  const { tone, label, shortLabel, title, pulse } = liveAnzeige(connection, ausfallBestaetigt);

  // Auf dem Telefon ein Wort statt nur des Farbpunkts (Befund 12.8).
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-faint" title={title}>
      <StatusDot tone={tone} pulse={pulse} />
      <span className="sm:hidden">{shortLabel}</span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

interface ShellData {
  metrics: StatusMetric[];
  ownServers: SidebarServer[];
  unreadMessages: number;
  /**
   * Die rohe Serverliste – wird an `ShellDataProvider` weitergereicht, damit
   * die Serverübersicht darunter nicht bei null anfangen muss
   * (`ShellDataContext`).
   */
  servers: GameServerDto[] | null;
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
  const pathname = usePathname();
  const canViewNodes = user?.permissions.canViewNodes ?? false;

  const servers = useApiResource<GameServerDto[]>(
    (signal) => fetchServers(signal),
    user ? [user.id] : null,
  );
  /*
   * Nur wegen der Symbole unter „Deine Server": Das Bild gehoert zur Vorlage,
   * nicht zum Server, und steht deshalb nicht im Server-DTO – wie auf der
   * Server-Karte (`ServerOverview`).
   */
  const gameTypes = useApiResource<GameTypeDto[]>(
    (signal) => fetchGameTypes(signal),
    user ? [user.id] : null,
  );
  const nodes = useApiResource<HostNodeDto[]>(
    (signal) => fetchNodes(signal),
    canViewNodes ? [] : null,
  );
  /*
   * Der Zaehler soll stimmen, nachdem in den Nachrichten gelesen wurde, und
   * der Lesezustand aendert sich ohne Ereignis auf dem Live-Kanal. Geholt wird
   * deshalb beim Betreten und beim Verlassen des Nachrichtenbereichs.
   *
   * ⚠️ Hier stand `pathname` – und damit lief bei **jedem** Seitenwechsel im
   * ganzen Panel eine zusaetzliche Anfrage, auch beim Sprung von der
   * Serveruebersicht in die Administration, wo sich am Lesezustand nichts
   * aendern kann. Der Wahrheitsgehalt liegt nicht im Pfad, sondern in der
   * Frage „ist der Nutzer in den Nachrichten?" – ein Boolescher Wert, der sich
   * genau zweimal je Besuch aendert. Die Auskunft bleibt dieselbe, die Zahl
   * der Abrufe faellt von einer je Seitenwechsel auf zwei je Besuch.
   *
   * Eine neu eintreffende Nachricht faellt weiterhin erst beim naechsten
   * Wechsel auf - der Chat-Kanal haengt an einer eigenen Verbindung
   * (`useChatLive`), und eine zweite davon nur fuer den Zaehler waere zu teuer.
   */
  const imNachrichtenbereich = pathname.startsWith('/messages');
  const conversations = useApiResource<ConversationDto[]>(
    (signal) => fetchConversations(signal),
    user ? [user.id, imNachrichtenbereich] : null,
  );

  const list = useMemo(() => servers.data ?? [], [servers.data]);
  const serverIds = useMemo(() => list.map((server) => server.id), [list]);
  const { statsById, statusById, listRevision } = useServerListLive(serverIds);

  // Angelegt, geklont, gelöscht – auch aus einem anderen Tab (Fundpunkt 173).
  const reloadServers = servers.reload;
  useEffect(() => {
    if (listRevision > 0) reloadServers();
  }, [listRevision, reloadServers]);
  const dtoRevisions = useDtoRevisions(list);

  // Denselben Abgleich wie die Übersicht: Es gewinnt der jüngere der beiden
  // Stände, nicht grundsätzlich der Live-Kanal (Fundpunkt event-flow-04).
  const merged = useMemo(
    () =>
      list.map((server) =>
        mergeLiveStatus(server, dtoRevisions[server.id] ?? 0, statusById[server.id] ?? null),
      ),
    [list, dtoRevisions, statusById],
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

  const iconByGameType = useMemo(
    () => new Map((gameTypes.data ?? []).map((spiel) => [spiel.id, spiel.iconUrl] as const)),
    [gameTypes.data],
  );
  const ownServers = useMemo(
    () => ownServersForNav(merged, user?.id ?? null, iconByGameType),
    [merged, user?.id, iconByGameType],
  );

  const unreadMessages = useMemo(
    () => (conversations.data ?? []).reduce((total, entry) => total + (entry.unreadCount ?? 0), 0),
    [conversations.data],
  );

  return { metrics, ownServers, unreadMessages, servers: servers.data };
}

/** Innerer Teil – braucht Sitzung und Live-Kanal, liegt deshalb unter beiden. */
function Shell({ children, versionLabel }: { children: ReactNode; versionLabel: string }) {
  const { user } = useSession();
  const { metrics, ownServers, unreadMessages, servers } = useShellData();

  /*
    Nur die Serverliste hängt hier drin, und sie bekommt eine eigene Identität
    nur dann, wenn sie sich wirklich geändert hat – sonst bekäme jede Seite
    unter dem Rahmen bei jedem Tick des Live-Kanals einen neuen Kontextwert.
  */
  const shellData = useMemo(() => ({ servers }), [servers]);

  return (
    /*
      Der Rundgang liegt um den ganzen Rahmen: Er leuchtet Einträge der
      Seitenleiste und Knöpfe der Kopfleiste an und muss beides erreichen. Von
      selbst geht er nur auf, wenn das Konto geladen ist – vorher hat die
      Seitenleiste noch keine Einträge, auf die er zeigen könnte.
    */
    <RundgangProvider kontoGeladen={user !== null}>
      <AppShell
        sidebar={
          <DashboardNav user={user} ownServers={ownServers} unreadMessages={unreadMessages} />
        }
        topbar={
          <>
            <GlobalStatus metrics={metrics} />
            <div className="flex shrink-0 items-center gap-3">
              <LiveConnectionBadge />
              <NotificationBell />
              <UserMenu user={user} />
            </div>
          </>
        }
        sidebarFooter={
          <span title="Aktuelle Version" className="font-mono text-xs text-ink-faint">
            {versionLabel}
          </span>
        }
      >
        {/*
          Der Hinweis auf eine neue Version steht über dem Seiteninhalt und
          damit auf jeder Seite des Panels – nach einem Deployment läuft im
          offenen Browser sonst altes Frontend gegen neue API weiter.
        */}
        <DeployBanner current={versionLabel} />
        {/*
          Was der Rahmen schon geholt hat, steht der Seite darunter als
          Anfangsbestand zur Verfügung (`ShellDataContext`).
        */}
        <ShellDataProvider value={shellData}>{children}</ShellDataProvider>
      </AppShell>
      <Rundgang />
    </RundgangProvider>
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
          <NotificationLiveProvider>
            <Shell versionLabel={versionLabel}>{children}</Shell>
          </NotificationLiveProvider>
        </LiveChannelProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
