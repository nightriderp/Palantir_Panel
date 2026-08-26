'use client';

import { type GameServerDto } from '@palantir/contracts';
import {
  Badge,
  Button,
  Icon,
  IconButton,
  ServerStatusPill,
  formatServerAddress,
  isLifecycleActionBlocked,
  serverStatusMeta,
  startStopAction,
} from '@/components/shared';
import { type LifecycleAction } from '@/lib/api/servers';

/**
 * Kopf der Server-Detailansicht (Mockup „Server-Detail").
 *
 * Name, Status, Adresse und die Lifecycle-Schaltflächen. Welche Schaltfläche
 * erscheint, entscheidet ausschließlich das `permissions`-Objekt des DTO
 * (Pflichtenheft §5.2); während eines laufenden Übergangs sind sie gesperrt.
 */

export interface DetailHeaderProps {
  server: GameServerDto;
  busy: boolean;
  onLifecycle: (action: LifecycleAction) => void;
  onOpenSettings: () => void;
  onDelete: () => void;
  onCopyAddress: (address: string) => void;
  onBack: () => void;
}

export function DetailHeader({
  server,
  busy,
  onLifecycle,
  onOpenSettings,
  onDelete,
  onCopyAddress,
  onBack,
}: DetailHeaderProps) {
  const meta = serverStatusMeta(server.status);
  const blocked = isLifecycleActionBlocked(server.status) || busy;
  const action = startStopAction(server.status);
  const canUseStartStop =
    action === 'stop' ? server.permissions.canStop : server.permissions.canStart;
  const address = formatServerAddress(server.address);

  return (
    <header className="flex flex-col gap-3 rounded-2xl border border-line bg-card-gradient p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Button iconLeft="arrowLeft" size="sm" onClick={onBack} className="sm:hidden">
          Zurück
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-3xl font-bold">{server.name}</h1>
            <ServerStatusPill status={server.status} />
            {server.pendingRestart ? (
              <span title="Neue Einstellungen greifen beim nächsten Neustart.">
                <Badge tone="warning">Wartet auf Neustart</Badge>
              </span>
            ) : null}
            {server.updateAvailable ? <Badge tone="warning">Update verfügbar</Badge> : null}
          </div>

          <p className="mt-1 text-sm text-ink-soft">
            {server.gameTypeName}
            {server.hostName ? ` · ${server.hostName}` : ''}
            {server.ownerDisplayName ? ` · ${server.ownerDisplayName}` : ''}
          </p>

          {server.permissions.canViewAddress && address ? (
            <button
              type="button"
              onClick={() => onCopyAddress(address)}
              title="Adresse kopieren"
              className="mt-2 flex w-fit items-center gap-1.5 rounded border border-line bg-fill px-2.5 py-1.5 font-mono text-xs text-ink-muted"
            >
              <Icon name="copy" size={11} />
              {address}
            </button>
          ) : (
            <p className="mt-2 text-xs text-ink-faint">Adresse nicht freigegeben</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button iconLeft="arrowLeft" onClick={onBack} className="hidden sm:inline-flex">
            Übersicht
          </Button>

          {server.permissions.canManageSettings ? (
            <IconButton icon="gear" label="Einstellungen" onClick={onOpenSettings} />
          ) : null}

          {canUseStartStop ? (
            <Button
              variant={action === 'stop' ? 'danger' : 'success'}
              disabled={blocked}
              title={blocked ? meta.description : undefined}
              onClick={() => onLifecycle(action)}
            >
              {action === 'stop' ? 'Stoppen' : 'Starten'}
            </Button>
          ) : null}

          {server.permissions.canRestart ? (
            <IconButton
              icon="restart"
              label="Neustart"
              disabled={blocked}
              onClick={() => onLifecycle('restart')}
            />
          ) : null}

          {server.permissions.canDelete ? (
            <IconButton icon="trash" label="Löschen" variant="danger" onClick={onDelete} />
          ) : null}
        </div>
      </div>

      {meta.transitional ? (
        <div>
          <div className="relative h-1 overflow-hidden rounded-sm bg-fill-strong">
            <div className="absolute inset-y-0 left-0 w-[30%] animate-startup-sweep bg-gradient-to-r from-transparent via-warning to-transparent" />
          </div>
          <p className="mt-1.5 text-xs text-warning">
            {meta.label} Bei größeren Welten kann das einen Moment dauern.
          </p>
        </div>
      ) : null}

      {meta.faulted ? (
        <p className="rounded border border-danger-line bg-danger-soft px-2.5 py-2 text-sm text-danger">
          {server.statusMessage ?? meta.description}
        </p>
      ) : null}
    </header>
  );
}
