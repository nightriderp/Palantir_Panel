/**
 * Länger laufende Server-Vorgänge mit Fortschritt (Pflichtenheft §9,
 * Lastenheft §3.3).
 *
 * Klonen **mit** Weltdaten kopiert je nach Welt viele Gigabyte und läuft
 * deshalb als Auftrag im Hintergrund; das Frontend zeigt den Fortschritt an und
 * pollt nicht, sondern hört auf das Ereignis `serverClone.progressed`.
 *
 * Der **vollständige Export** (Lastenheft §3.3) ist bewusst kein eigener
 * Auftragstyp: B5 führt ihn als `BackupDto` mit `isExport: true`, samt
 * Fortschritt über `status` und Download über den Backup-Endpunkt.
 */

export const SERVER_JOB_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type ServerJobStatus = (typeof SERVER_JOB_STATUSES)[number];

/** Gemeinsame Felder beider Auftragsarten. */
export interface ServerJobBase {
  id: string;
  serverId: string;
  status: ServerJobStatus;
  /** Fortschritt in Prozent (0–100). */
  progressPercent: number;
  /** Deutscher Schritttext, z. B. „Weltdaten werden kopiert". */
  step: string;
  /** Fehlertext bei `status === 'failed'`; sonst `null`. */
  statusMessage: string | null;
  /** ISO-8601-Zeitstempel. */
  startedAt: string;
  /** ISO-8601-Zeitstempel; `null`, solange der Auftrag läuft. */
  finishedAt: string | null;
}

/** Klon-Auftrag (Pflichtenheft §9: neue, eigene Subdomain ist Pflicht). */
export interface ServerCloneJobDto extends ServerJobBase {
  /** Der neu entstehende Server; `null`, bis er angelegt ist. */
  targetServerId: string | null;
  targetName: string;
  targetSubdomain: string;
  /** Weltdaten mitkopieren – ohne das ist der Klon sofort fertig. */
  includeWorldData: boolean;
  /** Bereits kopierte Bytes; `null`, wenn ohne Weltdaten geklont wird. */
  copiedBytes: number | null;
  totalBytes: number | null;
}
