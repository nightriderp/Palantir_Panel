'use client';

import {
  AUTOMATIC_BACKUP_RETENTION_DAYS,
  type BackupDto,
  type GameServerDto,
} from '@palantir/contracts';
import { useState } from 'react';
import {
  Badge,
  Button,
  ConfirmDialog,
  DangerConfirmDialog,
  EmptyState,
  Panel,
  type Tone,
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
import { ToggleRow } from '../form/Fields';
import { formatBytes, formatDateTime } from '../formatDetail';

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

const TYPE_LABELS: Record<BackupDto['type'], string> = {
  manual: 'Manuell',
  automatic: 'Automatisch',
};

const STATUS_META: Record<BackupDto['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Wartet', tone: 'warning' },
  running: { label: 'Läuft …', tone: 'warning' },
  completed: { label: 'Fertig', tone: 'success' },
  failed: { label: 'Fehlgeschlagen', tone: 'danger' },
};

export interface BackupsTabProps {
  server: GameServerDto;
}

export function BackupsTab({ server }: BackupsTabProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [stopServer, setStopServer] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<BackupDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupDto | null>(null);

  const backups = useApiResource<BackupDto[]>(
    (signal) => fetchBackups(server.id, signal),
    [server.id],
  );

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
            const status = STATUS_META[backup.status];
            const done = backup.status === 'completed';

            return (
              <li key={backup.id}>
                <Panel variant="plain" padding="sm" className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-ink">
                      {formatDateTime(backup.createdAt)}
                    </span>
                    <Badge tone="neutral">{TYPE_LABELS[backup.type]}</Badge>
                    <Badge tone={status.tone} withDot pulse={backup.status === 'running'}>
                      {status.label}
                    </Badge>
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
