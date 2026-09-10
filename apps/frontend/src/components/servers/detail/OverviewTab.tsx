'use client';

import { type GameServerDto, type ServerLiveStats } from '@palantir/contracts';
import { useMemo, useState, type ReactNode } from 'react';
import {
  MetricTile,
  Panel,
  SegmentedControl,
  clampedPercentOf,
  cpuQuotaPercent,
  formatCores,
  formatDateTime,
  formatDuration,
  formatMegabytes,
  formatNumber,
  formatPercent,
  formatPing,
  formatPlayers,
  formatServerAddress,
  formatTime,
  hasLiveStats,
} from '@/components/shared';
import { fetchStatsHistory } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { type ServerStatsHistoryDto } from '@palantir/contracts';
import { formatBytes } from '../formatDetail';
import { StatsHistoryChart } from './StatsHistoryChart';

/**
 * Reiter „Übersicht" der Detailansicht (Lastenheft §3.3).
 *
 * Live-Monitoring: CPU, RAM, Speicher, Netzwerk, Spieleranzahl – dazu die
 * Verlaufsdarstellung, die Live-Konsole und die Stammdaten des Servers. Die
 * laufenden Werte kommen über den Live-Kanal; nur der Rückblick wird einmal
 * nachgeladen.
 *
 * Konsole und Stammdaten stehen nebeneinander (Mockup: 1.6 zu 1), auf schmalen
 * Bildschirmen untereinander.
 */

/**
 * Wählbare Zeitfenster der Verlaufsdarstellung (Fundpunkt 222).
 *
 * Das Fenster stand fest auf 60 Minuten, obwohl das Backend die Stichproben
 * `STATS_HISTORY_RETENTION_HOURS` lang aufhebt – vorgegeben 48 Stunden. Wer
 * wissen wollte, ob ein Server über Nacht vollgelaufen ist, konnte es an dieser
 * Stelle nicht sehen, obwohl die Zahlen dalagen. Die Route nimmt jedes Fenster
 * entgegen und kappt selbst an der Aufbewahrungsfrist.
 */
const HISTORY_WINDOWS = [
  { minutes: 60, label: '1 Std.' },
  { minutes: 360, label: '6 Std.' },
  { minutes: 1440, label: '24 Std.' },
  { minutes: 2880, label: '48 Std.' },
] as const;

const HISTORY_WINDOW_DEFAULT = 60;

/**
 * Wie alt darf die letzte festgehaltene Messung sein, um noch in die Kacheln zu
 * dürfen? (Nachtrag zu Fundpunkt 206.)
 *
 * Die Kacheln zeigen den **jetzigen** Zustand. Eine drei Stunden alte Messung
 * dort hinzuschreiben wäre eine andere Aussage, auch mit Zeitstempel daneben.
 * Der Wert hängt bewusst nicht am gewählten Verlaufsfenster: Sonst änderte ein
 * Klick auf „48 Std." nebenbei, was die Kacheln behaupten.
 *
 * Eine Stunde ist grosszügig – der Agent meldet im Sekundentakt, sobald er
 * verbunden ist.
 */
const FALLBACK_MAX_AGE_MS = 60 * 60 * 1000;

export interface OverviewTabProps {
  server: GameServerDto;
  stats: ServerLiveStats | null;
  /**
   * Die Live-Konsole. Sie steht wie im Mockup hier und nicht als eigener
   * Reiter; `null`, wenn das Konto sie nicht benutzen darf – dann nehmen die
   * Server-Details die volle Breite ein.
   */
  console?: ReactNode;
}

export function OverviewTab({ server, stats, console: consolePanel = null }: OverviewTabProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyWindow, setHistoryWindow] = useState<number>(HISTORY_WINDOW_DEFAULT);

  /*
   * Der Verlauf wird beim Öffnen der Ansicht geladen, nicht erst beim Aufklappen
   * (Fundpunkt 206). Er ist der einzige Weg an Messwerte, die schon in der
   * Datenbank liegen: Der Live-Kanal sendet nur, wenn der Agent etwas meldet –
   * und meldet er nichts, blieben die Kacheln leer, während das Diagramm
   * darunter für denselben Server eine Kurve zeichnete. Ein Aufruf mehr je
   * Detailansicht; wer den Verlauf aufklappt, spart ihn dafür.
   */
  const history = useApiResource<ServerStatsHistoryDto>(
    (signal) => fetchStatsHistory(server.id, historyWindow, signal),
    [server.id, historyWindow],
  );

  const live = hasLiveStats(server.status) ? stats : null;

  /**
   * Letzte festgehaltene Messung – Ersatz, solange über den Live-Kanal nichts
   * kommt. Nur bei einem Server, der überhaupt Messwerte hat: Bei einem
   * gestoppten stünde dort sonst der Zustand von vorhin, als liefe er noch.
   *
   * Und nur, solange sie frisch genug ist (siehe {@link FALLBACK_MAX_AGE_MS}).
   */
  const letzteMessung = useMemo(() => {
    if (live !== null || !hasLiveStats(server.status)) return null;

    const juengste = history.data?.samples.at(-1) ?? null;
    if (juengste === null) return null;

    const alter = Date.now() - new Date(juengste.updatedAt).getTime();
    return Number.isFinite(alter) && alter <= FALLBACK_MAX_AGE_MS ? juengste : null;
  }, [live, server.status, history.data]);

  /** Was die Kacheln zeigen: der Live-Wert, sonst die letzte Messung. */
  const anzeige = live ?? letzteMessung;
  const address = formatServerAddress(server.address);

  /*
   * Laufzeit seit dem letzten erfolgreichen Start (Mockup „Laufzeit").
   * Nur wenn der Server auch laeuft: bei einem gestoppten Server stuende dort
   * sonst die Zeit seit dem letzten Start von irgendwann, was wie eine laufende
   * Uhr aussaehe. Gerechnet wird beim Rendern - die Anzeige aktualisiert sich
   * mit dem naechsten Messwert, das genuegt fuer eine Angabe in Stunden.
   */
  const uptimeSeconds =
    server.status === 'running' && server.lastStartedAt !== null
      ? (Date.now() - new Date(server.lastStartedAt).getTime()) / 1000
      : null;

  const detailRows: Array<{ label: string; value: string }> = [
    { label: 'Spiel', value: server.gameTypeName },
    { label: 'Node', value: server.hostName ?? 'nicht sichtbar' },
    { label: 'Subdomain', value: server.subdomain },
    {
      label: 'Adresse',
      value: server.permissions.canViewAddress ? (address ?? '—') : 'nicht freigegeben',
    },
    {
      label: 'Ports',
      value: server.assignedPorts.length > 0 ? server.assignedPorts.join(', ') : 'keine',
    },
    { label: 'Arbeitsspeicher', value: formatMegabytes(server.resourceLimits.ramMb) },
    // Fundpunkt 220 (UI-35): Die Angabe stand hier von Hand - und damit "1 Kerne".
    { label: 'CPU', value: formatCores(server.resourceLimits.cpuCores) },
    { label: 'Speicherplatz', value: formatMegabytes(server.resourceLimits.diskMb) },
    { label: 'Besitzer', value: server.ownerDisplayName ?? 'nicht sichtbar' },
    { label: 'Mitverwalter', value: String(server.memberCount) },
    { label: 'Angelegt', value: formatDateTime(server.createdAt) },
    { label: 'Zuletzt gestartet', value: formatDateTime(server.lastStartedAt) },
    {
      label: 'Automatisch abschalten',
      value: server.autoShutdownEnabled
        ? server.autoShutdownTimeoutMinutes === null
          ? 'an (Standard-Timeout)'
          : `an (nach ${server.autoShutdownTimeoutMinutes} min)`
        : 'aus',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Rasterregel wie im Mockup: die Kacheln verteilen sich selbst, statt
          bei einer festen Spaltenzahl umzubrechen. */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
        {/*
          Fundpunkt 205: `cpuPercent` zählt in Prozent **eines** Kerns – hier
          stand deshalb bei einem Server mit vier Kernen schon mal „250 %".
          Die Kachel zeigt jetzt den Anteil am eigenen Kontingent, der Zusatz
          darunter die Kerne selbst.
        */}
        <MetricTile
          label="CPU-Last"
          value={formatPercent(
            cpuQuotaPercent(anzeige?.cpuPercent, server.resourceLimits.cpuCores),
          )}
          note={
            anzeige?.cpuPercent == null
              ? undefined
              : `${formatNumber(Math.round(anzeige.cpuPercent / 10) / 10)} von ${formatNumber(
                  server.resourceLimits.cpuCores,
                )} Kernen`
          }
        />
        <MetricTile
          label="Arbeitsspeicher"
          value={formatMegabytes(anzeige?.ramUsedMb)}
          note={`von ${formatMegabytes(server.resourceLimits.ramMb)}`}
        />
        <MetricTile
          label="Platte"
          value={formatMegabytes(stats?.diskUsedMb)}
          note={
            clampedPercentOf(stats?.diskUsedMb, server.resourceLimits.diskMb) === null
              ? undefined
              : `${formatPercent(
                  clampedPercentOf(stats?.diskUsedMb, server.resourceLimits.diskMb),
                )} belegt`
          }
        />
        <MetricTile label="Ping" value={formatPing(anzeige?.pingMs)} />
        <MetricTile label="Laufzeit" value={formatDuration(uptimeSeconds)} />
        {/* Nicht im Mockup, aber die Zahl liegt vor und gehoert zum Zustand. */}
        <MetricTile
          label="Spieler"
          value={formatPlayers(anzeige?.playersOnline, anzeige?.playersMax)}
        />
      </div>

      {/*
        Fundpunkt 206: Woher die Zahlen kommen, wenn sie nicht live sind – und
        wenn gar keine da sind, warum. Vorher standen dort wortlos Striche,
        während das Diagramm eine Zeile tiefer eine Kurve zeichnete.
      */}
      {letzteMessung !== null ? (
        <p className="text-xs text-ink-faint">
          Keine laufenden Messwerte – gezeigt wird die letzte festgehaltene Messung von{' '}
          {formatTime(letzteMessung.updatedAt)} Uhr.
        </p>
      ) : live === null && hasLiveStats(server.status) && !history.loading ? (
        <p className="text-xs text-ink-faint">
          In der letzten Stunde hat dieser Server keine Messwerte gemeldet. Meldet sich die Node
          wieder, füllen sich die Kacheln von selbst; ältere Zahlen stehen im Verlauf.
        </p>
      ) : null}

      {/*
        Spielerliste (Gefundener Punkt 51). Sie erscheint nur, wenn die Abfrage
        Namen liefert: Der generische Port-Connect-Test kennt keine, und manche
        Server geben nur einen Auszug heraus. Eine leere Liste hieße „keine
        Angabe" – und die als „niemand da" darzustellen wäre gelogen; die
        belastbare Zahl steht in der Kachel oben.
      */}
      {live?.players && live.players.length > 0 ? (
        <Panel variant="plain" className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">
            Verbundene Spieler
            {live.playersOnline !== null && live.playersOnline > live.players.length
              ? ` (${live.players.length} von ${live.playersOnline} genannt)`
              : null}
          </h3>
          <ul className="flex flex-wrap gap-2">
            {live.players.map((spieler) => (
              <li
                key={spieler.name}
                className="rounded-md border border-line bg-surface-deep px-2.5 py-1 font-mono text-sm text-ink-muted"
              >
                {spieler.name}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div>
        <button
          type="button"
          onClick={() => setHistoryOpen((open) => !open)}
          className="text-sm text-brand hover:text-brand-bright"
        >
          {historyOpen ? 'Verlauf schließen' : 'Verlauf anzeigen'}
        </button>
      </div>

      {historyOpen ? (
        <Panel variant="plain" className="flex flex-col gap-3">
          {history.loading ? (
            <p className="text-base text-ink-muted">Verlauf wird geladen …</p>
          ) : null}
          {history.error ? <p className="text-base text-danger">{history.error}</p> : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-ink-muted">
              {history.data === null
                ? 'Zeitraum'
                : `${formatNumber(history.data.samples.length)} Messpunkte`}
            </span>
            <SegmentedControl
              label="Zeitraum des Verlaufs"
              value={String(historyWindow)}
              onChange={(wert) => setHistoryWindow(Number(wert))}
              items={HISTORY_WINDOWS.map((fenster) => ({
                key: String(fenster.minutes),
                label: fenster.label,
              }))}
            />
          </div>

          {history.data ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <StatsHistoryChart
                samples={history.data.samples}
                metric="cpuPercent"
                label="CPU-Auslastung"
                // Fundpunkt 205: Die Achse endet beim Kontingent des Servers,
                // nicht bei „ein Kern". Sonst sieht ein Vier-Kern-Server schon
                // bei einem ausgelasteten Kern nach Vollausschlag aus.
                max={server.resourceLimits.cpuCores * 100}
                formatValue={(wert) => formatCores(wert / 100)}
              />
              <StatsHistoryChart
                samples={history.data.samples}
                metric="ramUsedMb"
                label="Arbeitsspeicher"
                max={server.resourceLimits.ramMb}
                formatValue={formatMegabytes}
              />
              <StatsHistoryChart
                samples={history.data.samples}
                metric="playersOnline"
                label="Spieler online"
              />
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel variant="plain" className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Netzwerkaktivität</h3>
        {anzeige === null ? (
          /*
           * Fundpunkt 207: Hier stand „Der Server läuft nicht." auch dann, wenn
           * er lief – die Bedingung fragte nach dem Messwert, geantwortet hat
           * sie über den Zustand. Das sind zwei verschiedene Dinge.
           */
          <p className="text-sm text-ink-faint">
            {hasLiveStats(server.status)
              ? 'Noch keine Messwerte für diesen Server.'
              : 'Der Server läuft nicht.'}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <MetricTile label="Eingehend" value={formatBytes(anzeige.networkRxBytes)} />
              <MetricTile label="Ausgehend" value={formatBytes(anzeige.networkTxBytes)} />
              {/*
               * Paket-Zaehler wie im Entwurf (Abgleich 4.8). Sie stehen nur da,
               * wenn die Runtime sie meldet - ein aelterer Agent laesst die
               * Felder weg, und zwei Kacheln mit "—" waeren dann nur Fuellsel.
               */}
              {anzeige.networkRxPackets === undefined ||
              anzeige.networkRxPackets === null ? null : (
                <MetricTile
                  label="Pakete eingehend"
                  value={formatNumber(anzeige.networkRxPackets)}
                />
              )}
              {anzeige.networkTxPackets === undefined ||
              anzeige.networkTxPackets === null ? null : (
                <MetricTile
                  label="Pakete ausgehend"
                  value={formatNumber(anzeige.networkTxPackets)}
                />
              )}
            </div>
            <p className="text-xs text-ink-faint">
              Die Summen zählen ab dem letzten Start des Servers. Weil aller Spiel-Verkehr über das
              Relay läuft, ist das zugleich der Verkehr durch die Panel-VPS.
            </p>
          </>
        )}
      </Panel>

      <div
        className={
          consolePanel === null
            ? 'grid grid-cols-1 gap-4'
            : 'grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]'
        }
      >
        {consolePanel === null ? null : <Panel variant="plain">{consolePanel}</Panel>}

        <Panel variant="plain">
          <h3 className="mb-2 text-base font-semibold">Server-Details</h3>
          <dl className="divide-y divide-line">
            {detailRows.map((row) => (
              <div key={row.label} className="flex justify-between gap-4 py-2">
                <dt className="text-sm text-ink-soft">{row.label}</dt>
                <dd className="text-right font-mono text-sm text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
