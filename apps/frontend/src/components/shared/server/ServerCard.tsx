'use client';

import { type GameServerDto, type ServerLiveStats } from '@palantir/contracts';
import { memo } from 'react';
import { Icon } from '../icons/Icon';
import { Button, IconButton } from '../primitives/Button';
import { Badge, type Tone } from '../primitives/Badge';
import { cn } from '../utils/cn';
import {
  clampedPercentOf,
  formatCores,
  formatImageUpdate,
  formatImageVersion,
  formatMegabytes,
  formatMegabytesKurz,
  formatNumber,
  formatPercent,
  formatPing,
  formatPlayers,
  formatServerAddress,
  serverInitials,
} from '../utils/format';
import { MetricRing } from './MetricRing';
import { StartupProgress } from './StartupProgress';
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
  /**
   * Bilder des Spieltyps (Betreiber-Wunsch 19.09.2026).
   *
   * Kommen vom Aufrufer, nicht aus dem Server-DTO: Sie gehören zur Vorlage,
   * und die Übersicht kennt die Spieleliste ohnehin. Ohne Bilder bleibt es bei
   * den Anfangsbuchstaben und der einfarbigen Karte.
   */
  gameIconUrl?: string | null;
  gameCoverUrl?: string | null;
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
function ServerCardIntern({
  server,
  stats,
  gameIconUrl = null,
  gameCoverUrl = null,
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
  const fassung = formatImageVersion(server.imageVersion);
  /**
   * Besitzer und Image-Fassung stehen **nicht** mehr im Kopf, sondern unten
   * bei den übrigen Betriebsangaben (Betreiber-Wunsch 20.09.2026).
   *
   * Der Kopf beantwortet „welcher Server ist das": Name, Spiel, Spielfassung.
   * Wer ihn betreibt und mit welchem Image – das sind Angaben derselben Art
   * wie Node, Spielerzahl und Adresse, und die stehen längst als Chips
   * beieinander. Vorher drängten sie sich in eine zweite Kopfzeile, die je
   * nach Breite umbrach und den Kopf dreizeilig machte.
   */
  const updateHinweis = formatImageUpdate(server.imageVersion, server.latestImageVersion);
  const live = hasLiveStats(server.status) ? (stats ?? null) : null;

  /*
   * `cpuPercent` zaehlt in Prozent **eines** Kerns (250 = 2,5 Kerne). Die
   * Kachel zeigte bis zum Wegfall der CPU-Zuweisung den Anteil am Kontingent
   * des Servers; ohne Zuweisung gibt es die Bezugsgroesse nicht mehr. Ein
   * Fuellbalken braucht aber einen Nenner - deshalb faellt der CPU-Balken hier
   * weg und die Kerne stehen als Zahl daneben.
   */
  const cpuCores = live?.cpuPercent == null ? null : Math.round(live.cpuPercent) / 100;
  /*
    CPU als Anteil der Node-Kerne, wie bei hafenmeister: `cpuPercent` zaehlt in
    Prozent EINES Kerns, die Kerne der Maschine machen daraus einen Fuellstand.
    Kennt der Eintrag sie nicht (aelteres Backend, Node nicht sichtbar), bleibt
    es bei der Kernzahl ohne Bogen - lieber unschaerfer als ein geratener Nenner.
  */
  const cpuPercent =
    live?.cpuPercent == null || server.hostCpuCores == null || server.hostCpuCores <= 0
      ? null
      : Math.min(100, live.cpuPercent / server.hostCpuCores);
  /*
    RAM als Anteil an der Node, nicht an der Zuweisung (Betreiber-Entscheidung
    2026-09-18): Die Zuweisung ist eine weiche Grenze, ein Server darf darueber
    liegen. Gezeigt wird der Verbrauch als Zahl; der Bogen sagt, wie viel von
    der Maschine das ist – ohne Kenntnis der Node bleibt es bei der Zahl.
  */
  const ramPercent =
    server.hostRamMb == null || server.hostRamMb <= 0
      ? null
      : clampedPercentOf(live?.ramUsedMb, server.hostRamMb);
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
      {/*
        Kachelbild des Spiels als Hintergrund, stark gedaempft (Betreiber-Wunsch
        19.09.2026): Es soll die Karte kennzeichnen, nicht die Zahlen darauf
        unlesbar machen. Ohne Bild bleibt die Karte wie bisher.

        Jeder Block darunter traegt `relative`, und zwar aus einem Grund: Ein
        absolut gesetztes Geschwister liegt ueber allem, was nicht selbst
        positioniert ist. Ohne das lag der Schleier des Bildes ueber Ringen,
        Zahlen und Schaltflaechen statt hinter ihnen (Betreiber-Meldung
        20.09.2026).
      */}
      {gameCoverUrl === null ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: `url(${gameCoverUrl})` }}
        />
      )}

      <header className="relative flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand-gradient font-mono text-sm font-bold text-canvas"
        >
          {gameIconUrl === null || gameIconUrl === undefined ? (
            serverInitials(server.name)
          ) : (
            /* Adresse aus der Spieleliste, zur Bauzeit unbekannt; `next/image`
               bräuchte dafür eine konfigurierte Domain. */
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gameIconUrl} alt="" className="h-full w-full object-cover" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">{server.name}</h3>
          {/*
            Zwei Zeilen statt einer abgeschnittenen (Fundpunkt 317).
            Oben, was der Server fährt; darunter, womit und für wen. Vorher
            stand alles in einer Zeile mit `truncate` – auf einer schmalen
            Karte verschwanden Fassung und Besitzer dadurch wortlos, und
            gerade sie soll man sehen. Ohne `truncate` bricht die Zeile
            stattdessen um; eine Karte darf höher werden, eine Angabe darf
            nicht verschwinden.

            Der Servername behält sein `truncate`: Er steht im Zweifel
            mehrfach in der Liste, und ein Name, der über drei Zeilen läuft,
            schöbe alles andere aus dem Blick.
          */}
          <p className="text-sm text-ink-soft">
            {server.gameTypeName}
            {server.gameVersion === null || server.gameVersion === undefined
              ? ''
              : ` ${server.gameVersion}`}
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
            <Badge
              tone="warning"
              title={[updateHinweis, 'Auf der Detailseite über „Aktualisieren" übernehmen.']
                .filter((teil) => teil !== null)
                .join(' ')}
            >
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
        <StartupProgress
          compact
          label={meta.label}
          note={server.statusMessage}
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

      <div className="relative flex justify-around">
        {/*
          Ohne CPU-Zuweisung gibt es keinen Nenner fuer einen Fuellstand: Der
          Container darf alle Kerne der Node sehen, und wieviele das sind, steht
          nicht im Server-DTO (sondern in der Node-Uebersicht). Der Ring zeigt
          deshalb die Zahl ohne Bogen - eine ehrliche Angabe statt eines
          Fuellstands gegen eine geratene Obergrenze.
        */}
        <MetricRing
          label="CPU"
          value={
            cpuPercent !== null
              ? formatPercent(cpuPercent)
              : cpuCores == null
                ? '—'
                : formatCores(cpuCores)
          }
          percent={cpuPercent}
          {...(cpuPercent === null ? {} : { tone: loadTone(cpuPercent) })}
          title={
            cpuPercent === null
              ? 'Ausgelastete Kerne. Die Kerne der Node sind hier nicht bekannt – ohne sie gibt es keinen Anteil.'
              : `Anteil an den ${formatNumber(server.hostCpuCores ?? 0)} Kernen der Node – alle Server teilen sie sich.`
          }
        />
        <MetricRing
          label="RAM"
          value={formatMegabytesKurz(live?.ramUsedMb)}
          percent={ramPercent}
          {...(ramPercent === null ? {} : { tone: loadTone(ramPercent) })}
          title={
            ramPercent === null
              ? 'Belegter Arbeitsspeicher. Die Node ist hier nicht bekannt – ohne sie gibt es keinen Anteil.'
              : `Belegter Arbeitsspeicher, Anteil an den ${formatMegabytes(server.hostRamMb ?? 0)} der Node – alle Server teilen sie sich.`
          }
        />
        {/*
          Wie bei der CPU: ohne Zuweisung kein Nenner fuer einen Fuellstand.
          Der belegte Platz des Datenordners steht als Zahl; wie voll die Platte
          der Node ist, sagt die Node-Uebersicht.
        */}
        <MetricRing
          label="Disk"
          value={formatMegabytesKurz(stats?.diskUsedMb)}
          percent={null}
          title="Belegter Platz des Datenordners. Ein Server hat keine feste Platten-Grenze mehr; wie voll die Node ist, steht in der Node-Übersicht."
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
      <div className="relative flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 rounded-md bg-fill px-2.5 py-1.5 text-ink-soft">
          <Icon name="user" size={13} />
          {formatPlayers(live?.playersOnline, live?.playersMax)}
        </span>
        {/*
          Besitzer und Fassung als Chips neben Node und Adresse
          (Betreiber-Wunsch 20.09.2026): Angaben derselben Art stehen
          beieinander, statt den Kopf der Karte zu verlängern.
        */}
        {!isOwn && server.ownerDisplayName ? (
          <span className="min-w-0 rounded-md bg-fill px-2.5 py-1.5 text-ink-soft">
            Besitzer: <span className="text-ink">{server.ownerDisplayName}</span>
          </span>
        ) : null}
        {server.hostName ? (
          <span className="rounded-md bg-fill px-2.5 py-1.5 text-ink-soft">
            Node: <span className="text-ink">{server.hostName}</span>
          </span>
        ) : null}
        {fassung === null ? null : (
          <span
            className="rounded-md bg-fill px-2.5 py-1.5 font-mono text-ink-soft"
            title={
              updateHinweis ??
              'Fassung des Images, mit dem dieser Server läuft – nicht die Fassung des Spiels.'
            }
          >
            {fassung}
          </span>
        )}

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

      <footer className="relative flex gap-2 border-t border-line pt-3.5">
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

/**
 * Die Karte zeichnet nur neu, wenn sich ihre eigenen Angaben ändern
 * (Leistungsbericht 19.09.2026, Punkt 3).
 *
 * Die Übersicht bekommt im Sekundentakt Live-Werte. Ohne diese Hülle zeichnete
 * jede dieser Meldungen **alle** Karten neu – bei zwanzig Servern zwanzig Mal
 * pro Sekunde, obwohl sich meist eine einzige Zahl geändert hatte.
 *
 * Das wirkt nur, solange die Rückruffunktionen von Aufruf zu Aufruf dieselben
 * bleiben; in der Übersicht hängen sie deshalb an `useCallback`. Ein neu
 * gebildetes Lambda je Durchlauf machte den Vergleich hier wertlos.
 */
export const ServerCard = memo(ServerCardIntern);
