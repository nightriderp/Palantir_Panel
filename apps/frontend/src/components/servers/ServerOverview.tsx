'use client';

import { type GameServerDto } from '@palantir/contracts';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Icon,
  PageHeader,
  Panel,
  SegmentedControl,
  ServerCard,
  useToast,
} from '@/components/shared';
import { openDirectConversation } from '@/lib/api/chat';
import { errorText } from '@/lib/api/client';
import { fetchServers } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { useServerListLive } from '@/lib/live/useServerLive';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import {
  SERVER_FILTERS,
  SERVER_FILTER_LABELS,
  type ServerFilter,
  groupServers,
} from './serverList';
import { useLifecycleActions } from './useLifecycleActions';
import { usePinnedServers } from './usePinnedServers';

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
  const router = useRouter();
  const toast = useToast();
  const { user } = useSession();

  const [filter, setFilter] = useState<ServerFilter>('all');
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<PendingConfirm>(null);

  const servers = useApiResource<GameServerDto[]>((signal) => fetchServers(signal), []);
  const { pinnedIds, isPinned, togglePin } = usePinnedServers(servers.data ?? []);

  const list = useMemo(() => servers.data ?? [], [servers.data]);
  const serverIds = useMemo(() => list.map((server) => server.id), [list]);
  const { statsById, statusById } = useServerListLive(serverIds);

  /** DTO mit dem zuletzt über den Live-Kanal gemeldeten Status zusammenführen. */
  const merged = useMemo(
    () =>
      list.map((server) => {
        const live = statusById[server.id];
        return live === undefined || live === server.status ? server : { ...server, status: live };
      }),
    [list, statusById],
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
  async function anheften(server: GameServerDto): Promise<void> {
    const aktualisiert = await togglePin(server);

    if (aktualisiert === null) {
      toast.error('Die Anheftung konnte nicht gespeichert werden.');

      return;
    }

    servers.setData((current) =>
      (current ?? []).map((entry) => (entry.id === aktualisiert.id ? aktualisiert : entry)),
    );
  }

  function copyAddress(address: string) {
    void navigator.clipboard
      .writeText(address)
      .then(() => toast.success('Adresse kopiert.'))
      .catch(() => toast.error('Die Adresse konnte nicht kopiert werden.'));
  }

  /**
   * „Nachricht" auf der Karte eines fremden Servers (Mockup `messageOwner`).
   *
   * Öffnet die Unterhaltung mit dem Besitzer – der Endpunkt legt sie beim
   * ersten Mal an – und springt mit der Id in die Nachrichtenansicht. Ohne
   * sichtbaren Besitzer (`ownerId` ist immer da, der Anzeigename nicht) bleibt
   * der Knopf trotzdem sinnvoll: geschrieben wird an das Konto, nicht an den
   * Namen.
   */
  function messageOwner(server: GameServerDto) {
    void openDirectConversation(server.ownerId).then((result) => {
      if (result.success) {
        router.push(`/messages?c=${encodeURIComponent(result.data.id)}`);
        return;
      }

      toast.error(errorText(result));
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Übersicht"
        subtitle="Verwalte und überwache alle deine Gameserver"
        className="-mx-5 -mt-5 px-5"
        actions={
          canCreate ? (
            <Button variant="primary" iconLeft="plus" onClick={() => router.push('/servers/neu')}>
              Neuer Server
            </Button>
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
          title="Noch keine Server"
          description="Lege deinen ersten Gameserver an – das dauert nur ein paar Klicks."
          action={
            canCreate ? (
              <Button variant="primary" iconLeft="plus" onClick={() => router.push('/servers/neu')}>
                Neuer Server
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {grouped.totalCount > 0 && grouped.visibleCount === 0 ? (
        <EmptyState
          icon="search"
          title="Kein Treffer"
          description="Kein Server passt zu dieser Auswahl. Ändere den Filter oder den Suchbegriff."
        />
      ) : null}

      {grouped.groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-2xs uppercase tracking-[0.1em] text-ink-soft">
            {group.key === 'pinned' ? <Icon name="pin" size={12} /> : null}
            {group.title}
            <span className="font-mono text-ink-faint">· {group.servers.length}</span>
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {group.servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                stats={statsById[server.id] ?? null}
                isOwn={user !== null && server.ownerId === user.id}
                adminAccess={
                  user !== null && server.ownerId !== user.id && user.permissions.canViewAnyServer
                }
                pinned={isPinned(server.id)}
                updateAvailable={server.updateAvailable}
                restartRequired={server.pendingRestart}
                onTogglePin={(entry) => void anheften(entry)}
                onStart={(entry) => void lifecycle.run(entry, 'start')}
                onStop={(entry) => setConfirm({ action: 'stop', server: entry })}
                onRestart={(entry) => setConfirm({ action: 'restart', server: entry })}
                onOpen={(entry) => router.push(`/servers/${entry.id}`)}
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
    </div>
  );
}
