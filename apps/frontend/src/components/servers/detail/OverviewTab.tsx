'use client';

import { type GameServerDto, type ServerLiveStats } from '@palantir/contracts';
import { useState } from 'react';
import {
  Button,
  MetricTile,
  Panel,
  clampPercent,
  formatMegabytes,
  formatPercent,
  formatPing,
  formatPlayers,
  formatServerAddress,
  hasLiveStats,
} from '@/components/shared';
import { fetchStatsHistory } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { type ServerStatsHistoryDto } from '@palantir/contracts';
import { formatBytes, formatDateTime } from '../formatDetail';
import { StatsHistoryChart } from './StatsHistoryChart';

/**
 * Reiter „Übersicht" der Detailansicht (Lastenheft §3.3).
 *
 * Live-Monitoring: CPU, RAM, Speicher, Netzwerk, Spieleranzahl – dazu die
 * Verlaufsdarstellung und die Stammdaten des Servers. Die laufenden Werte
 * kommen über den Live-Kanal; nur der Rückblick wird einmal nachgeladen.
 */

/** Zeitfenster der Verlaufsdarstellung. */
const HISTORY_WINDOW_MINUTES = 60;

export interface OverviewTabProps {
  server: GameServerDto;
  stats: ServerLiveStats | null;
}

function ratio(used: number | null | undefined, total: number): number | null {
  if (used === null || used === undefined || total <= 0) return null;
  return clampPercent((used / total) * 100);
}

export function OverviewTab({ server, stats }: OverviewTabProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  const history = useApiResource<ServerStatsHistoryDto>(
    (signal) => fetchStatsHistory(server.id, HISTORY_WINDOW_MINUTES, signal),
    historyOpen ? [server.id] : null,
  );

  const live = hasLiveStats(server.status) ? stats : null;
  const address = formatServerAddress(server.address);

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile label="CPU" value={formatPercent(live?.cpuPercent)} />
        <MetricTile
          label="RAM"
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
        <MetricTile label="Spieler" value={formatPlayers(live?.playersOnline, live?.playersMax)} />
      </div>

      <div>
        <Button size="sm" onClick={() => setHistoryOpen((open) => !open)}>
          {historyOpen ? 'Verlauf ausblenden' : 'Verlauf der letzten Stunde'}
        </Button>
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
              <MetricTile label="Empfangen" value={formatBytes(live.networkRxBytes)} />
              <MetricTile label="Gesendet" value={formatBytes(live.networkTxBytes)} />
            </div>
            <p className="text-xs text-ink-faint">
              Die Summen zählen ab dem letzten Start des Servers.
            </p>
          </>
        )}
      </Panel>

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
  );
}
