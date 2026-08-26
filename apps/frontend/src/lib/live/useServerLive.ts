'use client';

import {
  type ServerCloneJobDto,
  type ServerConsoleLine,
  type ServerExportJobDto,
  type ServerLiveStats,
  type ServerStatus,
} from '@palantir/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type LiveConnectionState, useLiveChannel } from './LiveChannelProvider';
import { appendConsoleLine } from './consoleBuffer';

/**
 * Live-Daten eines einzelnen Servers (Pflichtenheft §5.3).
 *
 * Bündelt das Abo auf die Ressource und hält Status, Messwerte, Konsolenzeilen
 * und den Fortschritt laufender Aufträge. Kein Polling – alles kommt über den
 * gemeinsamen Kanal aus `LiveChannelProvider`.
 */

export interface ServerLiveData {
  connection: LiveConnectionState;
  /** Zuletzt gemeldeter Status; `null`, solange nichts kam – dann gilt der DTO. */
  status: ServerStatus | null;
  statusMessage: string | null;
  stats: ServerLiveStats | null;
  consoleLines: ServerConsoleLine[];
  cloneJob: ServerCloneJobDto | null;
  exportJob: ServerExportJobDto | null;
  /** Konsolenbefehl senden; `false`, wenn die Verbindung gerade fehlt. */
  sendConsoleCommand: (command: string) => boolean;
  clearConsole: () => void;
}

export function useServerLive(serverId: string | null): ServerLiveData {
  const channel = useLiveChannel();

  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [stats, setStats] = useState<ServerLiveStats | null>(null);
  const [consoleLines, setConsoleLines] = useState<ServerConsoleLine[]>([]);
  const [cloneJob, setCloneJob] = useState<ServerCloneJobDto | null>(null);
  const [exportJob, setExportJob] = useState<ServerExportJobDto | null>(null);

  // Beim Wechsel auf einen anderen Server nichts vom vorigen stehen lassen.
  useEffect(() => {
    setStatus(null);
    setStatusMessage(null);
    setStats(null);
    setConsoleLines([]);
    setCloneJob(null);
    setExportJob(null);
  }, [serverId]);

  useEffect(() => {
    if (!serverId) return;

    return channel.subscribe({ resource: 'server', id: serverId }, (frame) => {
      switch (frame.event) {
        case 'server.statusChanged':
          setStatus(frame.data.status);
          setStatusMessage(frame.data.statusMessage);
          break;
        case 'server.statsUpdated':
          setStats(frame.data.stats);
          break;
        case 'server.consoleLineAppended':
          setConsoleLines((lines) => appendConsoleLine(lines, frame.data.line));
          break;
        case 'serverClone.progressed':
          setCloneJob(frame.data.job);
          break;
        case 'serverExport.progressed':
          setExportJob(frame.data.job);
          break;
      }
    });
  }, [channel, serverId]);

  const sendConsoleCommand = useCallback(
    (command: string) => {
      if (!serverId) return false;
      return channel.send({
        kind: 'consoleCommand',
        topic: { resource: 'server', id: serverId },
        command,
      });
    },
    [channel, serverId],
  );

  const clearConsole = useCallback(() => setConsoleLines([]), []);

  return useMemo(
    () => ({
      connection: channel.connection,
      status,
      statusMessage,
      stats,
      consoleLines,
      cloneJob,
      exportJob,
      sendConsoleCommand,
      clearConsole,
    }),
    [
      channel.connection,
      status,
      statusMessage,
      stats,
      consoleLines,
      cloneJob,
      exportJob,
      sendConsoleCommand,
      clearConsole,
    ],
  );
}

/**
 * Live-Messwerte mehrerer Server für die Übersicht.
 *
 * Die Serverliste zeigt auf jeder Karte Ringe; sie abonniert deshalb alle
 * sichtbaren Server auf einmal und hält die Werte in einer Zuordnung nach Id.
 */
export function useServerListLive(serverIds: readonly string[]): {
  connection: LiveConnectionState;
  statsById: Record<string, ServerLiveStats>;
  statusById: Record<string, ServerStatus>;
} {
  const channel = useLiveChannel();
  const [statsById, setStatsById] = useState<Record<string, ServerLiveStats>>({});
  const [statusById, setStatusById] = useState<Record<string, ServerStatus>>({});

  // Stabiler Schlüssel, damit der Effekt nicht bei jedem Rendern neu läuft.
  const key = serverIds.join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const unsubscribes = ids.map((id) =>
      channel.subscribe({ resource: 'server', id }, (frame) => {
        if (frame.event === 'server.statsUpdated') {
          setStatsById((current) => ({ ...current, [id]: frame.data.stats }));
        } else if (frame.event === 'server.statusChanged') {
          setStatusById((current) => ({ ...current, [id]: frame.data.status }));
        }
      }),
    );

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [channel, key]);

  return { connection: channel.connection, statsById, statusById };
}
