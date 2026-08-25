'use client';

import { type GameServerDto, type ServerLiveStats } from '@palantir/contracts';
import { Icon } from '../icons/Icon';
import { Button, IconButton } from '../primitives/Button';
import { type Tone } from '../primitives/Badge';
import { cn } from '../utils/cn';
import {
  clampPercent,
  formatMegabytes,
  formatPing,
  formatPlayers,
  formatServerAddress,
  serverInitials,
} from '../utils/format';
import { MetricRing } from './MetricRing';
import { ServerStatusPill } from './ServerStatusPill';
import {
  hasLiveStats,
  isLifecycleActionBlocked,
  serverStatusMeta,
  startStopAction,
} from './serverStatus';

export interface ServerCardProps {
  server: GameServerDto;
  /**
   * Live-Messwerte aus dem WebSocket-Kanal. Fehlen sie, zeigen die Ringe „—" –
   * die Karte lädt selbst keine Daten nach.
   */
  stats?: ServerLiveStats | null;
  /**
   * Gehört der Server dem angemeldeten Nutzer? Steuert nur die Optik
   * (gefüllte Karte statt reiner Kontur) – niemals die Berechtigungen.
   */
  isOwn?: boolean;
  pinned?: boolean;
  /** Hinweis „Update verfügbar" über der Statuszeile. */
  updateAvailable?: boolean;
  /** Hinweis „Neustart nötig" über der Statuszeile. */
  restartRequired?: boolean;
  onTogglePin?: (server: GameServerDto) => void;
  onStart?: (server: GameServerDto) => void;
  onStop?: (server: GameServerDto) => void;
  onRestart?: (server: GameServerDto) => void;
  /** Öffnet die Detailseite (F3). */
  onOpen?: (server: GameServerDto) => void;
  /** Bekommt die fertig formatierte Adresse, z. B. `welt.example.org:25565`. */
  onCopyAddress?: (address: string, server: GameServerDto) => void;
  /** Direktnachricht an den Besitzer (F5). */
  onMessageOwner?: (server: GameServerDto) => void;
  className?: string;
}

/** Auslastungsgrad in eine Ampel-Farbe übersetzen. */
function loadTone(percent: number | null): Tone {
  if (percent == null) return 'neutral';
  if (percent > 75) return 'danger';
  if (percent > 50) return 'warning';
  return 'brand';
}

/** Latenz in eine Ampel-Farbe übersetzen. */
function pingTone(pingMs: number | null): Tone {
  if (pingMs == null) return 'neutral';
  if (pingMs > 60) return 'danger';
  if (pingMs > 35) return 'warning';
  return 'success';
}

function ratio(used: number | null | undefined, total: number): number | null {
  if (used == null || total <= 0) return null;
  return clampPercent((used / total) * 100);
}

/**
 * Zentrale Serverkarte der Übersicht (Lastenheft §3.3, Mockup `ServerCard.dc.html`).
 *
 * Rein darstellend: alle Daten kommen per Props, jede Aktion geht als Callback
 * nach oben. Welche Schaltflächen erscheinen, entscheidet ausschließlich das
 * `permissions`-Objekt des DTO (Pflichtenheft §5.2) – die Karte leitet nichts
 * aus Rollen ab und prüft nichts selbst nach.
 */
export function ServerCard({
  server,
  stats,
  isOwn = false,
  pinned = false,
  updateAvailable = false,
  restartRequired = false,
  onTogglePin,
  onStart,
  onStop,
  onRestart,
  onOpen,
  onCopyAddress,
  onMessageOwner,
  className,
}: ServerCardProps) {
  const meta = serverStatusMeta(server.status);
  const permissions = server.permissions;
  const live = hasLiveStats(server.status) ? (stats ?? null) : null;

  const cpuPercent = live?.cpuPercent == null ? null : clampPercent(live.cpuPercent);
  const ramPercent = ratio(live?.ramUsedMb, server.resourceLimits.ramMb);
  const diskPercent = ratio(stats?.diskUsedMb, server.resourceLimits.diskMb);
  const pingMs = live?.pingMs ?? null;

  const address = formatServerAddress(server.address);
  const showAddress = permissions.canViewAddress && address !== null;

  const action = startStopAction(server.status);
  const actionBlocked = isLifecycleActionBlocked(server.status);
  const canUseStartStop = action === 'stop' ? permissions.canStop : permissions.canStart;
  const showLifecycleRow = canUseStartStop || permissions.canRestart;
  const hasAnyAction = showLifecycleRow || permissions.canView;

  return (
    <article
      className={cn(
        'relative flex flex-col overflow-hidden rounded-2xl border border-line p-4',
        isOwn ? 'bg-card-gradient' : 'bg-transparent',
        className,
      )}
    >
      <header className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-tile bg-brand-gradient text-base font-bold text-canvas"
        >
          {serverInitials(server.name)}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-bold">{server.name}</h3>
          <p className="truncate text-sm text-ink-soft">
            {server.gameTypeName}
            {!isOwn && server.ownerDisplayName ? ` · ${server.ownerDisplayName}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <ServerStatusPill status={server.status} />
          {updateAvailable ? <span className="text-2xs text-warning">Update verfügbar</span> : null}
          {restartRequired ? <span className="text-2xs text-warning">Neustart nötig</span> : null}
        </div>

        {permissions.canManageSettings && onTogglePin ? (
          <button
            type="button"
            onClick={() => onTogglePin(server)}
            aria-pressed={pinned}
            aria-label={pinned ? 'Anheftung lösen' : 'Server anheften'}
            title={pinned ? 'Anheftung lösen' : 'Server anheften'}
            className={cn(
              'shrink-0 rounded-sm p-0.5',
              pinned ? 'text-brand' : 'text-ink-faint hover:text-ink-muted',
            )}
          >
            <svg
              width={15}
              height={15}
              viewBox="0 0 24 24"
              fill={pinned ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden
            >
              <path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L2 9l6-1z" />
            </svg>
          </button>
        ) : null}
      </header>

      {meta.transitional ? (
        <div className="mt-3">
          <div className="relative h-1 overflow-hidden rounded-sm bg-fill-strong">
            <div className="absolute inset-y-0 left-0 w-[30%] animate-startup-sweep bg-gradient-to-r from-transparent via-warning to-transparent" />
          </div>
          <p className="mt-1.5 text-xs text-warning">{meta.label}</p>
        </div>
      ) : null}

      {meta.faulted ? (
        <p className="mt-3 rounded border border-danger-line bg-danger-soft px-2.5 py-2 text-sm text-danger">
          {server.statusMessage ?? meta.description}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-4 gap-1.5">
        <MetricRing
          label="CPU"
          value={cpuPercent == null ? '—' : `${cpuPercent}%`}
          percent={cpuPercent}
          tone={loadTone(cpuPercent)}
        />
        <MetricRing
          label="RAM"
          value={ramPercent == null ? '—' : `${ramPercent}%`}
          percent={ramPercent}
          tone={loadTone(ramPercent)}
        />
        <MetricRing
          label="Platte"
          value={formatMegabytes(stats?.diskUsedMb)}
          percent={diskPercent}
          tone={loadTone(diskPercent)}
        />
        <MetricRing
          label="Ping"
          value={formatPing(pingMs)}
          percent={pingMs == null ? null : Math.max(6, 100 - pingMs)}
          tone={pingTone(pingMs)}
        />
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2.5 text-sm">
        <span className="flex items-center gap-1 text-ink-muted">
          <Icon name="user" size={12} />
          {formatPlayers(live?.playersOnline, live?.playersMax)}
        </span>
        {server.hostName ? <span className="text-ink-faint">Node: {server.hostName}</span> : null}
      </div>

      {showAddress ? (
        onCopyAddress ? (
          <button
            type="button"
            onClick={() => onCopyAddress(address, server)}
            title="Adresse kopieren"
            className="mt-2 flex w-fit items-center gap-1.5 rounded border border-line bg-fill px-2.5 py-1.5 font-mono text-xs text-ink-muted"
          >
            <Icon name="copy" size={11} />
            {address}
          </button>
        ) : (
          <span className="mt-2 w-fit rounded border border-line bg-fill px-2.5 py-1.5 font-mono text-xs text-ink-muted">
            {address}
          </span>
        )
      ) : (
        <p className="mt-2 text-xs text-ink-faint">Adresse nicht freigegeben</p>
      )}

      {!isOwn ? (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <span className="flex-1 truncate text-xs text-ink-soft">
            {server.ownerDisplayName
              ? `${server.ownerDisplayName} · fremder Server`
              : 'Fremder Server'}
          </span>
          {onMessageOwner ? (
            <Button variant="ghost" size="sm" onClick={() => onMessageOwner(server)}>
              Nachricht
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1" />

      <footer className="mt-3.5 flex gap-2">
        {canUseStartStop ? (
          <Button
            variant={action === 'stop' ? 'danger' : 'success'}
            className="flex-1"
            disabled={actionBlocked}
            title={actionBlocked ? meta.description : undefined}
            onClick={() => (action === 'stop' ? onStop?.(server) : onStart?.(server))}
          >
            {action === 'stop' ? 'Stoppen' : 'Starten'}
          </Button>
        ) : null}

        {permissions.canRestart ? (
          <IconButton
            icon="restart"
            label="Neustart"
            disabled={actionBlocked}
            onClick={() => onRestart?.(server)}
          />
        ) : null}

        {permissions.canView ? (
          <Button className={cn(!showLifecycleRow && 'flex-1')} onClick={() => onOpen?.(server)}>
            {permissions.canManageSettings ? 'Verwalten' : 'Ansehen'}
          </Button>
        ) : null}

        {!hasAnyAction ? <span className="py-2.5 text-sm text-ink-faint">Kein Zugriff</span> : null}
      </footer>
    </article>
  );
}
