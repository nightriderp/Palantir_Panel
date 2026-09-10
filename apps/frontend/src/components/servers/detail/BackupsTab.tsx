'use client';

import {
  AUTOMATIC_BACKUP_RETENTION_DAYS,
  type BackupDto,
  type BackupProgress,
  type BackupRestoreJobDto,
  type GameServerDto,
} from '@palantir/contracts';
import { useEffect, useState } from 'react';
import {
  BACKUP_STATUS_META,
  BACKUP_TYPE_LABELS,
  Badge,
  Button,
  ConfirmDialog,
  DangerConfirmDialog,
  EmptyState,
  Panel,
  ToggleRow,
  formatDateTime,
  useToast,
} from '@/components/shared';
import { errorText } from '@/lib/api/client';
import {
  backupDownloadUrl,
  createBackup,
  deleteBackup,
  fetchBackups,
  restoreBackup,
} from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { formatBytes } from '../formatDetail';
import { consistencyMeta } from '@/components/my-backups/backupsView';
import { JobProgress } from './JobProgress';

/**
 * Reiter „Backups" der Detailansicht (Lastenheft §3.3).
 *
 * Liste, manuelles Sichern, Wiederherstellen und Löschen. Die
 * Aufbewahrungsregel – automatische Sicherungen verfallen nach sieben Tagen,
 * die neueste und alle manuellen bleiben – wertet das Backend aus (B5); hier
 * steht nur ihr Ergebnis als `expiresAt` und `retentionProtected`.
 *
 * Exporte (`isExport`) erscheinen bewusst nicht in dieser Liste: sie gehören
 * zur Datenmitnahme und stehen im Reiter „Einstellungen".
 */

export interface BackupsTabProps {
  server: GameServerDto;
  /**
   * Stand der laufenden Sicherung aus dem Live-Kanal (Fundpunkt event-flow-05).
   *
   * Bis hierher las diese Liste das Ereignis `backup.progressed` gar nicht: Ein
   * eben angestoßenes Backup blieb bis zum Reiterwechsel oder Neuladen auf
   * „Läuft …" stehen, obwohl der Abschluss längst im Browser angekommen war.
   */
  backupProgress: BackupProgress | null;
  /**
   * Laufende oder gerade beendete Wiederherstellung (Fundpunkt 225).
   *
   * Vorher wartete die Anfrage bis zu zwei Stunden auf den Agent, und der
   * Nutzer sah einen Fehlschlag, sobald ein Vermittler davor aufgab. Jetzt
   * antwortet das Backend sofort mit dem Auftrag, und der Fortschritt kommt
   * über den Live-Kanal hierher.
   */
  restoreJob: BackupRestoreJobDto | null;
}

export function BackupsTab({ server, backupProgress, restoreJob }: BackupsTabProps) {
  const toast = useToast();
  /**
   * Auftrag aus der eigenen Antwort – bis das erste Ereignis eintrifft.
   *
   * Ohne ihn bliebe die Anzeige zwischen Klick und erstem Frame leer, und der
   * Nutzer klickte ein zweites Mal.
   */
  const [lokalerAuftrag, setLokalerAuftrag] = useState<BackupRestoreJobDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopServer, setStopServer] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<BackupDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupDto | null>(null);

  const backups = useApiResource<BackupDto[]>(
    (signal) => fetchBackups(server.id, signal),
    [server.id],
  );

  const { reload: reloadBackups, setData: setBackups } = backups;

  /*
   * Live gemeldeten Stand übernehmen (Fundpunkt event-flow-05).
   *
   * Zwei Schritte, absichtlich beide:
   *
   * 1. Der vorhandene Eintrag wird sofort fortgeschrieben – der Nutzer sieht
   *    das Ergebnis in dem Moment, in dem es eintrifft, ohne Netzaufruf.
   * 2. Ist der Vorgang zu Ende (`completed`/`failed`), wird die Liste einmal
   *    nachgeladen. Das Ereignis trägt bewusst nur einen Ausschnitt; Prüfsumme,
   *    Aufbewahrung (`expiresAt`, `retentionProtected`) und das
   *    `permissions`-Objekt, von dem „Herunterladen"/„Wiederherstellen"
   *    abhängen, kommen erst mit dem vollständigen DTO. Ein Nachladen bringt
   *    außerdem Sicherungen mit, die diese Ansicht nie gesehen hat – etwa den
   *    geplanten Lauf, der nebenher fertig wurde.
   *
   * Exporte gehören in den Reiter „Einstellungen" und werden hier übergangen;
   * für welchen Server das Ereignis gilt, entscheidet bereits das Abo im
   * `useServerLive` (Topic = Server-Id, Rücksetzung beim Wechsel).
   */
  useEffect(() => {
    if (backupProgress === null || backupProgress.isExport) return;

    setBackups((current) =>
      current === null
        ? current
        : current.map((eintrag) =>
            eintrag.id === backupProgress.backupId
              ? {
                  ...eintrag,
                  status: backupProgress.status,
                  sizeBytes: backupProgress.sizeBytes,
                  completedAt: backupProgress.completedAt,
                  failureMessage: backupProgress.failureMessage,
                }
              : eintrag,
          ),
    );

    if (backupProgress.status === 'completed' || backupProgress.status === 'failed') {
      reloadBackups();
    }
  }, [backupProgress, reloadBackups, setBackups]);

  async function createNow() {
    setBusy(true);
    const result = await createBackup(server.id, { stopServer });
    setBusy(false);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    toast.success('Die Sicherung wurde angestoßen.');
    backups.setData((current) => [result.data, ...(current ?? [])]);
  }

  async function restore(backup: BackupDto) {
    setBusy(true);
    const result = await restoreBackup(backup.id);
    setBusy(false);
    setPendingRestore(null);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }

    // Der Auftrag aus der Antwort steht sofort da; der Live-Kanal schreibt ihn
    // danach fort (Fundpunkt 225).
    setLokalerAuftrag(result.data);
    toast.success('Die Wiederherstellung läuft. Der Server startet danach neu.');
  }

  async function remove(backup: BackupDto) {
    setBusy(true);
    const result = await deleteBackup(backup.id);
    setBusy(false);
    setPendingDelete(null);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    toast.success('Sicherung gelöscht.');
    backups.setData((current) => (current ?? []).filter((entry) => entry.id !== backup.id));
  }

  const list = (backups.data ?? []).filter((backup) => !backup.isExport);

  /*
   * Der Live-Kanal gewinnt, sobald er etwas zu diesem Auftrag sagt: Er ist der
   * juengere Stand. Ein Auftrag zu einer anderen Sicherung geht diesen Reiter
   * nichts an - er kann nur zu einem Server gehoeren, aber der Nutzer koennte
   * ihn in der Zwischenzeit gewechselt haben.
   */
  const aktuellerAuftrag =
    restoreJob !== null && (lokalerAuftrag === null || restoreJob.id === lokalerAuftrag.id)
      ? restoreJob
      : lokalerAuftrag;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-faint">
        Automatische Sicherungen werden nach {AUTOMATIC_BACKUP_RETENTION_DAYS} Tagen gelöscht, die
        neueste bleibt erhalten. Manuell erstellte Sicherungen bleiben, bis du sie entfernst.
      </p>

      {server.permissions.canManageBackups ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <ToggleRow
            title="Server während der Sicherung anhalten"
            description="Ergibt ein garantiert widerspruchsfreies Archiv, unterbricht aber das Spiel."
            checked={stopServer}
            onChange={setStopServer}
            disabled={busy}
          />
          <Button variant="primary" disabled={busy} onClick={() => void createNow()}>
            Jetzt sichern
          </Button>
        </div>
      ) : null}

      {/*
        Fundpunkt 225: Die Wiederherstellung laeuft als Auftrag. Der Balken
        zeigt, dass etwas passiert - und was, wenn es schiefging.
      */}
      {aktuellerAuftrag === null ? null : (
        <JobProgress
          job={aktuellerAuftrag}
          title={
            aktuellerAuftrag.status === 'completed'
              ? 'Wiederherstellung abgeschlossen'
              : 'Wiederherstellung'
          }
        />
      )}

      {backups.loading && backups.data === null ? (
        <Panel variant="outline" className="text-center text-base text-ink-muted">
          Sicherungen werden geladen …
        </Panel>
      ) : null}

      {backups.error ? (
        <Panel variant="outline" className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-base text-danger">{backups.error}</span>
          <Button onClick={backups.reload}>Erneut versuchen</Button>
        </Panel>
      ) : null}

      {!backups.loading && !backups.error && list.length === 0 ? (
        <EmptyState
          icon="database"
          title="Noch keine Sicherungen"
          description="Sichere den Server jetzt oder warte auf den nächsten geplanten Lauf."
        />
      ) : null}

      {list.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {list.map((backup) => {
            const status = BACKUP_STATUS_META[backup.status];
            const done = backup.status === 'completed';

            return (
              <li key={backup.id}>
                <Panel variant="plain" padding="sm" className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-ink">
                      {formatDateTime(backup.createdAt)}
                    </span>
                    <Badge tone="neutral">{BACKUP_TYPE_LABELS[backup.type]}</Badge>
                    <Badge tone={status.tone} withDot pulse={backup.status === 'running'}>
                      {status.label}
                    </Badge>
                    {/* „Vollständig / Unklar" (Gefundener Punkt 38). */}
                    {consistencyMeta(backup) === null ? null : (
                      <span title={consistencyMeta(backup)?.title}>
                        <Badge tone={consistencyMeta(backup)?.tone ?? 'neutral'}>
                          {consistencyMeta(backup)?.label}
                        </Badge>
                      </span>
                    )}
                    <span className="font-mono text-xs text-ink-faint">
                      {done ? formatBytes(backup.sizeBytes) : '—'}
                    </span>

                    <span className="ml-auto flex flex-wrap items-center gap-2">
                      {backup.permissions.canDownload && done ? (
                        <a
                          href={backupDownloadUrl(backup.id)}
                          download
                          className="text-xs text-brand"
                        >
                          Herunterladen
                        </a>
                      ) : null}
                      {backup.permissions.canRestore && done ? (
                        <Button size="sm" onClick={() => setPendingRestore(backup)}>
                          Wiederherstellen
                        </Button>
                      ) : null}
                      {backup.permissions.canDelete ? (
                        <Button size="sm" variant="danger" onClick={() => setPendingDelete(backup)}>
                          Löschen
                        </Button>
                      ) : null}
                    </span>
                  </div>

                  <p className="text-xs text-ink-faint">
                    {backup.status === 'failed'
                      ? (backup.failureMessage ?? 'Die Sicherung ist fehlgeschlagen.')
                      : backup.retentionProtected || backup.expiresAt === null
                        ? 'Bleibt erhalten, bis du sie löschst.'
                        : `Wird automatisch gelöscht am ${formatDateTime(backup.expiresAt)}.`}
                    {backup.createdByDisplayName
                      ? ` · Ausgelöst von ${backup.createdByDisplayName}`
                      : ''}
                  </p>
                </Panel>
              </li>
            );
          })}
        </ul>
      ) : null}

      <ConfirmDialog
        open={pendingRestore !== null}
        onClose={() => setPendingRestore(null)}
        busy={busy}
        title="Sicherung wiederherstellen?"
        confirmLabel="Wiederherstellen"
        message={
          pendingRestore
            ? `Der aktuelle Stand von „${server.name}" wird durch die Sicherung vom ${formatDateTime(pendingRestore.createdAt)} ersetzt. Der Server wird dafür gestoppt und danach neu gestartet.`
            : ''
        }
        onConfirm={() => {
          if (pendingRestore) void restore(pendingRestore);
        }}
      />

      <DangerConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        busy={busy}
        title="Sicherung löschen?"
        message={
          pendingDelete
            ? `Die Sicherung vom ${formatDateTime(pendingDelete.createdAt)} wird endgültig gelöscht.`
            : ''
        }
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete);
        }}
      />
    </div>
  );
}
