'use client';

import { type GameServerDto, type ServerLiveStats } from '@palantir/contracts';
import { Icon } from '../icons/Icon';
import { Button, IconButton } from '../primitives/Button';
import { Badge, type Tone } from '../primitives/Badge';
import { cn } from '../utils/cn';
import {
  clampedPercentOf,
  cpuQuotaPercent,
  formatMegabytes,
  formatPercent,
  formatPing,
  formatPlayers,
  formatServerAddress,
  serverInitials,
} from '../utils/format';
import { MetricRing } from './MetricRing';
import { lastTon, pingTon } from './metricTone';
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
  /**
   * Der Aufrufer sieht diesen fremden Server aufgrund eines instanzweiten
   * Rechts, nicht als eingetragener Mitverwalter (`canViewAnyServer`). Nur dann
   * steht in der Fußzeile „Admin-Zugriff" statt des Besitzernamens – wie im
   * Mockup, das damit sichtbar macht, woher der Einblick kommt.
   */
  adminAccess?: boolean;
  /** Hinweis „Update verfügbar" über der Statuszeile. */
  updateAvailable?: boolean;
  /** Hinweis „Neustart nötig" über der Statuszeile. */
  restartRequired?: boolean;
  /**
   * Läuft für **diesen** Server gerade eine Lebenszyklus-Anfrage?
   * (Fundpunkt 220.)
   *
   * Dann sperren Starten/Stoppen und Neustart, und der Knopf sagt, dass etwas
   * unterwegs ist. Gemessen war der Knopf über die gesamte Laufzeit der
   * Anfrage bedienbar – zwei schnelle Klicks schickten zwei `POST …/start`.
   */
  pending?: boolean;
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

/**
 * Auslastungsgrad in eine Ampel-Farbe übersetzen.
 *
 * Die Schwellen stehen in `metricTone.ts` und gelten auch für die Kacheln der
 * Detailseite; hier wird nur der fehlende Wert auf „neutral" abgebildet,
 * weil der Ring immer eine Farbe braucht.
 */
function loadTone(percent: number | null): Tone {
  return lastTon(percent) ?? 'neutral';
}

/** Latenz in eine Ampel-Farbe übersetzen. */
function pingTone(pingMs: number | null): Tone {
  return pingTon(pingMs) ?? 'neutral';
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
  adminAccess = false,
  updateAvailable = false,
  restartRequired = false,
  pending = false,
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

  // Fundpunkt 205: `cpuPercent` zählt in Prozent **eines** Kerns. Vorher stand
  // hier `clampPercent`, und ein Server mit vier Kernen sah bei einem
  // ausgelasteten Kern voll aus.
  const cpuPercent = cpuQuotaPercent(live?.cpuPercent, server.resourceLimits.cpuCores);
  const ramPercent = clampedPercentOf(live?.ramUsedMb, server.resourceLimits.ramMb);
  const diskPercent = clampedPercentOf(stats?.diskUsedMb, server.resourceLimits.diskMb);
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
        // Ein einziger Abstand für die ganze Spalte statt eines eigenen
        // `mt-*` je Abschnitt: So steht überall derselbe Rhythmus, auch wenn
        // ein Abschnitt (Fehlerzeile, Startbalken, fremder Server) wegfällt.
        'relative flex flex-col gap-3.5 overflow-hidden rounded-2xl border border-line p-4.5',
        isOwn ? 'bg-card-gradient' : 'bg-transparent',
        className,
      )}
    >
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-gradient font-mono text-sm font-bold text-canvas"
        >
          {serverInitials(server.name)}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">{server.name}</h3>
          <p className="truncate text-sm text-ink-soft">
            {server.gameTypeName}
            {!isOwn && server.ownerDisplayName ? ` · ${server.ownerDisplayName}` : ''}
          </p>
        </div>

        {/*
          Hinweise als getönte Pillen statt als nackter Text: Neben der
          Statuspille standen sie vorher als zwei magere Zeilen und lasen sich
          wie Kleingedrucktes – dabei sind es Zustände des Servers wie der
          Status selbst.
        */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <ServerStatusPill status={server.status} />
          {updateAvailable ? (
            <Badge tone="warning" title={'Auf der Detailseite über „Aktualisieren" übernehmen.'}>
              Update verfügbar
            </Badge>
          ) : null}
          {restartRequired ? <Badge tone="warning">Neustart nötig</Badge> : null}
        </div>

        {permissions.canManageSettings && onTogglePin ? (
          <button
            type="button"
            onClick={() => onTogglePin(server)}
            aria-pressed={pinned}
            aria-label={pinned ? 'Anpinnung lösen' : 'Server anpinnen'}
            title={pinned ? 'Anpinnung lösen' : 'Server anpinnen'}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
              pinned ? 'bg-brand-soft text-brand' : 'bg-fill text-ink-faint hover:text-ink',
            )}
          >
            <svg
              width={14}
              height={14}
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
        <div>
          <div className="relative h-1 overflow-hidden rounded-sm bg-fill-strong">
            <div className="absolute inset-y-0 left-0 w-[30%] animate-startup-sweep bg-gradient-to-r from-transparent via-warning to-transparent" />
          </div>
          <p className="mt-1.5 text-xs text-warning">{meta.label}</p>
        </div>
      ) : null}

      {meta.faulted ? (
        // Einzeilig abgeschnitten: Die vollständige Meldung steht auf der
        // Detailseite. Eine dreizeilige Fehlermeldung schob vorher die ganze
        // Kachel auseinander, und im Raster standen daneben zwei halbleere.
        <p
          className="truncate rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
          title={server.statusMessage ?? meta.description}
        >
          {server.statusMessage ?? meta.description}
        </p>
      ) : null}

      <div className="flex justify-around">
        <MetricRing
          label="CPU"
          value={formatPercent(cpuPercent)}
          percent={cpuPercent}
          tone={loadTone(cpuPercent)}
        />
        <MetricRing
          label="RAM"
          value={formatPercent(ramPercent)}
          percent={ramPercent}
          tone={loadTone(ramPercent)}
        />
        <MetricRing
          label="Disk"
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

      {/*
        Spieler, Node und Adresse in einer umbrechenden Zeile aus gleich
        gebauten Chips. Vorher waren das drei Bausteine in drei Höhen: eine
        Textzeile, eine zweite Textzeile und darunter ein Rahmenknopf. Als
        Chips stehen sie nebeneinander, brechen bei schmalen Kacheln sauber um
        und sparen eine ganze Zeile Höhe.
      */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 rounded-md bg-fill px-2.5 py-1.5 text-ink-soft">
          <Icon name="user" size={13} />
          {formatPlayers(live?.playersOnline, live?.playersMax)}
        </span>
        {server.hostName ? (
          <span className="rounded-md bg-fill px-2.5 py-1.5 text-ink-soft">
            Node: <span className="text-ink">{server.hostName}</span>
          </span>
        ) : null}

        {showAddress ? (
          onCopyAddress ? (
            <button
              type="button"
              onClick={() => onCopyAddress(address, server)}
              title="Verbindungsadresse kopieren"
              className="flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-fill px-2.5 py-1.5 font-mono text-ink-faint transition-colors hover:text-ink"
            >
              <Icon name="copy" size={11} />
              <span className="truncate">{address}</span>
            </button>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-fill px-2.5 py-1.5 font-mono text-ink-faint">
              <Icon name="copy" size={11} />
              <span className="truncate">{address}</span>
            </span>
          )
        ) : (
          // Ausgegraut statt weggelassen: Die Kachel sieht für alle gleich aus,
          // nur die Angabe fehlt – und wer sie nicht bekommt, sieht, dass es
          // dort etwas gibt. Ausgeliefert wird sie ohne das Recht ohnehin nicht.
          <span
            title="Für deine Rolle nicht freigegeben."
            className="flex min-w-0 cursor-not-allowed items-center gap-1.5 rounded-md border border-line bg-fill px-2.5 py-1.5 font-mono text-ink-disabled"
          >
            <Icon name="copy" size={11} />
            <span className="truncate">nicht freigegeben</span>
          </span>
        )}
      </div>

      {!isOwn ? (
        <div className="flex items-center gap-2 border-t border-line pt-3.5">
          {adminAccess ? (
            <span className="flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-2xs uppercase tracking-[0.06em] text-warning">
              <Icon name="shield" size={12} />
              Admin-Zugriff
            </span>
          ) : (
            <span className="flex-1 truncate text-xs text-ink-soft">
              {server.ownerDisplayName
                ? `${server.ownerDisplayName} · fremder Server`
                : 'Fremder Server'}
            </span>
          )}
          {onMessageOwner ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => onMessageOwner(server)}
            >
              Nachricht
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1" />

      <footer className="flex gap-2 border-t border-line pt-3.5">
        {canUseStartStop ? (
          <Button
            variant={action === 'stop' ? 'danger' : 'success'}
            className="flex-1"
            disabled={actionBlocked || pending}
            title={actionBlocked ? meta.description : undefined}
            onClick={() => (action === 'stop' ? onStop?.(server) : onStart?.(server))}
          >
            {pending ? 'Läuft …' : action === 'stop' ? 'Stoppen' : 'Starten'}
          </Button>
        ) : null}

        {permissions.canRestart ? (
          <IconButton
            icon="restart"
            label="Neustart"
            disabled={actionBlocked || pending}
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
