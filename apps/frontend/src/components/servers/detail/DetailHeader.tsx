'use client';

import { type GameServerDto } from '@palantir/contracts';
import {
  Badge,
  Button,
  Icon,
  IconButton,
  ServerStatusPill,
  StartupProgress,
  formatImageUpdate,
  formatImageVersion,
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
   * Übernimmt die neue Version des Images (Fundpunkt 190).
   *
   * Getrennt von `onLifecycle`, obwohl derselbe Neustart dahintersteht: Für den
   * Betreiber ist das eine andere Absicht, und die Rückfrage davor nennt einen
   * anderen Grund.
   */
  onUpdate: () => void;
  onOpenSettings: () => void;
  onDelete: () => void;
  onCopyAddress: (address: string) => void;
  /**
   * Besitzer wechseln (Pflichtenheft §7). Der Knopf erscheint nur, wenn das
   * DTO `canTransferOwnership` trägt **und** der Aufrufer die Nutzerliste
   * lesen darf – ohne sie gäbe es kein Konto zur Auswahl.
   */
  onTransferOwner?: () => void;
}

export function DetailHeader({
  server,
  busy,
  onLifecycle,
  onUpdate,
  onOpenSettings,
  onDelete,
  onCopyAddress,
  onTransferOwner,
}: DetailHeaderProps) {
  const meta = serverStatusMeta(server.status);
  const blocked = isLifecycleActionBlocked(server.status) || busy;
  const action = startStopAction(server.status);
  const canUseStartStop =
    action === 'stop' ? server.permissions.canStop : server.permissions.canStart;
  const address = formatServerAddress(server.address);

  /*
   * Ein Server behält seine Image-Version, bis jemand sie übernimmt
   * (Pflichtenheft §9, Review 2026-09-16) – der Knopf erscheint deshalb in
   * jedem Zustand, in dem der Wechsel möglich ist: laufend als Neustart,
   * gestoppt als Neuaufbau ohne Start. Mitten in einem Übergang bleibt er
   * gesperrt wie die übrigen Aktionen.
   */
  const canUpdate = server.updateAvailable && server.permissions.canUpdate;
  const version = formatImageVersion(server.imageVersion);
  /**
   * Betriebsangaben als Chips, nicht als zweite Textzeile (Betreiber-Wunsch
   * 20.09.2026).
   *
   * Node, Besitzer und Image-Version gehören zusammen und haben dieselbe Form
   * wie die Adresse darunter. Als aneinandergereihter Text mit Mittelpunkten
   * lasen sie sich wie Kleingedrucktes und brachen auf schmalen Fenstern an
   * beliebiger Stelle um.
   */
  const betriebsangaben: {
    readonly label: string;
    readonly wert: string;
    readonly mono?: boolean;
  }[] = [
    ...(server.hostName ? [{ label: 'Node', wert: server.hostName }] : []),
    ...(server.ownerDisplayName ? [{ label: 'Besitzer', wert: server.ownerDisplayName }] : []),
    ...(version === null ? [] : [{ label: 'Version', wert: version, mono: true }]),
  ];
  const updateHinweis = formatImageUpdate(server.imageVersion, server.latestImageVersion);
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
                title={[
                  updateHinweis,
                  canUpdate
                    ? 'Über „Aktualisieren" wird die neue Version übernommen. Bis dahin läuft der Server auf seiner bisherigen Version – auch nach einem Neustart.'
                    : 'Die neue Version übernimmt der Besitzer über „Aktualisieren".',
                ]
                  .filter((teil) => teil !== null)
                  .join(' ')}
              >
                <Badge tone="warning">Update verfügbar</Badge>
              </span>
            ) : null}
          </div>

          {/*
            Im Kopf steht, welcher Server das ist: Name, Spiel, Spielversion.
            Die Spielversion beantwortet „passt mein Client dazu" und gehört
            deshalb neben den Namen, nicht in eine Einstellungsseite.
          */}
          <p className="mt-1 text-sm text-ink-soft">
            {server.gameTypeName}
            {server.gameVersion === null || server.gameVersion === undefined
              ? ''
              : ` ${server.gameVersion}`}
          </p>

          {betriebsangaben.length === 0 ? null : (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {betriebsangaben.map((angabe) => (
                <span
                  key={angabe.label}
                  className="rounded-md bg-fill px-2.5 py-1.5 text-ink-soft"
                  {...(angabe.label === 'Version' && updateHinweis !== null
                    ? { title: updateHinweis }
                    : {})}
                >
                  {angabe.label}:{' '}
                  <span className={angabe.mono === true ? 'font-mono text-ink' : 'text-ink'}>
                    {angabe.wert}
                  </span>
                </span>
              ))}
            </div>
          )}

          {server.permissions.canViewAddress && address ? (
            <button
              type="button"
              onClick={() => onCopyAddress(`${server.address?.copyPrefix ?? ''}${address}`)}
              title="Adresse kopieren"
              className="mt-2 flex w-fit items-center gap-1.5 rounded border border-line bg-fill px-2.5 py-1.5 font-mono text-xs text-ink-muted"
            >
              <Icon name="copy" size={11} />
              {address}
            </button>
          ) : (
            <p className="mt-2 text-xs text-ink-faint">Adresse nicht freigegeben</p>
          )}

          {/* Kanal des Discord-Bots (Pflichtenheft §14a.4); fehlt ohne Bot oder Kanal. */}
          {server.discordChannelUrl ? (
            <a
              href={server.discordChannelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex w-fit items-center gap-1.5 text-xs text-ink-muted hover:text-ink"
            >
              <Icon name="chat" size={11} />
              In Discord öffnen
            </a>
          ) : null}
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
                  ? 'Startet den Server neu und übernimmt dabei die neue Version.'
                  : 'Baut den Container mit der neuen Version neu, ohne den Server zu starten.'
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

          {server.permissions.canTransferOwnership && onTransferOwner ? (
            <IconButton icon="users" label="Besitzer wechseln" onClick={onTransferOwner} />
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
