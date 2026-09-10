'use client';

import {
  LIVE_SERVER_LIST_TOPIC,
  type BackupProgress,
  type BackupRestoreJobDto,
  type ServerCloneJobDto,
  type ServerConsoleLine,
  type ServerLiveStats,
  type ServerStatus,
  isLiveServerListEventName,
} from '@palantir/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchServerLogs } from '../api/servers';
import { nextRevision } from '../revision';
import { type LiveConnectionState, useLiveChannel } from './LiveChannelProvider';
import {
  CONSOLE_BACKLOG_LINES,
  appendConsoleLine,
  consoleLineFromLog,
  seedConsoleBacklog,
} from './consoleBuffer';
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
  /**
   * Laufende oder gerade beendete Wiederherstellung (Fundpunkt 225).
   *
   * Wie beim Klon trägt das Ereignis den vollständigen Auftrag; die Ansicht
   * fragt nichts nach.
   */
  restoreJob: BackupRestoreJobDto | null;
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
  const [restoreJob, setRestoreJob] = useState<BackupRestoreJobDto | null>(null);
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

  /*
   * Rückblick beim Öffnen laden (Fundpunkt 184).
   *
   * Der Puffer lebt in diesem Hook und stirbt mit der Seite: Wer zur Übersicht
   * wechselte und zurückkam, sah eine leere Konsole – die Startausgabe war weg,
   * und der Platzhalter behauptete, es komme gerade keine Ausgabe. Das Backend
   * hat den Schwanz des Container-Logs (`GET /servers/:id/logs`), das Frontend
   * rief ihn nur nie auf. Nach bestem Bemühen: Ohne Container (der Server wird
   * gerade angelegt) oder bei einem Fehler bleibt es beim Live-Strom, eine
   * Meldung gibt es nicht – die Konsole ist dann so leer wie vorher.
   */
  useEffect(() => {
    if (!serverId) return;

    const controller = new AbortController();

    void fetchServerLogs(serverId, CONSOLE_BACKLOG_LINES, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || !result.success) return;

        const geladenUm = new Date().toISOString();
        const backlog = result.data.lines.map((line, index) =>
          consoleLineFromLog(serverId, line, index, geladenUm),
        );

        setConsoleLines((lines) => seedConsoleBacklog(lines, backlog));
      })
      .catch(() => undefined);

    return () => controller.abort();
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
          /*
           * Vollständig ersetzen, nicht zusammenführen (Fundpunkt 179).
           *
           * Unter diesem Namen fließen zwei Nutzlasten, und die Server-Abfrage
           * misst weder CPU noch Arbeitsspeicher noch Netzverkehr. Sie
           * danebenzulegen ist Sache des Backends: Nur dort ist bekannt, ob ein
           * `null` „diese Quelle misst es nicht" oder „es ist unbekannt" heißt –
           * hier kommen beide Fälle als dasselbe `null` an. Wer an dieser Stelle
           * zusammenführt, muss pauschal „`null` überschreibt nie" gelten lassen
           * und wird einen einmal gezeigten Wert nie wieder los.
           */
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
        case 'backupRestore.progressed':
          setRestoreJob(frame.data.job);
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
      restoreJob,
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
      restoreJob,
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
  /**
   * Zählt hoch, wenn sich der Bestand geändert hat (Fundpunkt 173): ein
   * Server wurde angelegt, geklont oder gelöscht – oder die Verbindung war
   * zwischendurch weg und könnte so ein Ereignis verpasst haben. Wer die
   * Liste zeigt, lädt sie dann neu; `0` heißt „noch nichts geschehen".
   */
  listRevision: number;
} {
  const channel = useLiveChannel();
  const [statsById, setStatsById] = useState<Record<string, ServerLiveStats>>({});
  const [statusById, setStatusById] = useState<Record<string, LiveStatusEntry>>({});
  const [listRevision, setListRevision] = useState(0);
  const warOffen = useRef(false);

  // Das Listen-Thema ist eines je Konto und hängt nicht an den Ids.
  useEffect(
    () =>
      channel.subscribe(LIVE_SERVER_LIST_TOPIC, (frame) => {
        if (isLiveServerListEventName(frame.event)) {
          setListRevision((revision) => revision + 1);
        }
      }),
    [channel],
  );

  // Nach einem Wiederanlauf einmal neu laden: Was in der Lücke angelegt oder
  // gelöscht wurde, kam über keinen Kanal – und die Liste hat keinen `resync`.
  useEffect(() => {
    if (channel.connection !== 'open') return;
    if (warOffen.current) {
      setListRevision((revision) => revision + 1);
    }
    warOffen.current = true;
  }, [channel.connection]);

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

  return { connection: channel.connection, statsById, statusById, listRevision };
}
