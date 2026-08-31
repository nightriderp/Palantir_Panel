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

  const [confirm, setConfirm] = useState<{ action: 'stop' | 'restart' } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const resource = useApiResource<GameServerDto>(
    (signal) => fetchServer(serverId, signal),
    [serverId],
  );
  const live = useServerLive(serverId);

  const lifecycle = useLifecycleActions((updated) => resource.setData(updated));

  /** DTO mit dem zuletzt über den Live-Kanal gemeldeten Zustand zusammenführen. */
  const server = useMemo<GameServerDto | null>(() => {
    if (!resource.data) return null;
    if (live.status === null || live.status === resource.data.status) return resource.data;
    return { ...resource.data, status: live.status, statusMessage: live.statusMessage };
  }, [resource.data, live.status, live.statusMessage]);

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
          {activeTab === 'backups' ? <BackupsTab server={server} /> : null}
          {activeTab === 'tasks' ? <TasksTab server={server} /> : null}

          {activeTab === 'settings' ? (
            <SettingsTab
              server={server}
              onServerUpdated={(updated) => resource.setData(updated)}
              cloneJob={live.cloneJob}
              backupProgress={live.backupProgress}
            />
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        busy={lifecycle.pendingServerId !== null}
        title={confirm?.action === 'restart' ? 'Server neu starten?' : 'Server stoppen?'}
        confirmLabel={confirm?.action === 'restart' ? 'Neu starten' : 'Stoppen'}
        message={
          confirm?.action === 'restart'
            ? `„${server.name}" wird heruntergefahren und sofort wieder gestartet. Alle Spieler fliegen dabei kurz heraus.`
            : `„${server.name}" wird heruntergefahren. Alle Spieler werden getrennt; die Weltdaten bleiben erhalten.`
        }
        onConfirm={() => {
          const action = confirm?.action;
          setConfirm(null);
          if (action) void lifecycle.run(server, action);
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
