'use client';

import { type GameTypeDto, type GameServerDto } from '@palantir/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  ButtonLink,
  ConfirmDialog,
  EmptyState,
  Icon,
  PageHeader,
  Panel,
  SegmentedControl,
  ServerCard,
  useToast,
  istSuchbegriff,
  useUrlFilter,
} from '@/components/shared';
import { openDirectConversation } from '@/lib/api/chat';
import { errorText } from '@/lib/api/client';
import { fetchGameTypes, fetchServers } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { mergeLiveStatus } from '@/lib/live/mergeLiveStatus';
import { useDtoRevisions } from '@/lib/live/useDtoRevision';
import { useServerListLive } from '@/lib/live/useServerLive';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { useShellServers } from '@/app/(dashboard)/ShellDataContext';
import {
  SERVER_FILTERS,
  SERVER_FILTER_LABELS,
  type ServerFilter,
  isServerFilter,
  groupServers,
} from './serverList';
import { LifecycleConfirmDialog } from './LifecycleConfirmDialog';
import { useLifecycleActions } from './useLifecycleActions';
import { usePinnedServers } from './usePinnedServers';
import { useSpruch } from '@/lib/theme/ThemeProvider';

/**
 * Serverübersicht (Lastenheft §3.3, Mockup „Übersicht").
 *
 * Zeigt alle Server, die das Backend für dieses Konto liefert – angeheftete
 * zuerst, dann eigene, dann fremde. Die Karte selbst kommt aus F2; welche
 * Schaltflächen sie anbietet, entscheidet ihr `permissions`-Objekt.
 *
 * Messwerte kommen über den Live-Kanal, nicht durch wiederholtes Nachladen.
 */

type PendingConfirm = { action: 'stop' | 'restart'; server: GameServerDto } | null;

export function ServerOverview() {
  const serverLeer = useSpruch('serverLeer');
  const keinTreffer = useSpruch('keinTreffer');

  const router = useRouter();
  const toast = useToast();
  const { user } = useSession();

  /*
   * Filter und Suche stehen in der Adresse (Fundpunkt 213): Vorher liess sich
   * die gefilterte Ansicht niemandem schicken, ein Neuladen warf sie weg, und
   * der Zurueck-Knopf sprang an ihr vorbei auf die vorige Seite.
   */
  const [filter, setFilter] = useUrlFilter<ServerFilter>('filter', 'all', isServerFilter);
  const [search, setSearch] = useUrlFilter<string>('q', '', istSuchbegriff);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);

  /*
   * Der Rahmen hält dieselbe Liste bereits (Kopfzeile, Seitenleiste). Sie dient
   * hier als Anfangsbestand: Die Karten stehen sofort, der eigene Abruf läuft
   * daneben und tauscht still gegen den frischen Stand. Vorher stand an dieser
   * Stelle bei jedem Aufruf der Seite „Server werden geladen …" – vor Daten,
   * die die Anwendung schon hatte.
   *
   * Geholt wird trotzdem: Die Übersicht braucht den Stand frischer als der
   * Rahmen und soll sich nicht darauf verlassen, dass er gerade nachgeladen
   * hat.
   */
  const servers = useApiResource<GameServerDto[]>(
    (signal) => fetchServers(signal),
    [],
    useShellServers(),
  );

  /*
   * Die Spieleliste nur wegen der Bilder (Betreiber-Wunsch 19.09.2026): Symbol
   * und Kachelbild gehoeren zur Vorlage, nicht zum einzelnen Server, und
   * stehen deshalb nicht im Server-DTO. Ein Abruf je Seitenaufruf, gegen den
   * die Karten sonst nichts zu zeigen haetten.
   */
  const spieltypen = useApiResource<GameTypeDto[]>((signal) => fetchGameTypes(signal), []);
  const spielBilder = useMemo(() => {
    const karte = new Map<string, { iconUrl: string | null; coverImageUrl: string | null }>();

    for (const spiel of spieltypen.data ?? []) {
      karte.set(spiel.id, { iconUrl: spiel.iconUrl, coverImageUrl: spiel.coverImageUrl });
    }

    return karte;
  }, [spieltypen.data]);
  const { pinnedIds, isPinned, togglePin } = usePinnedServers(servers.data ?? []);

  const list = useMemo(() => servers.data ?? [], [servers.data]);
  const serverIds = useMemo(() => list.map((server) => server.id), [list]);
  const { statsById, statusById, listRevision } = useServerListLive(serverIds);
  const dtoRevisions = useDtoRevisions(list);

  // Angelegt, geklont, gelöscht – auch aus einem anderen Tab (Fundpunkt 173).
  const reload = servers.reload;
  useEffect(() => {
    if (listRevision > 0) reload();
  }, [listRevision, reload]);

  /**
   * DTO mit dem zuletzt über den Live-Kanal gemeldeten Status zusammenführen –
   * je Karte gewinnt der jüngere Stand (Fundpunkt event-flow-04).
   */
  const merged = useMemo(
    () =>
      list.map((server) =>
        mergeLiveStatus(server, dtoRevisions[server.id] ?? 0, statusById[server.id] ?? null),
      ),
    [list, dtoRevisions, statusById],
  );

  const lifecycle = useLifecycleActions((updated) => {
    servers.setData((current) =>
      (current ?? []).map((entry) => (entry.id === updated.id ? updated : entry)),
    );
  });

  const grouped = useMemo(
    () =>
      groupServers({
        servers: merged,
        filter,
        search,
        currentUserId: user?.id ?? null,
        pinnedIds,
      }),
    [merged, filter, search, user?.id, pinnedIds],
  );

  const canCreate = user?.permissions.canCreateServer ?? false;

  /**
   * Anheftung umschalten (Gefundener Punkt 50).
   *
   * Die Antwort ersetzt den Server in der geladenen Liste; scheitert der
   * Aufruf, bleibt alles stehen und die Meldung erklärt warum – ein Schalter,
   * der etwas anderes zeigt als der Server weiß, wäre schlimmer als keiner.
   */
  /*
   * Die Rückrufe der Karten hängen an `useCallback` (Leistungsbericht
   * 19.09.2026, Punkt 3): Die Karte ist memoisiert, und ein bei jedem
   * Durchlauf neu gebildetes Lambda machte diesen Vergleich wertlos - sie
   * zeichnete dann bei jeder Live-Meldung trotzdem neu.
   */
  const setzeServer = servers.setData;
  const anheften = useCallback(
    async (server: GameServerDto): Promise<void> => {
      const aktualisiert = await togglePin(server);

      if (aktualisiert === null) {
        toast.error('Die Anheftung konnte nicht gespeichert werden.');

        return;
      }

      setzeServer((current) =>
        (current ?? []).map((entry) => (entry.id === aktualisiert.id ? aktualisiert : entry)),
      );
    },
    [togglePin, toast, setzeServer],
  );

  const copyAddress = useCallback(
    (address: string) => {
      void navigator.clipboard
        .writeText(address)
        .then(() => toast.success('Adresse kopiert.'))
        .catch(() => toast.error('Die Adresse konnte nicht kopiert werden.'));
    },
    [toast],
  );

  /**
   * „Nachricht" auf der Karte eines fremden Servers (Mockup `messageOwner`).
   *
   * Öffnet die Unterhaltung mit dem Besitzer – der Endpunkt legt sie beim
   * ersten Mal an – und springt mit der Id in die Nachrichtenansicht. Ohne
   * sichtbaren Besitzer (`ownerId` ist immer da, der Anzeigename nicht) bleibt
   * der Knopf trotzdem sinnvoll: geschrieben wird an das Konto, nicht an den
   * Namen.
   */
  const messageOwner = useCallback(
    (server: GameServerDto) => {
      void openDirectConversation(server.ownerId).then((result) => {
        if (result.success) {
          router.push(`/messages?c=${encodeURIComponent(result.data.id)}`);

          return;
        }

        toast.error(errorText(result));
      });
    },
    [router, toast],
  );

  const lifecycleRun = lifecycle.run;
  const anheftenStarten = useCallback(
    (entry: GameServerDto) => {
      void anheften(entry);
    },
    [anheften],
  );
  const starten = useCallback(
    (entry: GameServerDto) => {
      void lifecycleRun(entry, 'start');
    },
    [lifecycleRun],
  );
  const stoppenFragen = useCallback((entry: GameServerDto) => {
    setConfirm({ action: 'stop', server: entry });
  }, []);
  const neustartFragen = useCallback((entry: GameServerDto) => {
    setConfirm({ action: 'restart', server: entry });
  }, []);
  const oeffnen = useCallback(
    (entry: GameServerDto) => {
      router.push(`/servers/${entry.id}`);
    },
    [router],
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Übersicht"
        subtitle="Verwalte und überwache alle deine Gameserver"
        className="-mx-5 -mt-5 px-5"
        actions={
          canCreate ? (
            <ButtonLink href="/servers/neu" variant="primary" iconLeft="plus">
              Neuer Server
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Server filtern"
          value={filter}
          onChange={setFilter}
          items={SERVER_FILTERS.map((key) => ({ key, label: SERVER_FILTER_LABELS[key] }))}
        />

        <div className="relative min-w-[200px] flex-1">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Server suchen …"
            aria-label="Server suchen"
            className="w-full rounded-md border border-line-strong bg-fill py-2.5 pl-9 pr-3 text-base text-ink outline-none focus-visible:border-brand"
          />
        </div>
      </div>

      {servers.loading && servers.data === null ? (
        <Panel variant="outline" className="text-center text-base text-ink-muted">
          Server werden geladen …
        </Panel>
      ) : null}

      {servers.error ? (
        <Panel variant="outline" className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-base text-danger">{servers.error}</span>
          <Button onClick={servers.reload}>Erneut versuchen</Button>
        </Panel>
      ) : null}

      {!servers.loading && !servers.error && grouped.totalCount === 0 ? (
        <EmptyState
          icon="server"
          title={serverLeer.titel}
          description={serverLeer.text}
          action={
            canCreate ? (
              <ButtonLink href="/servers/neu" variant="primary" iconLeft="plus">
                Neuer Server
              </ButtonLink>
            ) : undefined
          }
        />
      ) : null}

      {grouped.totalCount > 0 && grouped.visibleCount === 0 ? (
        <EmptyState icon="search" title={keinTreffer.titel} description={keinTreffer.text} />
      ) : null}

      {grouped.groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-2xs uppercase tracking-[0.1em] text-ink-soft">
            {group.key === 'pinned' ? <Icon name="pin" size={12} /> : null}
            {group.title}
            <span className="font-mono text-ink-faint">· {group.servers.length}</span>
          </h2>

          {/*
            Spaltenzahl aus der Breite statt aus festen Haltepunkten: Das
            Raster nimmt so viele Kacheln, wie bei mindestens 320px Breite
            hineinpassen. Mit `xl:grid-cols-3` blieb auf einem breiten
            Bildschirm rechts ein Drittel leer, während die Kacheln
            auseinandergezogen wurden.
          */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4">
            {group.servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                stats={statsById[server.id] ?? null}
                gameIconUrl={spielBilder.get(server.gameType)?.iconUrl ?? null}
                gameCoverUrl={spielBilder.get(server.gameType)?.coverImageUrl ?? null}
                isOwn={user !== null && server.ownerId === user.id}
                adminAccess={
                  user !== null && server.ownerId !== user.id && user.permissions.canViewAnyServer
                }
                pinned={isPinned(server.id)}
                updateAvailable={server.updateAvailable}
                restartRequired={server.pendingRestart}
                pending={lifecycle.pendingServerId === server.id}
                onTogglePin={anheftenStarten}
                onStart={starten}
                onStop={stoppenFragen}
                onRestart={neustartFragen}
                onOpen={oeffnen}
                onCopyAddress={copyAddress}
                onMessageOwner={messageOwner}
              />
            ))}
          </div>
        </section>
      ))}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        busy={lifecycle.pendingServerId !== null}
        title={confirm?.action === 'restart' ? 'Server neu starten?' : 'Server stoppen?'}
        confirmLabel={confirm?.action === 'restart' ? 'Neu starten' : 'Stoppen'}
        message={
          confirm
            ? confirm.action === 'restart'
              ? `„${confirm.server.name}" wird heruntergefahren und sofort wieder gestartet. Alle Spieler fliegen dabei kurz heraus.`
              : `„${confirm.server.name}" wird heruntergefahren. Alle Spieler werden getrennt; die Weltdaten bleiben erhalten.`
            : ''
        }
        onConfirm={() => {
          if (!confirm) return;
          const { server, action } = confirm;
          setConfirm(null);
          void lifecycle.run(server, action);
        }}
      />

      <LifecycleConfirmDialog confirmation={lifecycle.confirmation} />
    </div>
  );
}
