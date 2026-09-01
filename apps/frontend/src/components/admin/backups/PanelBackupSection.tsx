'use client';

import { type PanelBackupDto } from '@palantir/contracts';
import { useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  Panel,
  formatBytes,
  formatDateTime,
  useToast,
} from '@/components/shared';
import { errorText } from '@/lib/api/client';
import { deletePanelBackup, fetchPanelBackups, startPanelBackup } from '@/lib/api/admin';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminError, AdminLoading, AdminTable, Td, Th } from '../common';

/**
 * Abschnitt „Panel-Datenbank" der Backup-Seite (Mockup-Abgleich 12.5.1 und
 * 12.5.2).
 *
 * Gesichert wird die **Datenbank des Panels** – Konten, Rollen,
 * Server-Datensätze, Kontingente, Audit-Log. Die Weltdaten der Gameserver sind
 * das nicht; die stehen weiter unten als Speicherverbrauch der Server-Backups
 * und werden je Server gesichert.
 *
 * Der Verlauf hat die Spalten des Entwurfs: Gestartet · Ziel · Auslöser · Größe
 * · Status. „Ziel" ist der Ablageort auf der VPS. Zum **Herunterladen** wird er
 * bewusst nicht angeboten: Der Abzug enthält jedes Konto und jedes Geheimnis
 * der Instanz.
 */

const AUSLOESER: Record<PanelBackupDto['trigger'], string> = {
  manual: 'Von Hand',
  scheduled: 'Automatisch',
};

function StatusBadge({ backup }: { backup: PanelBackupDto }) {
  if (backup.status === 'completed') {
    return <Badge tone="success">Abgeschlossen</Badge>;
  }

  if (backup.status === 'running') {
    return <Badge tone="brand">Läuft</Badge>;
  }

  return <Badge tone="danger">Fehlgeschlagen</Badge>;
}

export function PanelBackupSection() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [zuLoeschen, setZuLoeschen] = useState<PanelBackupDto | null>(null);

  const resource = useApiResource<PanelBackupDto[]>((signal) => fetchPanelBackups(signal), []);
  const backups = resource.data ?? [];

  async function sichern(): Promise<void> {
    setBusy(true);
    const result = await startPanelBackup();
    setBusy(false);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }

    if (result.data.status === 'failed') {
      // Ein gescheiterter Lauf ist festgehalten, nicht verloren – die Meldung
      // steht in der Zeile, deshalb hier nur der Hinweis darauf.
      toast.error(result.data.failureMessage ?? 'Die Sicherung ist fehlgeschlagen.');
    } else {
      toast.success('Sicherung der Panel-Datenbank erstellt.');
    }

    resource.reload();
  }

  async function loeschen(backup: PanelBackupDto): Promise<void> {
    setBusy(true);
    const result = await deletePanelBackup(backup.id);
    setBusy(false);
    setZuLoeschen(null);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }

    toast.success('Sicherung gelöscht.');
    resource.reload();
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Panel-Datenbank</h2>
          <p className="text-sm text-ink-muted">
            Abzüge der Panel-Datenbank auf der VPS – Konten, Rollen, Server-Datensätze, Kontingente.
            Die Weltdaten der Server werden getrennt gesichert.
          </p>
        </div>

        <Button size="sm" disabled={busy || resource.loading} onClick={() => void sichern()}>
          Jetzt sichern
        </Button>
      </div>

      {resource.loading ? (
        <AdminLoading label="Sicherungen werden geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : backups.length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">
          Noch keine Sicherung der Panel-Datenbank.
        </Panel>
      ) : (
        <AdminTable>
          <thead>
            <tr>
              <Th>Gestartet</Th>
              <Th>Ziel</Th>
              <Th>Auslöser</Th>
              <Th className="text-right">Größe</Th>
              <Th>Status</Th>
              <Th className="text-right">Aktion</Th>
            </tr>
          </thead>
          <tbody>
            {backups.map((backup) => (
              <tr key={backup.id}>
                <Td className="whitespace-nowrap text-ink">{formatDateTime(backup.startedAt)}</Td>
                <Td className="max-w-xs truncate" title={backup.storagePath ?? undefined}>
                  {backup.storagePath ?? '—'}
                </Td>
                <Td>{AUSLOESER[backup.trigger]}</Td>
                <Td className="text-right">
                  {backup.status === 'completed' ? formatBytes(backup.sizeBytes) : '—'}
                </Td>
                <Td>
                  <div className="flex flex-col gap-1">
                    <StatusBadge backup={backup} />
                    {backup.failureMessage === null ? null : (
                      <span className="text-xs text-ink-faint">{backup.failureMessage}</span>
                    )}
                  </div>
                </Td>
                <Td className="text-right">
                  {backup.permissions.canDelete ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setZuLoeschen(backup)}
                    >
                      Löschen
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      )}

      <DangerConfirmDialog
        open={zuLoeschen !== null}
        onClose={() => setZuLoeschen(null)}
        title="Sicherung löschen?"
        message={
          zuLoeschen === null ? null : (
            <>
              Die Sicherung vom {formatDateTime(zuLoeschen.startedAt)} wird samt Datei endgültig
              gelöscht.
            </>
          )
        }
        busy={busy}
        onConfirm={() => {
          if (zuLoeschen !== null) {
            void loeschen(zuLoeschen);
          }
        }}
      />
    </section>
  );
}
