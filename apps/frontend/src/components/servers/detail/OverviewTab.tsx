'use client';

import { type GameServerDto, type ServerLiveStats } from '@palantir/contracts';
import { useState, type ReactNode } from 'react';
import {
  MetricTile,
  Panel,
  clampPercent,
  formatDateTime,
  formatDuration,
  formatMegabytes,
  formatNumber,
  formatPercent,
  formatPing,
  formatPlayers,
  formatServerAddress,
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

/** Zeitfenster der Verlaufsdarstellung. */
const HISTORY_WINDOW_MINUTES = 60;

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

function ratio(used: number | null | undefined, total: number): number | null {
  if (used === null || used === undefined || total <= 0) return null;
  return clampPercent((used / total) * 100);
}

export function OverviewTab({ server, stats, console: consolePanel = null }: OverviewTabProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  const history = useApiResource<ServerStatsHistoryDto>(
    (signal) => fetchStatsHistory(server.id, HISTORY_WINDOW_MINUTES, signal),
    historyOpen ? [server.id] : null,
  );

  const live = hasLiveStats(server.status) ? stats : null;
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
    { label: 'CPU', value: `${server.resourceLimits.cpuCores} Kerne` },
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
        <MetricTile label="CPU-Last" value={formatPercent(live?.cpuPercent)} />
        <MetricTile
          label="Arbeitsspeicher"
          value={formatMegabytes(live?.ramUsedMb)}
          note={`von ${formatMegabytes(server.resourceLimits.ramMb)}`}
        />
        <MetricTile
          label="Platte"
          value={formatMegabytes(stats?.diskUsedMb)}
          note={
            ratio(stats?.diskUsedMb, server.resourceLimits.diskMb) === null
              ? undefined
              : `${ratio(stats?.diskUsedMb, server.resourceLimits.diskMb)} % belegt`
          }
        />
        <MetricTile label="Ping" value={formatPing(live?.pingMs)} />
        <MetricTile label="Laufzeit" value={formatDuration(uptimeSeconds)} />
        {/* Nicht im Mockup, aber die Zahl liegt vor und gehoert zum Zustand. */}
        <MetricTile label="Spieler" value={formatPlayers(live?.playersOnline, live?.playersMax)} />
      </div>

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

          {history.data ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <StatsHistoryChart
                samples={history.data.samples}
                metric="cpuPercent"
                label="CPU-Auslastung"
                max={100}
              />
              <StatsHistoryChart
                samples={history.data.samples}
                metric="ramUsedMb"
                label="Arbeitsspeicher"
                max={server.resourceLimits.ramMb}
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
        {live === null ? (
          <p className="text-sm text-ink-faint">Der Server läuft nicht.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <MetricTile label="Eingehend" value={formatBytes(live.networkRxBytes)} />
              <MetricTile label="Ausgehend" value={formatBytes(live.networkTxBytes)} />
              {/*
               * Paket-Zaehler wie im Entwurf (Abgleich 4.8). Sie stehen nur da,
               * wenn die Runtime sie meldet - ein aelterer Agent laesst die
               * Felder weg, und zwei Kacheln mit "—" waeren dann nur Fuellsel.
               */}
              {live.networkRxPackets === undefined || live.networkRxPackets === null ? null : (
                <MetricTile label="Pakete eingehend" value={formatNumber(live.networkRxPackets)} />
              )}
              {live.networkTxPackets === undefined || live.networkTxPackets === null ? null : (
                <MetricTile label="Pakete ausgehend" value={formatNumber(live.networkTxPackets)} />
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
