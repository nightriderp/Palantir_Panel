'use client';

import { type GameServerDto } from '@palantir/contracts';
import {
  Badge,
  Button,
  Icon,
  IconButton,
  ServerStatusPill,
  StartupProgress,
  formatServerAddress,
  isLifecycleActionBlocked,
  serverInitials,
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
 *
 * Der Weg zurück zur Übersicht steht nicht hier, sondern im Seitenkopf darüber –
 * so wie im Mockup, das die Karte den Aktionen am Server vorbehält.
 */

export interface DetailHeaderProps {
  server: GameServerDto;
  busy: boolean;
  onLifecycle: (action: LifecycleAction) => void;
  /**
   * Übernimmt die neue Fassung des Images (Fundpunkt 190).
   *
   * Getrennt von `onLifecycle`, obwohl derselbe Neustart dahintersteht: Für den
   * Betreiber ist das eine andere Absicht, und die Rückfrage davor nennt einen
   * anderen Grund.
   */
  onUpdate: () => void;
  onOpenSettings: () => void;
  onDelete: () => void;
  onCopyAddress: (address: string) => void;
}

export function DetailHeader({
  server,
  busy,
  onLifecycle,
  onUpdate,
  onOpenSettings,
  onDelete,
  onCopyAddress,
}: DetailHeaderProps) {
  const meta = serverStatusMeta(server.status);
  const blocked = isLifecycleActionBlocked(server.status) || busy;
  const action = startStopAction(server.status);
  const canUseStartStop =
    action === 'stop' ? server.permissions.canStop : server.permissions.canStart;
  const address = formatServerAddress(server.address);

  /*
   * Ein Server behält seine Image-Fassung, bis jemand sie übernimmt
   * (Pflichtenheft §9, Review 2026-09-16) – der Knopf erscheint deshalb in
   * jedem Zustand, in dem der Wechsel möglich ist: laufend als Neustart,
   * gestoppt als Neuaufbau ohne Start. Mitten in einem Übergang bleibt er
   * gesperrt wie die übrigen Aktionen.
   */
  const canUpdate = server.updateAvailable && server.permissions.canUpdate;
  const updateLaeuftNeu = server.status === 'running' || server.status === 'starting';

  return (
    <header className="flex flex-col gap-3 rounded-2xl border border-line bg-hero-gradient p-4.5">
      <div className="flex flex-wrap items-start gap-3.5">
        <span
          aria-hidden
          className="flex h-13 w-13 shrink-0 items-center justify-center rounded-xl bg-brand-gradient font-mono text-xl font-bold text-canvas"
        >
          {serverInitials(server.name)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Der Seitenkopf traegt bereits das `h1`; hier steht derselbe Name
                als Ueberschrift der Karte. */}
            <h2 className="truncate text-3xl font-bold">{server.name}</h2>
            <ServerStatusPill status={server.status} />
            {server.pendingRestart ? (
              <span title="Neue Einstellungen greifen beim nächsten Neustart.">
                <Badge tone="warning">Wartet auf Neustart</Badge>
              </span>
            ) : null}
            {server.updateAvailable ? (
              <span
                title={
                  canUpdate
                    ? 'Über „Aktualisieren" wird die neue Fassung übernommen. Bis dahin läuft der Server auf seiner bisherigen Fassung – auch nach einem Neustart.'
                    : 'Die neue Fassung übernimmt der Besitzer über „Aktualisieren".'
                }
              >
                <Badge tone="warning">Update verfügbar</Badge>
              </span>
            ) : null}
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
          {server.permissions.canManageSettings ? (
            <IconButton icon="gear" label="Einstellungen" onClick={onOpenSettings} />
          ) : null}

          {canUpdate ? (
            <Button
              variant="secondary"
              iconLeft="download"
              disabled={blocked}
              title={
                updateLaeuftNeu
                  ? 'Startet den Server neu und übernimmt dabei die neue Fassung.'
                  : 'Baut den Container mit der neuen Fassung neu, ohne den Server zu starten.'
              }
              onClick={onUpdate}
            >
              Aktualisieren
            </Button>
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
        <StartupProgress
          label={meta.label}
          note={server.statusMessage ?? 'Bei größeren Welten kann das einen Moment dauern.'}
          /*
            Seit wann dieser Übergang läuft - `statusChangedAt`, nicht
            `lastStartedAt`.

            Letzteres ist der Zeitpunkt des letzten ERFOLGREICHEN Starts; er
            wird erst gesetzt, wenn der Server `running` erreicht. Während des
            Startens stand dort deshalb der Start von vorhin, und die Uhr zählte
            von dort: "Startet … seit 105:07 min" für einen Server, der seit
            zwei Minuten hochfährt (im Betrieb gesehen, 15.09.2026). Ein
            gestoppter und neu gestarteter Server zählte die Standzeit mit.
          */
          since={server.statusChangedAt}
        />
      ) : null}

      {meta.faulted ? (
        <p className="rounded border border-danger-line bg-danger-soft px-2.5 py-2 text-sm text-danger">
          {server.statusMessage ?? meta.description}
        </p>
      ) : null}
    </header>
  );
}
