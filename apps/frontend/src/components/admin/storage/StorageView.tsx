'use client';

import {
  type HostNodeDto,
  type StorageEntryDto,
  type StorageEntryKind,
  type StorageSnapshotDto,
} from '@palantir/contracts';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  MetricTile,
  PageHeader,
  Panel,
  SelectField,
  Toggle,
  formatBytes,
  formatDateTime,
  formatNumber,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import {
  deleteStorageEntry,
  fetchNodes,
  fetchStorageSnapshot,
  startStorageScan,
} from '@/lib/api/admin';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminAccessNotice, AdminError, AdminLoading, AdminTable, Td, Th } from '../common';
import { storageBlockReasonLabel, storageKindLabel } from '../labels';

/**
 * Node-Platz / Storage-Explorer (Lastenheft §3.8, Pflichtenheft §16).
 *
 * Der Scan läuft on demand; das Ergebnis wird mit Zeitstempel angezeigt.
 * Löschbar sind Backups, ungenutzte Docker-Images und eindeutig verwaiste Daten
 * – aktive Server-Datenordner **nicht**. Das entscheidet der Contract über
 * `entry.permissions.canDelete`/`deleteBlockedReason`, nicht die Ansicht.
 */

const KIND_TONES: Record<StorageEntryKind, 'brand' | 'success' | 'warning' | 'caution' | 'neutral'> = {
  serverData: 'brand',
  backup: 'success',
  dockerImage: 'neutral',
  orphaned: 'caution',
  other: 'neutral',
};

export function StorageView() {
  const { user } = useSession();
  const canView = user?.permissions.canViewNodes ?? false;

  const nodes = useApiResource<HostNodeDto[]>((signal) => fetchNodes(signal), canView ? [] : null);
  const [nodeId, setNodeId] = useState<string | null>(null);

  const activeNodeId = nodeId ?? nodes.data?.[0]?.id ?? null;

  if (!canView) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Node-Platz" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="die Speicherverwaltung" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Node-Platz"
        subtitle="Belegten Speicher der Nodes einsehen und aufräumen"
        className="-mx-5 -mt-5 px-5"
      />

      {nodes.loading ? (
        <AdminLoading label="Nodes werden geladen …" />
      ) : nodes.error ? (
        <AdminError message={nodes.error} onRetry={nodes.reload} />
      ) : (nodes.data ?? []).length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">
          Es ist noch keine Node eingerichtet.
        </Panel>
      ) : (
        <>
          {(nodes.data ?? []).length > 1 ? (
            <div className="max-w-xs">
              <SelectField
                label="Node"
                value={activeNodeId ?? ''}
                onChange={setNodeId}
                options={(nodes.data ?? []).map((node) => ({ value: node.id, label: node.name }))}
              />
            </div>
          ) : null}
          {activeNodeId ? <NodeStorage key={activeNodeId} nodeId={activeNodeId} /> : null}
        </>
      )}
    </div>
  );
}

/** Speicherübersicht einer einzelnen Node. */
function NodeStorage({ nodeId }: { nodeId: string }) {
  const toast = useToast();
  const [includeImages, setIncludeImages] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [kindFilter, setKindFilter] = useState<StorageEntryKind | ''>('');
  const [toDelete, setToDelete] = useState<StorageEntryDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  const resource = useApiResource<StorageSnapshotDto>(
    (signal) => fetchStorageSnapshot(nodeId, signal),
    [nodeId],
  );

  const snapshot = resource.data;
  const breakdown = snapshot?.breakdown ?? null;

  const entries = useMemo(() => {
    const all = breakdown?.entries ?? [];
    return kindFilter ? all.filter((entry) => entry.kind === kindFilter) : all;
  }, [breakdown, kindFilter]);

  async function runScan() {
    setScanning(true);
    const result = await startStorageScan(nodeId, { includeImages });
    setScanning(false);
    if (result.success) {
      resource.setData(result.data);
      toast.success('Scan abgeschlossen.');
    } else {
      toast.error(errorText(result));
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const result = await deleteStorageEntry(nodeId, toDelete.id);
    setDeleting(false);
    if (result.success) {
      toast.success(`„${toDelete.label}" gelöscht.`);
      setToDelete(null);
      resource.reload();
    } else {
      toast.error(errorText(result));
    }
  }

  const canScan = snapshot?.permissions.canScan ?? false;

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-ink-muted">
            {breakdown
              ? `Letzter Scan: ${formatDateTime(breakdown.scannedAt)}`
              : 'Für diese Node ist noch kein Scan gelaufen.'}
          </span>
          {snapshot?.ageSeconds != null ? (
            <span className="text-2xs text-ink-faint">
              vor {Math.round(snapshot.ageSeconds / 60)} min ermittelt
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Toggle
            checked={includeImages}
            onChange={setIncludeImages}
            label="Docker-Images einbeziehen"
            disabled={!canScan || scanning}
          />
          <Button
            variant="primary"
            iconLeft="restart"
            disabled={!canScan || scanning}
            onClick={() => void runScan()}
          >
            {scanning ? 'Scan läuft …' : 'Scan starten'}
          </Button>
        </div>
      </Panel>

      {resource.loading ? (
        <AdminLoading label="Speicherübersicht wird geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : !breakdown ? (
        <Panel className="text-center text-base text-ink-faint">
          Noch keine Daten – starte einen Scan, um die Belegung zu ermitteln.
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <MetricTile label="Gesamt" value={formatBytes(breakdown.totalBytes)} />
            <MetricTile label="Belegt" value={formatBytes(breakdown.usedBytes)} />
            <MetricTile label="Frei" value={formatBytes(breakdown.freeBytes)} />
          </div>

          <div className="flex flex-wrap gap-2">
            {breakdown.categories.map((category) => (
              <span
                key={category.kind}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm"
              >
                <Badge tone={KIND_TONES[category.kind]}>{storageKindLabel(category.kind)}</Badge>
                <span className="text-ink-muted">{formatBytes(category.sizeBytes)}</span>
                <span className="text-ink-faint">({formatNumber(category.entryCount)})</span>
              </span>
            ))}
          </div>

          <div className="max-w-xs">
            <SelectField
              label="Kategorie"
              value={kindFilter}
              onChange={(value) => setKindFilter(value as StorageEntryKind | '')}
              placeholder="Alle Kategorien"
              options={breakdown.categories.map((category) => ({
                value: category.kind,
                label: storageKindLabel(category.kind),
              }))}
            />
          </div>

          {entries.length === 0 ? (
            <Panel className="text-center text-sm text-ink-faint">
              Keine Einträge in dieser Kategorie.
            </Panel>
          ) : (
            <AdminTable>
              <thead>
                <tr>
                  <Th>Eintrag</Th>
                  <Th>Kategorie</Th>
                  <Th className="text-right">Größe</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Aktion</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="text-ink">
                      <div className="flex flex-col">
                        <span>{entry.label}</span>
                        {entry.path ? (
                          <span className="font-mono text-2xs text-ink-faint">{entry.path}</span>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={KIND_TONES[entry.kind]}>{storageKindLabel(entry.kind)}</Badge>
                    </Td>
                    <Td className="text-right">{formatBytes(entry.sizeBytes)}</Td>
                    <Td>{entry.inUse ? 'In Benutzung' : 'Ungenutzt'}</Td>
                    <Td className="text-right">
                      {entry.permissions.canDelete ? (
                        <Button variant="danger" iconLeft="trash" onClick={() => setToDelete(entry)}>
                          Löschen
                        </Button>
                      ) : (
                        <span
                          className="text-2xs text-ink-faint"
                          title={
                            entry.deleteBlockedReason
                              ? storageBlockReasonLabel(entry.deleteBlockedReason)
                              : undefined
                          }
                        >
                          Nicht löschbar
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          )}
        </>
      )}

      {toDelete ? (
        <DangerConfirmDialog
          open
          onClose={() => setToDelete(null)}
          title={`„${toDelete.label}" löschen?`}
          confirmLabel="Endgültig löschen"
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          message={`${storageKindLabel(toDelete.kind)} · ${formatBytes(
            toDelete.sizeBytes,
          )} werden unwiderruflich vom Homeserver entfernt.`}
        />
      ) : null}
    </div>
  );
}
