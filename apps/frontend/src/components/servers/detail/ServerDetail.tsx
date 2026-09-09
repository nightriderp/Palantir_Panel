'use client';

import { type GameServerDto } from '@palantir/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  DangerConfirmDialog,
  EmptyState,
  PageHeader,
  Panel,
  Tabs,
  useToast,
} from '@/components/shared';
import { type LifecycleAction, deleteServer, fetchServer } from '@/lib/api/servers';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { useDtoRevision } from '@/lib/live/useDtoRevision';
import { type LiveStatusEntry, mergeLiveStatus } from '@/lib/live/mergeLiveStatus';
import { useServerLive } from '@/lib/live/useServerLive';
import { buildServerTabs, resolveServerTab, type ServerTabKey } from '../serverTabs';
import { useLifecycleActions } from '../useLifecycleActions';
import { BackupsTab } from './BackupsTab';
import { ConsoleTab } from './ConsoleTab';
import { DetailHeader } from './DetailHeader';
import { FilesTab } from './FilesTab';
import { OverviewTab } from './OverviewTab';
import { SettingsTab } from './SettingsTab';
import { TasksTab } from './TasksTab';

/**
 * Server-Detailansicht mit ihren fünf Reitern (Lastenheft §3.3).
 *
 * Die Konsole hat wie im Mockup **keinen eigenen Reiter**: sie steht auf der
 * Übersicht neben den Server-Details.
 *
 * Lädt den Server per REST und hängt sich für Status, Messwerte, Konsole und
 * laufende Aufträge an den Live-Kanal. Der aktive Reiter steht in der
 * Adresszeile (`?tab=`), damit ein Lesezeichen oder das Neuladen an derselben
 * Stelle landet.
 */

export interface ServerDetailProps {
  serverId: string;
}

export function ServerDetail({ serverId }: ServerDetailProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [confirm, setConfirm] = useState<{ action: 'stop' | 'restart' | 'update' } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const resource = useApiResource<GameServerDto>(
    (signal) => fetchServer(serverId, signal),
    [serverId],
  );
  const live = useServerLive(serverId);
  const dtoRevision = useDtoRevision(resource.data);

  const lifecycle = useLifecycleActions((updated) => resource.setData(updated));

  const liveStatus = useMemo<LiveStatusEntry | null>(
    () =>
      live.status === null
        ? null
        : {
            status: live.status,
            statusMessage: live.statusMessage,
            revision: live.statusRevision,
          },
    [live.status, live.statusMessage, live.statusRevision],
  );

  /**
   * DTO mit dem zuletzt über den Live-Kanal gemeldeten Zustand zusammenführen.
   *
   * Der jüngere Stand gewinnt, nicht mehr grundsätzlich der Live-Kanal
   * (Fundpunkt event-flow-04): Nach „Start" ist die REST-Antwort das jüngere
   * Datum, ein noch stehender Live-Status von vorhin darf sie nicht
   * überschreiben.
   */
  const server = useMemo<GameServerDto | null>(
    () => (resource.data ? mergeLiveStatus(resource.data, dtoRevision, liveStatus) : null),
    [resource.data, dtoRevision, liveStatus],
  );

  const tabs = useMemo(() => (server ? buildServerTabs(server.permissions) : []), [server]);
  const activeTab = resolveServerTab(searchParams.get('tab'), tabs);

  function selectTab(key: ServerTabKey) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', key);
    router.replace(`/servers/${serverId}?${params.toString()}`, { scroll: false });
  }

  function copyAddress(address: string) {
    void navigator.clipboard
      .writeText(address)
      .then(() => toast.success('Adresse kopiert.'))
      .catch(() => toast.error('Die Adresse konnte nicht kopiert werden.'));
  }

  function onLifecycle(action: LifecycleAction) {
    if (!server) return;
    if (action === 'start') {
      void lifecycle.run(server, 'start');
      return;
    }
    setConfirm({ action });
  }

  async function remove() {
    setDeleting(true);
    const result = await deleteServer(serverId);
    setDeleting(false);
    setDeleteOpen(false);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    toast.success('Server gelöscht.');
    router.push('/servers');
  }

  if (resource.loading && !server) {
    return (
      <Panel variant="outline" className="text-center text-base text-ink-muted">
        Server wird geladen …
      </Panel>
    );
  }

  if (!server) {
    return (
      <EmptyState
        icon="warning"
        title="Server nicht verfügbar"
        description={resource.error ?? 'Dieser Server existiert nicht oder ist nicht freigegeben.'}
        action={<Button onClick={() => router.push('/servers')}>Zurück zur Übersicht</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={server.name}
        subtitle="Details und Steuerung"
        className="-mx-5 -mt-5 px-5"
        actions={
          <Button iconLeft="arrowLeft" onClick={() => router.push('/servers')}>
            Zurück zur Übersicht
          </Button>
        }
      />

      <DetailHeader
        server={server}
        busy={lifecycle.pendingServerId !== null}
        onLifecycle={onLifecycle}
        onUpdate={() => setConfirm({ action: 'update' })}
        onOpenSettings={() => selectTab('settings')}
        onDelete={() => setDeleteOpen(true)}
        onCopyAddress={copyAddress}
      />

      {activeTab === null ? (
        <EmptyState
          icon="lock"
          title="Kein Zugriff"
          description="Für diesen Server ist keine Ansicht freigegeben."
        />
      ) : (
        <>
          <Tabs items={tabs} activeKey={activeTab} onChange={selectTab} />

          {activeTab === 'overview' ? (
            <OverviewTab
              server={server}
              stats={live.stats}
              console={
                server.permissions.canUseConsole ? (
                  <ConsoleTab
                    server={server}
                    lines={live.consoleLines}
                    connection={live.connection}
                    onSend={live.sendConsoleCommand}
                    onClear={live.clearConsole}
                  />
                ) : null
              }
            />
          ) : null}

          {activeTab === 'files' ? <FilesTab server={server} /> : null}
          {activeTab === 'backups' ? (
            <BackupsTab server={server} backupProgress={live.backupProgress} />
          ) : null}
          {activeTab === 'tasks' ? <TasksTab server={server} /> : null}

          {activeTab === 'settings' ? (
            <SettingsTab
              server={server}
              onServerUpdated={(updated) => resource.setData(updated)}
              cloneJob={live.cloneJob}
              connection={live.connection}
              backupProgress={live.backupProgress}
            />
          ) : null}
        </>
      )}

      {/*
       * Aktualisieren läuft über denselben Neustart (Fundpunkt 190): Der Start
       * baut den Container aus dem heutigen Bauplan neu und zieht dabei die
       * neue Fassung des Images. Rückfrage und Beschriftung nennen trotzdem
       * den wirklichen Anlass.
       */}
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        busy={lifecycle.pendingServerId !== null}
        title={CONFIRM_TEXTS[confirm?.action ?? 'stop'].title}
        confirmLabel={CONFIRM_TEXTS[confirm?.action ?? 'stop'].confirmLabel}
        message={CONFIRM_TEXTS[confirm?.action ?? 'stop'].message(server.name)}
        onConfirm={() => {
          const action = confirm?.action;
          setConfirm(null);
          if (action === undefined) return;
          if (action === 'update') {
            void lifecycle.run(server, 'restart', { label: 'Server wird aktualisiert …' });

            return;
          }
          void lifecycle.run(server, action);
        }}
      />

      <DangerConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        busy={deleting}
        title="Server löschen?"
        confirmationPhrase={server.name}
        message={`„${server.name}" wird endgültig gelöscht, inklusive aller Welten und Sicherungen.`}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

/** Rückfragen der Lifecycle-Aktionen – je Anlass ein eigener Wortlaut. */
const CONFIRM_TEXTS: Record<
  'stop' | 'restart' | 'update',
  { title: string; confirmLabel: string; message: (name: string) => string }
> = {
  stop: {
    title: 'Server stoppen?',
    confirmLabel: 'Stoppen',
    message: (name) =>
      `„${name}" wird heruntergefahren. Alle Spieler werden getrennt; die Weltdaten bleiben erhalten.`,
  },
  restart: {
    title: 'Server neu starten?',
    confirmLabel: 'Neu starten',
    message: (name) =>
      `„${name}" wird heruntergefahren und sofort wieder gestartet. Alle Spieler fliegen dabei kurz heraus.`,
  },
  update: {
    title: 'Auf die neue Fassung aktualisieren?',
    confirmLabel: 'Aktualisieren',
    message: (name) =>
      `„${name}" wird dafür neu gestartet und läuft danach auf der neuen Fassung. Alle Spieler fliegen kurz heraus; die Weltdaten bleiben erhalten.`,
  },
};
