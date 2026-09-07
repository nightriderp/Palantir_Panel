'use client';

import {
  type BackupProgress,
  type ServerCloneJobDto,
  type ServerConsoleLine,
  type ServerLiveStats,
  type ServerStatus,
} from '@palantir/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { nextRevision } from '../revision';
import { type LiveConnectionState, useLiveChannel } from './LiveChannelProvider';
import { appendConsoleLine } from './consoleBuffer';
import { type LiveStatusEntry } from './mergeLiveStatus';

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
  /**
   * Wann dieser Status eintraf, gemessen in der Reihenfolge dieses Browsers
   * (Fundpunkt event-flow-04). `0`, solange kein Frame kam.
   *
   * Ansichten entscheiden damit, ob der Live-Stand jünger ist als ihre
   * REST-Daten – siehe `mergeLiveStatus` und `useDtoRevision`.
   */
  statusRevision: number;
  stats: ServerLiveStats | null;
  consoleLines: ServerConsoleLine[];
  cloneJob: ServerCloneJobDto | null;
  /** Zuletzt gemeldeter Stand einer Sicherung dieses Servers (Gefundener Punkt 51). */
  backupProgress: BackupProgress | null;
  /** Konsolenbefehl senden; `false`, wenn die Verbindung gerade fehlt. */
  sendConsoleCommand: (command: string) => boolean;
  clearConsole: () => void;
}

export function useServerLive(serverId: string | null): ServerLiveData {
  const channel = useLiveChannel();

  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusRevision, setStatusRevision] = useState(0);
  const [stats, setStats] = useState<ServerLiveStats | null>(null);
  const [consoleLines, setConsoleLines] = useState<ServerConsoleLine[]>([]);
  const [cloneJob, setCloneJob] = useState<ServerCloneJobDto | null>(null);
  /**
   * Stand der zuletzt gemeldeten Sicherung dieses Servers (Gefundener Punkt 51).
   *
   * Wer den Export anstößt, sah bisher bis zum nächsten Klick nicht, ob er
   * läuft. Bewusst nur der letzte Stand und keine Liste: Es läuft je Server
   * immer höchstens eine Sicherung (`BACKUP_ALREADY_RUNNING`).
   */
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null);

  /*
   * Beim Wechsel auf einen anderen Server nichts vom vorigen stehen lassen.
   *
   * `backupProgress` fehlte hier (Fundpunkt event-flow-14): Der Stand einer
   * Sicherung von Server A blieb im Hook stehen, während schon Server B
   * angezeigt wurde. Der `SettingsTab` fing das über den Vergleich der
   * `backupId` ab – jeder weitere Konsument (seit event-flow-05 der Reiter
   * „Backups") hätte dieselbe Schutzprüfung mitbringen müssen. Der Hook räumt
   * jetzt selbst auf, statt sie an seine Nutzer zu delegieren.
   */
  useEffect(() => {
    setStatus(null);
    setStatusMessage(null);
    setStatusRevision(0);
    setStats(null);
    setConsoleLines([]);
    setCloneJob(null);
    setBackupProgress(null);
  }, [serverId]);

  useEffect(() => {
    if (!serverId) return;

    return channel.subscribe({ resource: 'server', id: serverId }, (frame) => {
      switch (frame.event) {
        case 'server.statusChanged':
          setStatus(frame.data.status);
          setStatusMessage(frame.data.statusMessage);
          setStatusRevision(nextRevision());
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
        case 'backup.progressed':
          setBackupProgress(frame.data.backup);
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
      statusRevision,
      stats,
      consoleLines,
      cloneJob,
      backupProgress,
      sendConsoleCommand,
      clearConsole,
    }),
    [
      channel.connection,
      status,
      statusMessage,
      statusRevision,
      stats,
      consoleLines,
      cloneJob,
      backupProgress,
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
  /**
   * Zuletzt gemeldeter Status je Server, mit der Nummer seines Eintreffens
   * (Fundpunkt event-flow-04) – siehe `mergeLiveStatus`.
   */
  statusById: Record<string, LiveStatusEntry>;
} {
  const channel = useLiveChannel();
  const [statsById, setStatsById] = useState<Record<string, ServerLiveStats>>({});
  const [statusById, setStatusById] = useState<Record<string, LiveStatusEntry>>({});

  // Stabiler Schlüssel, damit der Effekt nicht bei jedem Rendern neu läuft.
  const key = serverIds.join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const unsubscribes = ids.map((id) =>
      channel.subscribe({ resource: 'server', id }, (frame) => {
        if (frame.event === 'server.statsUpdated') {
          setStatsById((current) => ({ ...current, [id]: frame.data.stats }));
        } else if (frame.event === 'server.statusChanged') {
          setStatusById((current) => ({
            ...current,
            [id]: {
              status: frame.data.status,
              statusMessage: frame.data.statusMessage,
              revision: nextRevision(),
            },
          }));
        }
      }),
    );

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [channel, key]);

  return { connection: channel.connection, statsById, statusById };
}
