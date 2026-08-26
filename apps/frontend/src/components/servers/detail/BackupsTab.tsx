'use client';

import { type BackupDto, type GameServerDto } from '@palantir/contracts';
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
import {
  backupDownloadUrl,
  createBackup,
  deleteBackup,
  fetchBackups,
  restoreBackup,
} from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { formatBytes, formatDateTime } from '../formatDetail';

/**
 * Reiter „Backups" der Detailansicht (Lastenheft §3.3).
 *
 * Liste, manuelles Sichern, Wiederherstellen und Löschen. Die
 * Aufbewahrungsregel – automatische Sicherungen verfallen nach sieben Tagen,
 * manuelle nie – wertet das Backend aus; hier steht nur das Ergebnis als
 * `expiresAt`.
 */

const TRIGGER_LABELS: Record<BackupDto['trigger'], string> = {
  manual: 'Manuell',
  scheduled: 'Geplant',
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
  const [pendingRestore, setPendingRestore] = useState<BackupDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupDto | null>(null);

  const backups = useApiResource<BackupDto[]>(
    (signal) => fetchBackups(server.id, signal),
    [server.id],
  );

  async function createNow() {
    setBusy(true);
    const result = await createBackup(server.id);
    setBusy(false);

    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Die Sicherung wurde angestoßen.');
    backups.setData((current) => [result.data, ...(current ?? [])]);
  }

  async function restore(backup: BackupDto) {
    setBusy(true);
    const result = await restoreBackup(server.id, backup.id);
    setBusy(false);
    setPendingRestore(null);

    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Die Wiederherstellung läuft. Der Server startet danach neu.');
  }

  async function remove(backup: BackupDto) {
    setBusy(true);
    const result = await deleteBackup(server.id, backup.id);
    setBusy(false);
    setPendingDelete(null);

    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Sicherung gelöscht.');
    backups.setData((current) => (current ?? []).filter((entry) => entry.id !== backup.id));
  }

  const list = backups.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-faint">
          Automatische Sicherungen werden nach sieben Tagen gelöscht, die neueste bleibt erhalten.
          Manuell erstellte Sicherungen bleiben, bis du sie entfernst.
        </p>
        {server.permissions.canManageBackups ? (
          <Button variant="primary" disabled={busy} onClick={() => void createNow()}>
            Jetzt sichern
          </Button>
        ) : null}
      </div>

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
            return (
              <li key={backup.id}>
                <Panel variant="plain" padding="sm" className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-ink">
                      {formatDateTime(backup.createdAt)}
                    </span>
                    <Badge tone="neutral">{TRIGGER_LABELS[backup.trigger]}</Badge>
                    <Badge tone={status.tone} withDot pulse={backup.status === 'running'}>
                      {status.label}
                    </Badge>
                    <span className="font-mono text-xs text-ink-faint">
                      {formatBytes(backup.sizeBytes)}
                    </span>

                    <span className="ml-auto flex flex-wrap gap-2">
                      {backup.permissions.canDownload && backup.status === 'completed' ? (
                        <a
                          href={backupDownloadUrl(server.id, backup.id)}
                          download
                          className="text-xs text-brand"
                        >
                          Herunterladen
                        </a>
                      ) : null}
                      {backup.permissions.canRestore && backup.status === 'completed' ? (
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
                    {backup.status === 'failed' && backup.statusMessage
                      ? backup.statusMessage
                      : backup.expiresAt
                        ? `Wird automatisch gelöscht am ${formatDateTime(backup.expiresAt)}.`
                        : 'Bleibt erhalten, bis du sie löschst.'}
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
