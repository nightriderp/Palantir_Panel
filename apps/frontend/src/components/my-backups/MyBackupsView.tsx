'use client';

import {
  AUTOMATIC_BACKUP_RETENTION_DAYS,
  type BackupDto,
  type GameServerDto,
} from '@palantir/contracts';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  ConfirmDialog,
  DangerConfirmDialog,
  EmptyState,
  Icon,
  MetricTile,
  PageHeader,
  Panel,
  SegmentedControl,
  cn,
  formatBytes,
  formatDateTime,
  formatNumber,
  useHighlight,
  useToast,
} from '@/components/shared';
import { errorText } from '@/lib/api/client';
import {
  backupDownloadUrl,
  deleteBackup,
  fetchOwnBackups,
  fetchServers,
  restoreBackup,
} from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import {
  BACKUP_STATUS_META,
  BACKUP_TYPE_LABELS,
  type BackupTypeFilter,
  consistencyMeta,
  filterByType,
  retentionState,
  serversWithoutBackup,
  sortByNewest,
  summarizeOwnBackups,
} from './backupsView';

/**
 * „Meine Backups" (Arbeitspaket F4, Lastenheft §3.3 und §3.7).
 *
 * Globale Ansicht aller eigenen Sicherungen über sämtliche eigenen Server: je
 * Sicherung Server, Zeitpunkt, Größe und Typ, dazu die eigene Speicherbelegung
 * und ein sichtbarer Hinweis auf die Aufbewahrungsregel. Wiederherstellen,
 * Herunterladen und Löschen erscheinen ausschließlich nach dem
 * `permissions`-Objekt des jeweiligen Backups (Pflichtenheft §5.2) – das
 * Frontend rechnet keine Rechte selbst. Löschen ist endgültig und läuft über
 * die Bestätigungs-Modal-Variante aus F2.
 *
 * Die Ansicht baut ausschließlich auf B5-Endpunkten und F2-Bausteinen auf; die
 * Aufbewahrungsregel selbst wertet das Backend aus – hier steht nur ihr
 * Ergebnis (`retentionProtected`, `expiresAt`).
 */

const TYPE_FILTERS: ReadonlyArray<{ key: BackupTypeFilter; label: string }> = [
  { key: 'all', label: 'Alle' },
  { key: 'manual', label: 'Manuell' },
  { key: 'automatic', label: 'Automatisch' },
];

function retentionNote(backup: BackupDto): string {
  switch (retentionState(backup)) {
    case 'failed':
      return backup.failureMessage ?? 'Die Sicherung ist fehlgeschlagen.';
    case 'pending':
      return 'Die Sicherung wird gerade erstellt.';
    case 'protected':
      return 'Bleibt erhalten, bis du sie löschst.';
    case 'expiring':
      return `Wird automatisch gelöscht am ${formatDateTime(backup.expiresAt ?? '')}.`;
  }
}

export function MyBackupsView() {
  const { user, loading: sessionLoading } = useSession();
  const toast = useToast();
  // Sprung aus einer Meldung „Backup fehlgeschlagen“ (Gefundener Punkt 103).
  const highlight = useHighlight();

  const [filter, setFilter] = useState<BackupTypeFilter>('all');
  const [busy, setBusy] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<BackupDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupDto | null>(null);

  const backups = useApiResource<BackupDto[]>(
    (signal) => fetchOwnBackups(user!.id, signal),
    user ? [user.id] : null,
  );

  /*
   * Die Serverliste dient nur einem Zweck: zu zeigen, welcher eigene Server
   * ueberhaupt keine Sicherung hat. In der Liste der Sicherungen kann er
   * naturgemaess nicht auftauchen - im Entwurf steht er mit „—" in der Tabelle.
   */
  const servers = useApiResource<GameServerDto[]>(
    (signal) => fetchServers(signal),
    user ? [user.id] : null,
  );

  const all = useMemo(() => sortByNewest(backups.data ?? []), [backups.data]);
  const ungesichert = useMemo(
    () => serversWithoutBackup(servers.data ?? [], all, user?.id ?? null),
    [servers.data, all, user?.id],
  );
  const summary = useMemo(() => summarizeOwnBackups(all), [all]);
  const visible = useMemo(() => filterByType(all, filter), [all, filter]);

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

  const loading = backups.loading || (sessionLoading && backups.data === null);

  return (
    <>
      <PageHeader
        title="Meine Backups"
        subtitle="Alle Sicherungen deiner Server an einem Ort – mit deinem gesamten Speicherverbrauch."
      />

      <div className="flex flex-col gap-5 p-5">
        <Panel variant="outline" className="flex items-start gap-3">
          <Icon name="database" size={18} className="mt-0.5 shrink-0 text-brand" />
          <p className="text-base text-ink-muted">
            Automatische Sicherungen, die älter als {AUTOMATIC_BACKUP_RETENTION_DAYS} Tage sind,
            werden gelöscht – die jeweils neueste je Server bleibt immer erhalten. Manuell erstellte
            Sicherungen sind davon ausgenommen und bleiben, bis du sie selbst entfernst.
          </p>
        </Panel>

        {backups.error ? (
          <EmptyState
            icon="warning"
            title="Deine Backups konnten nicht geladen werden"
            description={backups.error}
            action={
              <Button variant="secondary" onClick={() => backups.reload()}>
                Erneut versuchen
              </Button>
            }
          />
        ) : loading ? (
          <p className="text-base text-ink-muted">Backups werden geladen …</p>
        ) : all.length === 0 ? (
          <EmptyState
            icon="database"
            title="Noch keine Sicherungen"
            description="Sobald du einen deiner Server sicherst oder ein geplanter Lauf greift, erscheinen die Sicherungen hier."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricTile label="Sicherungen" value={formatNumber(summary.total)} />
              <MetricTile label="Speicher gesamt" value={formatBytes(summary.totalSizeBytes)} />
              <MetricTile label="Manuell" value={formatNumber(summary.manualCount)} />
              <MetricTile label="Automatisch" value={formatNumber(summary.automaticCount)} />
            </div>

            {ungesichert.length === 0 ? null : (
              <Panel variant="outline" className="flex flex-col gap-1.5">
                <p className="text-base font-semibold text-ink">Ohne Sicherung</p>
                <p className="text-xs text-ink-muted">
                  Zu diesen Servern liegt noch keine einzige Sicherung vor.
                </p>
                <ul className="flex flex-wrap gap-x-3 gap-y-1">
                  {ungesichert.map((server) => (
                    <li key={server.id}>
                      <Link
                        href={`/servers/${server.id}`}
                        className="text-base font-semibold text-brand hover:underline"
                      >
                        {server.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <SegmentedControl
              label="Backups nach Typ filtern"
              items={TYPE_FILTERS}
              value={filter}
              onChange={setFilter}
              className="self-start"
            />

            {visible.length === 0 ? (
              <Panel variant="outline" className="text-center text-base text-ink-muted">
                Für diesen Filter gibt es keine Sicherungen.
              </Panel>
            ) : (
              <ul className="flex flex-col gap-2">
                {visible.map((backup) => {
                  const status = BACKUP_STATUS_META[backup.status];
                  const consistency = consistencyMeta(backup);
                  const done = backup.status === 'completed';

                  return (
                    <li key={backup.id} ref={highlight.ref(backup.id)}>
                      <Panel
                        variant="plain"
                        padding="sm"
                        className={cn('flex flex-col gap-2', highlight.className(backup.id))}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">
                            {backup.serverName ?? 'Gelöschter Server'}
                          </span>
                          <Badge tone="neutral">{BACKUP_TYPE_LABELS[backup.type]}</Badge>
                          {backup.isExport ? <Badge tone="brand">Export</Badge> : null}
                          <Badge tone={status.tone} withDot pulse={backup.status === 'running'}>
                            {status.label}
                          </Badge>
                          {/* „Vollständig / Unklar" (Gefundener Punkt 38). */}
                          {consistency === null ? null : (
                            <span title={consistency.title}>
                              <Badge tone={consistency.tone}>{consistency.label}</Badge>
                            </span>
                          )}

                          <span className="ml-auto flex flex-wrap items-center gap-2">
                            {backup.permissions.canDownload && done ? (
                              <a
                                href={backupDownloadUrl(backup.id)}
                                download
                                className="text-sm font-semibold text-brand hover:underline"
                              >
                                Herunterladen
                              </a>
                            ) : null}
                            {backup.permissions.canRestore && done ? (
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => setPendingRestore(backup)}
                              >
                                Wiederherstellen
                              </Button>
                            ) : null}
                            {backup.permissions.canDelete ? (
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={busy}
                                onClick={() => setPendingDelete(backup)}
                              >
                                Löschen
                              </Button>
                            ) : null}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
                          <span className="font-mono">{formatDateTime(backup.createdAt)}</span>
                          <span className="font-mono">
                            {done ? formatBytes(backup.sizeBytes) : '—'}
                          </span>
                          <span>{retentionNote(backup)}</span>
                        </div>
                      </Panel>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingRestore !== null}
        onClose={() => setPendingRestore(null)}
        busy={busy}
        title="Sicherung wiederherstellen?"
        confirmLabel="Wiederherstellen"
        message={
          pendingRestore
            ? `Der aktuelle Stand von „${pendingRestore.serverName ?? 'diesem Server'}" wird durch die Sicherung vom ${formatDateTime(pendingRestore.createdAt)} ersetzt. Der Server wird dafür gestoppt und danach neu gestartet.`
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
            ? `Die Sicherung vom ${formatDateTime(pendingDelete.createdAt)}${
                pendingDelete.serverName ? ` von „${pendingDelete.serverName}"` : ''
              } wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.`
            : ''
        }
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete);
        }}
      />
    </>
  );
}
