'use client';

import { type GameServerDto } from '@palantir/contracts';
import { useMemo, useState } from 'react';
import { Icon, Modal, SegmentedControl, TextField, cn, serverInitials } from '@/components/shared';
import { fetchServers } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';

/**
 * Dialog „Neue Konversation" (Arbeitspaket F5, Lastenheft §3.6).
 *
 * Zwei Wege, passend zum Datenmodell des Backends:
 * - **Server-Chat** – jeder Server, auf den der Nutzer Zugriff hat. Der Chat
 *   entsteht beim ersten Öffnen automatisch (Pflichtenheft §15).
 * - **Direktnachricht** – die Besitzer der Server, die der Nutzer sieht. Das
 *   entspricht dem Mockup („Schreib den Besitzern der anderen Server").
 *
 * **Bewusste Grenze:** Es gibt im Backend keinen allgemeinen Nutzer-Verzeichnis-
 * Endpunkt, über den sich jedes freigeschaltete Konto anschreiben ließe. Ein DM
 * lässt sich hier deshalb nur mit jemandem beginnen, mit dem man über einen
 * Server bereits zu tun hat. Der fehlende Verzeichnis-Endpunkt ist in
 * WORK_STATUS.md unter „Gefundene Punkte" vermerkt (B7/B8).
 */

type Mode = 'direct' | 'server';

interface DirectCandidate {
  userId: string;
  displayName: string;
}

export interface NewConversationDialogProps {
  open: boolean;
  /** Eigene Konto-Id – das eigene Konto ist kein DM-Ziel. */
  viewerId: string | null;
  /** Ein Öffnen läuft gerade (Konversation wird angelegt/geladen). */
  busy: boolean;
  onClose: () => void;
  onOpenDirect: (userId: string) => void;
  onOpenServerChat: (serverId: string) => void;
}

/** Verdichtet die Serverliste zu den ansprechbaren Besitzern (ohne Dopplungen, ohne einen selbst). */
function directCandidatesFrom(
  servers: readonly GameServerDto[],
  viewerId: string | null,
): DirectCandidate[] {
  const byUser = new Map<string, DirectCandidate>();

  for (const server of servers) {
    if (server.ownerId === viewerId) continue;
    if (server.ownerDisplayName === null) continue;
    if (!byUser.has(server.ownerId)) {
      byUser.set(server.ownerId, {
        userId: server.ownerId,
        displayName: server.ownerDisplayName,
      });
    }
  }

  return [...byUser.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function NewConversationDialog({
  open,
  viewerId,
  busy,
  onClose,
  onOpenDirect,
  onOpenServerChat,
}: NewConversationDialogProps) {
  const [mode, setMode] = useState<Mode>('direct');
  const [search, setSearch] = useState('');

  const servers = useApiResource<GameServerDto[]>(
    (signal) => fetchServers(signal),
    open ? [open] : null,
  );

  const candidates = useMemo(
    () => directCandidatesFrom(servers.data ?? [], viewerId),
    [servers.data, viewerId],
  );

  const needle = search.trim().toLowerCase();

  const directRows = useMemo(
    () =>
      needle === ''
        ? candidates
        : candidates.filter((entry) => entry.displayName.toLowerCase().includes(needle)),
    [candidates, needle],
  );

  const serverRows = useMemo(() => {
    const list = servers.data ?? [];
    return needle === '' ? list : list.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [servers.data, needle]);

  const loading = servers.loading && servers.data === null;

  return (
    <Modal open={open} onClose={onClose} title="Neue Konversation">
      <div className="flex flex-col gap-3">
        <SegmentedControl
          label="Art der Konversation"
          value={mode}
          onChange={(key) => setMode(key as Mode)}
          items={[
            { key: 'direct', label: 'Direktnachricht' },
            { key: 'server', label: 'Server-Chat' },
          ]}
        />

        <TextField
          label="Suche"
          value={search}
          onChange={setSearch}
          placeholder={mode === 'direct' ? 'Person suchen …' : 'Server suchen …'}
        />

        <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-faint">
              <Icon name="clock" size={16} />
              Wird geladen …
            </div>
          ) : servers.error && servers.data === null ? (
            <div className="px-4 py-8 text-center text-sm text-ink-faint">{servers.error}</div>
          ) : mode === 'direct' ? (
            directRows.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-ink-faint">
                Niemand zum Anschreiben gefunden. Direktnachrichten sind mit den Besitzern der
                Server möglich, die du sehen kannst.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {directRows.map((entry) => (
                  <PickRow
                    key={entry.userId}
                    initials={serverInitials(entry.displayName)}
                    title={entry.displayName}
                    subtitle="Direktnachricht"
                    disabled={busy}
                    onClick={() => onOpenDirect(entry.userId)}
                  />
                ))}
              </ul>
            )
          ) : serverRows.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-ink-faint">
              Keine Server gefunden, auf die du Zugriff hast.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {serverRows.map((server) => (
                <PickRow
                  key={server.id}
                  icon="server"
                  title={server.name}
                  subtitle={server.gameTypeName}
                  disabled={busy}
                  onClick={() => onOpenServerChat(server.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface PickRowProps {
  title: string;
  subtitle: string;
  disabled: boolean;
  onClick: () => void;
  initials?: string;
  icon?: 'server';
}

function PickRow({ title, subtitle, disabled, onClick, initials, icon }: PickRowProps) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-fill',
        )}
      >
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-soft text-2xs font-bold text-brand">
          {icon ? <Icon name={icon} size={16} /> : initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{title}</span>
          <span className="block truncate text-xs text-ink-faint">{subtitle}</span>
        </span>
        <Icon name="chat" size={15} />
      </button>
    </li>
  );
}
